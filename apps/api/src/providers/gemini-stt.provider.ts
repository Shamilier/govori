import { env } from "@/common/env.js";
import {
  checkGeminiModel,
  extractGeminiText,
  generateGeminiContent,
} from "@/providers/gemini.shared.js";
import type {
  ProviderHealth,
  SpeechToTextProvider,
  SttTranscribeInput,
} from "@/providers/types.js";

export type GeminiSttProviderConfig = {
  getApiKey: () => Promise<string | null>;
  getModel: () => Promise<string>;
};

export class GeminiSpeechToTextProvider implements SpeechToTextProvider {
  constructor(private readonly config: GeminiSttProviderConfig) {}

  async transcribeTurn(input: SttTranscribeInput): Promise<string> {
    if (input.hintedText) {
      return input.hintedText.trim();
    }

    if (!input.audioBase64) {
      return "";
    }

    const apiKey =
      input.apiKey ??
      (await this.config.getApiKey()) ??
      env.GEMINI_API_KEY ??
      env.STT_API_KEY ??
      env.LLM_API_KEY ??
      null;

    const model =
      input.modelId ?? (await this.config.getModel()) ?? env.GEMINI_STT_MODEL;

    if (!apiKey) {
      return "[voice input received]";
    }

    try {
      const response = await generateGeminiContent({
        apiKey,
        model,
        body: {
          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                    `Generate a transcript of the speech. ` +
                    `Return only transcript text in ${input.language ?? "ru-RU"}.`,
                },
                {
                  inlineData: {
                    mimeType: input.mimeType ?? "audio/wav",
                    data: input.audioBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1024,
          },
        },
      });

      const text = extractGeminiText(response)?.trim();
      return text && text.length > 0 ? text : "[voice input received]";
    } catch {
      return "[voice input received]";
    }
  }

  async finalize(_callId: string): Promise<void> {
    return;
  }

  async healthcheck(): Promise<ProviderHealth> {
    const apiKey =
      (await this.config.getApiKey()) ??
      env.GEMINI_API_KEY ??
      env.STT_API_KEY ??
      env.LLM_API_KEY ??
      null;

    if (!apiKey) {
      return {
        ok: true,
        provider: "gemini-stt-fallback",
        details: {
          mode: "no_api_key_mock_transcript",
        },
      };
    }

    const model = await this.config.getModel();
    return checkGeminiModel({
      apiKey,
      model,
      provider: "gemini-stt",
    });
  }
}
