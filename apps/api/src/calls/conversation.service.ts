import type { Agent, CallMessage, MessageRole } from "@prisma/client";
import { toNumber } from "@/common/number.js";
import type { ConversationModelProvider } from "@/providers/conversation-model.provider.js";

export type ConversationTurnResult = {
  assistantText: string;
  shouldHangup: boolean;
  outcomeHint: string | null;
  metadata: Record<string, unknown>;
};

export type CallOutcome = {
  call_goal_detected: boolean;
  summary: string;
  caller_name: string | null;
  caller_phone: string | null;
  intent: string | null;
  action_items: string[];
  callback_requested: boolean;
  appointment_requested: boolean;
  do_not_call: boolean;
  confidence: number | null;
};

function toPromptRole(
  role: MessageRole,
): "system" | "user" | "assistant" | "tool" {
  switch (role) {
    case "SYSTEM":
      return "system";
    case "USER":
      return "user";
    case "ASSISTANT":
      return "assistant";
    case "TOOL":
      return "tool";
  }
}

function trimByApproxTokens(text: string, maxTokens: number): string {
  const maxChars = Math.max(80, maxTokens * 4);
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function looksLikeGoodbye(text: string): boolean {
  return /(до свидания|пока|goodbye|bye|спасибо, пока)/i.test(text);
}

function detectIntent(text: string): string | null {
  if (/перезвон|callback/i.test(text)) {
    return "callback";
  }
  if (/встреч|appointment|запис/i.test(text)) {
    return "appointment";
  }
  if (/поддержк|support/i.test(text)) {
    return "support";
  }
  return null;
}

function extractCallerName(
  messages: Array<Pick<CallMessage, "role" | "text">>,
): string | null {
  const userText = messages
    .filter((message) => message.role === "USER")
    .map((message) => message.text)
    .join(" ");

  const match = userText.match(/меня зовут\s+([А-Яа-яA-Za-z-]+)/i);
  return match?.[1] ?? null;
}

export class ConversationService {
  constructor(private readonly modelProvider: ConversationModelProvider) {}

  async generateTurn(params: {
    agent: Agent;
    history: Array<Pick<CallMessage, "role" | "text">>;
    userText: string;
  }): Promise<ConversationTurnResult> {
    const turnsCount =
      params.history.filter((message) => message.role === "USER").length + 1;
    const maxTurns = params.agent.maxTurns;

    if (turnsCount > maxTurns) {
      return {
        assistantText: params.agent.goodbyeText,
        shouldHangup: true,
        outcomeHint: "max_turns_reached",
        metadata: { reason: "max_turns_reached" },
      };
    }

    const conversationHistory = params.history.slice(-12).map((message) => ({
      role: toPromptRole(message.role),
      content: message.text,
    }));

    const modelMessages = [
      {
        role: "system" as const,
        content: `${params.agent.systemPrompt}\n\nОтвечай на языке ${params.agent.language}. Будь кратким, голосовой формат, без markdown.`,
      },
      ...conversationHistory,
      {
        role: "user" as const,
        content: params.userText,
      },
    ];

    let assistantText = "";
    try {
      assistantText = await this.modelProvider.generate({
        model: params.agent.llmProvider,
        temperature: toNumber(params.agent.responseTemperature, 0.3),
        maxTokens: params.agent.responseMaxTokens,
        messages: modelMessages,
      });
    } catch (error) {
      console.error("[conversation] model error", error);
      assistantText = params.agent.fallbackText;
    }

    assistantText = trimByApproxTokens(
      assistantText.trim(),
      params.agent.responseMaxTokens,
    );
    if (!assistantText) {
      assistantText = params.agent.fallbackText;
    }

    const shouldHangup =
      looksLikeGoodbye(params.userText) || looksLikeGoodbye(assistantText);

    return {
      assistantText,
      shouldHangup,
      outcomeHint: shouldHangup ? "goodbye" : null,
      metadata: {
        turnsCount,
        shouldHangup,
      },
    };
  }

  buildOutcome(params: {
    messages: Array<Pick<CallMessage, "role" | "text">>;
    callerPhone: string | null;
    fallbackSummary?: string;
  }): CallOutcome {
    const userText = params.messages
      .filter((message) => message.role === "USER")
      .map((message) => message.text)
      .join(" ")
      .toLowerCase();

    const intent = detectIntent(userText);
    const callbackRequested = /перезвон|callback|свяжит/i.test(userText);
    const appointmentRequested = /встреч|appointment|запис/i.test(userText);
    const doNotCall = /не звон|do not call/i.test(userText);

    const lastAssistant = [...params.messages]
      .reverse()
      .find((message) => message.role === "ASSISTANT")?.text;

    return {
      call_goal_detected: Boolean(
        intent || callbackRequested || appointmentRequested,
      ),
      summary: params.fallbackSummary ?? lastAssistant ?? "Разговор завершён.",
      caller_name: extractCallerName(params.messages),
      caller_phone: params.callerPhone,
      intent,
      action_items: callbackRequested ? ["Перезвонить клиенту"] : [],
      callback_requested: callbackRequested,
      appointment_requested: appointmentRequested,
      do_not_call: doNotCall,
      confidence: intent ? 0.68 : 0.42,
    };
  }
}
