import type { Call, CallMessage, PrismaClient, Prisma } from "@prisma/client";
import { CallCategory } from "@prisma/client";
import type { IntegrationsService } from "@/integrations/integrations.service.js";
import {
  extractGeminiText,
  generateGeminiContent,
} from "@/providers/gemini.shared.js";
import { env } from "@/common/env.js";

type CallWithMessages = Call & { messages: CallMessage[] };

const SHORT_CALL_DURATION_SEC = 10;
const TRANSCRIPT_CHAR_LIMIT = 8000;
const CLASSIFICATION_MODEL =
  env.GEMINI_LLM_MODEL?.trim() || "gemini-2.5-flash";

const SYSTEM_PROMPT = `Ты аналитик звонков. На вход получишь транскрипт телефонного разговора голосового бота с клиентом (холодный обзвон или входящий звонок).

Твоя задача — классифицировать звонок и выдать СТРОГО валидный JSON.

Поля:
- category: одно из "HOT" | "WARM" | "COLD" | "NO_ANSWER"
- summary: 1-2 коротких предложения на русском по сути разговора. Без воды, без вступлений.
- next_step: одно конкретное действие на русском, что делать менеджеру дальше. Начинается с эмодзи (📞 ✉️ ⏰ ❌ 🔁) и глагола.
- lead_name: имя клиента, если он его назвал. Иначе null.

Категории:
- HOT — клиент согласился на следующий шаг: звонок специалиста/инженера, встречу, конкретное время, дал контакт, согласился получить КП с обязательством обсудить, проявил конкретное желание купить/попробовать.
- WARM — клиент проявил интерес, но просит время: посоветоваться с супругом, перезвонить позже, нет бюджета сейчас, попросил КП без обязательств.
- COLD — клиент отказался, не интересно, попросил не звонить, бросил трубку посреди разговора без согласия.
- NO_ANSWER — клиент не взял трубку, или связь оборвалась сразу, или в транскрипте нет реплик клиента вовсе.

Правила:
- Игнорируй вежливые фразы клиента ("спасибо", "до свидания") — они не означают интерес.
- Если клиент сказал "перезвоните позже" без обсуждения сути — это WARM, не HOT.
- Если клиент явно сказал "не интересно", "не звоните" — это COLD, даже если разговор был длинный.
- next_step должен быть КОНКРЕТНЫМ: не "связаться", а "📞 Передать инженеру → звонок сегодня после 15:00".

Отвечай ТОЛЬКО JSON без markdown-обёртки, без \`\`\`, без комментариев.`;

export type ClassificationResult = {
  category: CallCategory;
  summary: string;
  nextStep: string;
  leadName: string | null;
};

function buildTranscript(call: CallWithMessages): string {
  const lines: string[] = [];
  for (const message of call.messages) {
    const role =
      message.role === "ASSISTANT"
        ? "Бот"
        : message.role === "USER"
          ? "Клиент"
          : message.role === "TOOL"
            ? "Инструмент"
            : "Система";
    const text = message.text.replace(/\s+/g, " ").trim();
    if (text) {
      lines.push(`${role}: ${text}`);
    }
  }

  const joined = lines.join("\n");
  if (joined.length <= TRANSCRIPT_CHAR_LIMIT) {
    return joined;
  }

  return joined.slice(0, TRANSCRIPT_CHAR_LIMIT) + "\n[...обрезано]";
}

function fallbackNoAnswer(reason: string): ClassificationResult {
  return {
    category: CallCategory.NO_ANSWER,
    summary: reason,
    nextStep: "🔁 Перенабрать позже",
    leadName: null,
  };
}

function fallbackCold(reason: string): ClassificationResult {
  return {
    category: CallCategory.COLD,
    summary: reason,
    nextStep: "❌ Закрыть лид",
    leadName: null,
  };
}

function parseClassification(text: string): ClassificationResult | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  const rawCategory =
    typeof obj.category === "string" ? obj.category.toUpperCase() : "";

  const validCategories = new Set<string>([
    "HOT",
    "WARM",
    "COLD",
    "NO_ANSWER",
  ]);
  if (!validCategories.has(rawCategory)) {
    return null;
  }

  const summary =
    typeof obj.summary === "string" ? obj.summary.trim() : "";
  const nextStep =
    typeof obj.next_step === "string"
      ? obj.next_step.trim()
      : typeof obj.nextStep === "string"
        ? obj.nextStep.trim()
        : "";
  const leadName =
    typeof obj.lead_name === "string" && obj.lead_name.trim().length > 0
      ? obj.lead_name.trim()
      : typeof obj.leadName === "string" && obj.leadName.trim().length > 0
        ? obj.leadName.trim()
        : null;

  if (!summary || !nextStep) {
    return null;
  }

  return {
    category: rawCategory as CallCategory,
    summary,
    nextStep,
    leadName,
  };
}

export class CallClassificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly integrationsService: IntegrationsService,
  ) {}

  /**
   * Classify a single call and persist the result.
   * Idempotent: if classifiedAt is already set, returns existing classification.
   * Safe to call from fire-and-forget contexts.
   */
  async classifyCall(callId: string): Promise<ClassificationResult | null> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: {
        messages: { orderBy: { sequenceNo: "asc" } },
      },
    });

    if (!call) {
      return null;
    }

    if (call.classifiedAt && call.category) {
      return {
        category: call.category,
        summary: call.summaryText ?? "",
        nextStep: call.nextStep ?? "",
        leadName: call.leadName,
      };
    }

    const result = await this.computeClassification(call);
    await this.persist(callId, result);
    return result;
  }

  private async computeClassification(
    call: CallWithMessages,
  ): Promise<ClassificationResult> {
    // Hard rules first — cheap and fast
    const userMessages = call.messages.filter((m) => m.role === "USER");
    const durationSec = call.durationSec ?? 0;

    if (call.status === "FAILED") {
      return fallbackNoAnswer("Звонок не состоялся (техническая ошибка).");
    }

    if (userMessages.length === 0) {
      return fallbackNoAnswer("Клиент не взял трубку или не произнёс ни слова.");
    }

    if (durationSec > 0 && durationSec < SHORT_CALL_DURATION_SEC) {
      return fallbackNoAnswer(
        `Разговор длился ${durationSec} сек — клиент сразу повесил трубку.`,
      );
    }

    // LLM classification for everything else
    const integrations = await this.integrationsService.getDecryptedForTenant(
      call.tenantId,
    );
    const apiKey = integrations.gemini.apiKey ?? env.GEMINI_API_KEY ?? "";
    if (!apiKey) {
      return fallbackCold(
        "Классификация недоступна (нет API-ключа Gemini). Проверьте транскрипт вручную.",
      );
    }

    const transcript = buildTranscript(call);
    const userPrompt = `Транскрипт звонка (длительность ${durationSec} сек):\n\n${transcript}\n\nКлассифицируй и верни JSON.`;

    try {
      const response = await generateGeminiContent({
        apiKey,
        model: CLASSIFICATION_MODEL,
        body: {
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 400,
            responseMimeType: "application/json",
          },
        },
      });

      const text = extractGeminiText(response);
      if (!text) {
        return fallbackCold("LLM не вернула ответ. Посмотрите расшифровку.");
      }

      const parsed = parseClassification(text);
      if (!parsed) {
        return fallbackCold(
          `LLM вернула невалидный JSON. Посмотрите расшифровку. Сырой ответ: ${text.slice(0, 200)}`,
        );
      }
      return parsed;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown error";
      return fallbackCold(
        `Ошибка классификации (${message}). Посмотрите расшифровку.`,
      );
    }
  }

  private async persist(
    callId: string,
    result: ClassificationResult,
  ): Promise<void> {
    const data: Prisma.CallUpdateInput = {
      category: result.category,
      summaryText: result.summary,
      nextStep: result.nextStep,
      leadName: result.leadName,
      classifiedAt: new Date(),
    };

    await this.prisma.call.update({
      where: { id: callId },
      data,
    });
  }
}
