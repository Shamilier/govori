import type { InboundCallEvent, ProviderHealth } from "@/providers/types.js";

export interface TelephonyProvider {
  handleInboundWebhook(
    payload: Record<string, unknown>,
  ): Promise<InboundCallEvent>;
  answerCall(callId: string): Promise<void>;
  playAudio(callId: string, audio: Buffer, contentType: string): Promise<void>;
  hangupCall(callId: string): Promise<void>;
  getRecording(callId: string): Promise<string | null>;
  healthcheck(): Promise<ProviderHealth>;
}
