import { env } from "@/common/env.js";
import type {
  InboundCallEvent,
  OutboundCallStartInput,
  OutboundCallStartResult,
  ProviderHealth,
} from "@/providers/types.js";
import type { TelephonyProvider } from "@/providers/telephony.provider.js";

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(
  source: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

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

  async startOutboundCall(
    input: OutboundCallStartInput,
  ): Promise<OutboundCallStartResult> {
    const accountId = (
      input.credentials?.accountId ??
      env.VOXIMPLANT_ACCOUNT_ID ??
      ""
    ).trim();
    const apiKey = (input.credentials?.apiKey ?? env.VOXIMPLANT_API_KEY ?? "").trim();
    const apiSecret = (
      input.credentials?.apiSecret ??
      env.VOXIMPLANT_API_SECRET ??
      ""
    ).trim();

    if (!accountId || !apiKey) {
      throw new Error("VOXIMPLANT_CREDENTIALS_MISSING");
    }

    if (!input.ruleId?.trim()) {
      throw new Error("VOXIMPLANT_OUTBOUND_RULE_ID_MISSING");
    }

    const scriptPayload: Record<string, unknown> = {
      direction: "outbound",
      to: input.to,
      from: input.from ?? undefined,
      assistant_id: input.assistantId ?? undefined,
      metadata: input.metadata ?? {},
    };

    const form = new URLSearchParams();
    form.set("account_id", accountId);
    form.set("api_key", apiKey);
    form.set("rule_id", input.ruleId.trim());
    form.set("script_custom_data", JSON.stringify(scriptPayload));
    if (apiSecret) {
      // Old accounts may still require api_secret auth mode.
      form.set("api_secret", apiSecret);
    }

    const response = await fetch(
      "https://api.voximplant.com/platform_api/StartScenarios/",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
    );

    const rawText = await response.text();
    const parsed = asObject(
      (() => {
        try {
          return JSON.parse(rawText) as unknown;
        } catch {
          return { raw: rawText };
        }
      })(),
    );

    if (!response.ok || parsed.error) {
      const message =
        readString(asObject(parsed.error), ["msg", "message"]) ??
        readString(parsed, ["error", "message"]) ??
        "VOXIMPLANT_START_SCENARIO_FAILED";
      throw new Error(message);
    }

    return {
      provider: "voximplant",
      requestId: readString(parsed, ["request_id", "requestId"]),
      raw: parsed,
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
