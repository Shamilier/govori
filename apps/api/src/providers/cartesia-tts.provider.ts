import { env } from "@/common/env.js";
import type {
  ProviderHealth,
  TtsProvider,
  TtsSynthesizeInput,
  TtsSynthesizeOutput,
} from "@/providers/types.js";

export type CartesiaProviderConfig = {
  getApiKey: () => Promise<string | null>;
  getVoiceId: () => Promise<string | null>;
  getModelId: () => Promise<string>;
};

function buildFallbackWav(durationMs: number, sampleRate: number): Buffer {
  const samples = Math.floor((durationMs / 1000) * sampleRate);
  const dataSize = samples * 2;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  const pcm = Buffer.alloc(dataSize);
  const frequency = 440;
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * 0.2;
    pcm.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }

  return Buffer.concat([header, pcm]);
}

export class CartesiaTtsProvider implements TtsProvider {
  constructor(private readonly config: CartesiaProviderConfig) {}

  async synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeOutput> {
    const started = Date.now();
    const sampleRate = input.sampleRate ?? 8000;
    const apiKey =
      input.apiKey ??
      (await this.config.getApiKey()) ??
      env.CARTESIA_API_KEY ??
      null;
    const voiceId =
      input.voiceId ??
      (await this.config.getVoiceId()) ??
      env.CARTESIA_VOICE_ID ??
      "default";
    const modelId = input.modelId ?? (await this.config.getModelId());

    if (!apiKey) {
      const durationMs = Math.max(500, Math.min(2000, input.text.length * 35));
      return {
        audio: buildFallbackWav(durationMs, sampleRate),
        contentType: "audio/wav",
        durationMs,
      };
    }

    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "Cartesia-Version": "2024-06-10",
      },
      body: JSON.stringify({
        model_id: modelId,
        transcript: input.text,
        voice: { mode: "id", id: voiceId },
        language: input.language ?? "ru",
        speed: input.speed ?? 1,
        output_format: {
          container: "wav",
          encoding: "pcm_s16le",
          sample_rate: sampleRate,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Cartesia synthesize failed (${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      audio: Buffer.from(arrayBuffer),
      contentType: "audio/wav",
      durationMs: Date.now() - started,
    };
  }

  async validateVoice(voiceId: string): Promise<boolean> {
    return voiceId.trim().length > 0;
  }

  async healthcheck(): Promise<ProviderHealth> {
    const apiKey =
      (await this.config.getApiKey()) ?? env.CARTESIA_API_KEY ?? null;
    if (!apiKey) {
      return {
        ok: true,
        provider: "cartesia-fallback",
        details: {
          mode: "no_api_key_fallback_wav",
        },
      };
    }

    const response = await fetch("https://api.cartesia.ai/voices", {
      headers: {
        "X-API-Key": apiKey,
        "Cartesia-Version": "2024-06-10",
      },
    });

    return {
      ok: response.ok,
      provider: "cartesia",
      details: { status: response.status },
    };
  }
}
