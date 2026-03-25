import { env } from "@/common/env.js";
import type { InboundCallEvent, ProviderHealth } from "@/providers/types.js";
import type { TelephonyProvider } from "@/providers/telephony.provider.js";

export class VoximplantTelephonyProvider implements TelephonyProvider {
  async handleInboundWebhook(
    payload: Record<string, unknown>,
  ): Promise<InboundCallEvent> {
    const externalCallId = String(
      payload.call_id ??
        payload.external_call_id ??
        payload.session_id ??
        crypto.randomUUID(),
    );

    return {
      externalCallId,
      callerPhone: payload.caller_number
        ? String(payload.caller_number)
        : undefined,
      calleePhone: payload.destination_number
        ? String(payload.destination_number)
        : env.PHONE_NUMBER_E164,
      providerPayload: payload,
    };
  }

  async answerCall(callId: string): Promise<void> {
    console.log(`[telephony] answerCall ${callId}`);
  }

  async playAudio(
    callId: string,
    _audio: Buffer,
    contentType: string,
  ): Promise<void> {
    console.log(`[telephony] playAudio ${callId} (${contentType})`);
  }

  async hangupCall(callId: string): Promise<void> {
    console.log(`[telephony] hangupCall ${callId}`);
  }

  async getRecording(_callId: string): Promise<string | null> {
    return null;
  }

  async healthcheck(): Promise<ProviderHealth> {
    return {
      ok: true,
      provider: "voximplant-adapter",
      details: {
        configured: Boolean(env.VOXIMPLANT_APPLICATION_ID),
      },
    };
  }
}
