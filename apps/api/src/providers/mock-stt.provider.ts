import type {
  ProviderHealth,
  SpeechToTextProvider,
  SttTranscribeInput,
} from "@/providers/types.js";

export class MockSpeechToTextProvider implements SpeechToTextProvider {
  async transcribeTurn(input: SttTranscribeInput): Promise<string> {
    if (input.hintedText) {
      return input.hintedText.trim();
    }

    if (input.audioBase64) {
      return "[voice input received]";
    }

    return "";
  }

  async finalize(_callId: string): Promise<void> {
    return;
  }

  async healthcheck(): Promise<ProviderHealth> {
    return { ok: true, provider: "mock-stt" };
  }
}
