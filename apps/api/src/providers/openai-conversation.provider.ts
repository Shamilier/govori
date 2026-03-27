import { env } from "@/common/env.js";
import type {
  ConversationModelProvider,
  ConversationModelRequest,
} from "@/providers/conversation-model.provider.js";

export type OpenAIProviderConfig = {
  getApiKey: () => Promise<string | null>;
  getModel: () => Promise<string>;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export class OpenAIConversationProvider implements ConversationModelProvider {
  constructor(private readonly config: OpenAIProviderConfig) {}

  async generate(request: ConversationModelRequest): Promise<string> {
    const apiKey =
      request.apiKey ?? (await this.config.getApiKey()) ?? env.LLM_API_KEY ?? null;
    const model = await this.config.getModel();

    if (!apiKey) {
      const latest = request.messages.at(-1)?.content ?? "";
      return latest
        ? `Принято: ${latest}`
        : "Я на связи. Повторите, пожалуйста, ваш вопрос.";
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model ?? model,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed (${response.status})`);
    }

    const json = (await response.json()) as ChatCompletionResponse;
    const text = json.choices?.[0]?.message?.content?.trim();
    return (
      text || "Извините, не удалось сформировать ответ. Повторите ваш запрос."
    );
  }

  async healthcheck(): Promise<{
    ok: boolean;
    provider: string;
    details?: Record<string, unknown>;
  }> {
    const apiKey = (await this.config.getApiKey()) ?? env.LLM_API_KEY ?? null;
    if (!apiKey) {
      return {
        ok: true,
        provider: "openai-fallback",
        details: { mode: "no_api_key_mock_reply" },
      };
    }

    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    return {
      ok: response.ok,
      provider: "openai",
      details: {
        status: response.status,
      },
    };
  }
}
