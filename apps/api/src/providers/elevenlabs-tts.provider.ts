import { env } from "@/common/env.js";
import {
  buildWavFromPcm16Mono,
  resamplePcm16Mono,
} from "@/providers/gemini.shared.js";
import type {
  ProviderHealth,
  TtsProvider,
  TtsSynthesizeInput,
  TtsSynthesizeOutput,
} from "@/providers/types.js";

export type ElevenLabsTtsProviderConfig = {
  getApiKey: () => Promise<string | null>;
  getVoiceId: () => Promise<string | null>;
  getModelId: () => Promise<string>;
};

function resolvePcmFormat(sampleRate: number): {
  outputFormat: string;
  providerSampleRate: number;
} {
  if (sampleRate >= 22050) {
    return { outputFormat: "pcm_22050", providerSampleRate: 22050 };
  }

  return { outputFormat: "pcm_16000", providerSampleRate: 16000 };
}

function buildFallbackWav(durationMs: number, sampleRate: number): Buffer {
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

export class ElevenLabsTtsProvider implements TtsProvider {
  constructor(private readonly config: ElevenLabsTtsProviderConfig) {}

  async synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeOutput> {
    const startedAt = Date.now();
    const targetSampleRate = input.sampleRate ?? 8000;
    const apiKey =
      input.apiKey ??
      (await this.config.getApiKey()) ??
      env.ELEVENLABS_API_KEY ??
      null;
    const voiceId =
      input.voiceId ??
      (await this.config.getVoiceId()) ??
      env.ELEVENLABS_VOICE_ID ??
      "JBFqnCBsd6RMkjVDRZzb";
    const modelId =
      input.modelId ??
      (await this.config.getModelId()) ??
      env.ELEVENLABS_MODEL_ID;

    if (!apiKey) {
      const durationMs = Math.max(500, Math.min(2000, input.text.length * 35));
      return {
        audio: buildFallbackWav(durationMs, targetSampleRate),
        contentType: "audio/wav",
        durationMs,
      };
    }

    const pcmFormat = resolvePcmFormat(targetSampleRate);
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
        voiceId,
      )}/stream?output_format=${encodeURIComponent(pcmFormat.outputFormat)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "application/octet-stream",
        },
        body: JSON.stringify({
          text: input.text,
          model_id: modelId,
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `ElevenLabs synthesize failed (${response.status}): ${detail.slice(0, 500)}`,
      );
    }

    const pcm = Buffer.from(await response.arrayBuffer());
    const resampled =
      pcmFormat.providerSampleRate === targetSampleRate
        ? pcm
        : resamplePcm16Mono(
            pcm,
            pcmFormat.providerSampleRate,
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
      (await this.config.getApiKey()) ?? env.ELEVENLABS_API_KEY ?? null;

    if (!apiKey) {
      return {
        ok: true,
        provider: "elevenlabs-fallback",
        details: {
          mode: "no_api_key_fallback_wav",
        },
      };
    }

    const response = await fetch("https://api.elevenlabs.io/v1/models", {
      headers: {
        "xi-api-key": apiKey,
      },
    });

    return {
      ok: response.ok,
      provider: "elevenlabs",
      details: {
        status: response.status,
      },
    };
  }
}
