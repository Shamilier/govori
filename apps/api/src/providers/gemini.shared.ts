export type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          data?: string;
          mimeType?: string;
        };
        inline_data?: {
          data?: string;
          mime_type?: string;
        };
      }>;
    };
  }>;
};

export async function generateGeminiContent(params: {
  apiKey: string;
  model: string;
  body: Record<string, unknown>;
}): Promise<GeminiGenerateContentResponse> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      params.model,
    )}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": params.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params.body),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Gemini generateContent failed (${response.status}): ${detail.slice(0, 500)}`,
    );
  }

  return (await response.json()) as GeminiGenerateContentResponse;
}

export function extractGeminiText(
  payload: GeminiGenerateContentResponse,
): string | null {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const chunks = parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .map((text) => text.trim())
    .filter(Boolean);

  if (chunks.length === 0) {
    return null;
  }

  return chunks.join("\n");
}

export function extractGeminiInlineAudio(
  payload: GeminiGenerateContentResponse,
): { data: Buffer; mimeType: string } | null {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];

  for (const part of parts) {
    const inline = part.inlineData;
    if (inline?.data) {
      return {
        data: Buffer.from(inline.data, "base64"),
        mimeType: inline.mimeType ?? "audio/pcm",
      };
    }

    const inlineLegacy = part.inline_data;
    if (inlineLegacy?.data) {
      return {
        data: Buffer.from(inlineLegacy.data, "base64"),
        mimeType: inlineLegacy.mime_type ?? "audio/pcm",
      };
    }
  }

  return null;
}

export function buildWavFromPcm16Mono(
  pcm: Buffer,
  sampleRate: number,
): Buffer {
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
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
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

export function resamplePcm16Mono(
  pcm: Buffer,
  fromRate: number,
  toRate: number,
): Buffer {
  if (fromRate === toRate) {
    return pcm;
  }

  if (pcm.length < 2) {
    return pcm;
  }

  const input = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const outputLength = Math.max(1, Math.floor((input.length * toRate) / fromRate));
  const output = Buffer.alloc(outputLength * 2);

  for (let i = 0; i < outputLength; i += 1) {
    const src = (i * fromRate) / toRate;
    const left = Math.floor(src);
    const right = Math.min(input.length - 1, left + 1);
    const mix = src - left;
    const sample = Math.round(input[left] * (1 - mix) + input[right] * mix);
    output.writeInt16LE(sample, i * 2);
  }

  return output;
}

export async function checkGeminiModel(params: {
  apiKey: string;
  model: string;
  provider: string;
}): Promise<{
  ok: boolean;
  provider: string;
  details?: Record<string, unknown>;
}> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      params.model,
    )}`,
    {
      headers: {
        "x-goog-api-key": params.apiKey,
      },
    },
  );

  return {
    ok: response.ok,
    provider: params.provider,
    details: {
      status: response.status,
      model: params.model,
    },
  };
}
