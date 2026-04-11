import { env } from "@/common/env.js";
import {
  buildWavFromPcm16Mono,
  checkGeminiModel,
  extractGeminiInlineAudio,
  generateGeminiContent,
  resamplePcm16Mono,
} from "@/providers/gemini.shared.js";
import type {
  ProviderHealth,
  TtsProvider,
  TtsSynthesizeInput,
  TtsSynthesizeOutput,
} from "@/providers/types.js";

export type GeminiTtsProviderConfig = {
  getApiKey: () => Promise<string | null>;
  getVoiceId: () => Promise<string | null>;
  getModelId: () => Promise<string>;
};

function buildFallbackTone(durationMs: number, sampleRate: number): Buffer {
  const samples = Math.max(1, Math.floor((durationMs / 1000) * sampleRate));
  const pcm = Buffer.alloc(samples * 2);
  const frequency = 440;

  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * 0.18;
    pcm.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }

  return buildWavFromPcm16Mono(pcm, sampleRate);
}

export class GeminiTtsProvider implements TtsProvider {
  constructor(private readonly config: GeminiTtsProviderConfig) {}

  async synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeOutput> {
    const startedAt = Date.now();
    const targetSampleRate = input.sampleRate ?? 8000;

    const apiKey =
      input.apiKey ??
      (await this.config.getApiKey()) ??
      env.GEMINI_API_KEY ??
      env.CARTESIA_API_KEY ??
      env.LLM_API_KEY ??
      null;

    const voiceId =
      input.voiceId ??
      (await this.config.getVoiceId()) ??
      env.GEMINI_TTS_VOICE ??
      env.CARTESIA_VOICE_ID ??
      "Kore";

    const modelId =
      input.modelId ??
      (await this.config.getModelId()) ??
      env.GEMINI_TTS_MODEL;

    if (!apiKey) {
      const durationMs = Math.max(500, Math.min(2000, input.text.length * 35));
      return {
        audio: buildFallbackTone(durationMs, targetSampleRate),
        contentType: "audio/wav",
        durationMs,
      };
    }

    const response = await generateGeminiContent({
      apiKey,
      model: modelId,
      body: {
        contents: [
          {
            parts: [{ text: input.text }],
          },
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voiceId,
              },
            },
          },
        },
      },
    });

    const inlineAudio = extractGeminiInlineAudio(response);
    if (!inlineAudio) {
      throw new Error("Gemini TTS returned no audio payload");
    }

    // Gemini TTS returns raw PCM (s16le, mono, 24kHz). Convert to target wav.
    const sourceSampleRate = 24000;
    const resampled = resamplePcm16Mono(
      inlineAudio.data,
      sourceSampleRate,
      targetSampleRate,
    );

    return {
      audio: buildWavFromPcm16Mono(resampled, targetSampleRate),
      contentType: "audio/wav",
      durationMs: Math.max(1, Date.now() - startedAt),
    };
  }

  async validateVoice(voiceId: string): Promise<boolean> {
    return voiceId.trim().length > 0;
  }

  async healthcheck(): Promise<ProviderHealth> {
    const apiKey =
      (await this.config.getApiKey()) ??
      env.GEMINI_API_KEY ??
      env.CARTESIA_API_KEY ??
      env.LLM_API_KEY ??
      null;

    if (!apiKey) {
      return {
        ok: true,
        provider: "gemini-tts-fallback",
        details: {
          mode: "no_api_key_fallback_wav",
        },
      };
    }

    const model = await this.config.getModelId();
    return checkGeminiModel({
      apiKey,
      model,
      provider: "gemini-tts",
    });
  }
}
