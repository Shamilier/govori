import { env } from "@/common/env.js";
import type {
  ConversationModelProvider,
  ConversationModelRequest,
  PromptMessage,
} from "@/providers/conversation-model.provider.js";
import {
  checkGeminiModel,
  extractGeminiText,
  generateGeminiContent,
} from "@/providers/gemini.shared.js";

export type GeminiConversationProviderConfig = {
  getApiKey: () => Promise<string | null>;
  getModel: () => Promise<string>;
};

function mapRole(role: PromptMessage["role"]): "user" | "model" {
  if (role === "user") {
    return "user";
  }
  return "model";
}

export class GeminiConversationProvider implements ConversationModelProvider {
  constructor(private readonly config: GeminiConversationProviderConfig) {}

  async generate(request: ConversationModelRequest): Promise<string> {
    const apiKey =
      request.apiKey ??
      (await this.config.getApiKey()) ??
      env.GEMINI_API_KEY ??
      env.LLM_API_KEY ??
      null;
    const model = request.model ?? (await this.config.getModel());

    if (!apiKey) {
      const latest = request.messages.at(-1)?.content ?? "";
      return latest
        ? `Принято: ${latest}`
        : "Я на связи. Повторите, пожалуйста, ваш вопрос.";
    }

    const systemPrompt = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content.trim())
      .filter(Boolean)
      .join("\n\n");

    const conversation = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: mapRole(message.role),
        parts: [{ text: message.content }],
      }));

    const contents =
      conversation.length > 0
        ? conversation
        : [{ role: "user" as const, parts: [{ text: "" }] }];

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
      },
    };

    if (systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: systemPrompt }],
      };
    }

    const response = await generateGeminiContent({
      apiKey,
      model,
      body,
    });

    const text = extractGeminiText(response)?.trim();
    return (
      text || "Извините, не удалось сформировать ответ. Повторите ваш запрос."
    );
  }

  async healthcheck(): Promise<{
    ok: boolean;
    provider: string;
    details?: Record<string, unknown>;
  }> {
    const apiKey =
      (await this.config.getApiKey()) ?? env.GEMINI_API_KEY ?? env.LLM_API_KEY ?? null;

    if (!apiKey) {
      return {
        ok: true,
        provider: "gemini-llm-fallback",
        details: {
          mode: "no_api_key_mock_reply",
        },
      };
    }

    const model = await this.config.getModel();
    return checkGeminiModel({
      apiKey,
      model,
      provider: "gemini-llm",
    });
  }
}
