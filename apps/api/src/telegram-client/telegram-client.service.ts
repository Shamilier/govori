import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "@/common/env.js";
import type { IntegrationsService } from "@/integrations/integrations.service.js";
import type {
  TelegramClientStartCampaignInput,
  TelegramClientUpdatePromptInput,
  TelegramClientUpdateVoiceInput,
} from "@/telegram-client/telegram-client.schemas.js";
import type { PrismaClient } from "@prisma/client";
import type { TelephonyProvider } from "@/providers/telephony.provider.js";

function normalizePhone(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/[^\d+]/g, "").trim();
  if (!cleaned) {
    return null;
  }

  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  if (/^\d+$/.test(cleaned)) {
    if (cleaned.length === 11 && cleaned.startsWith("8")) {
      return `+7${cleaned.slice(1)}`;
    }
    return `+${cleaned}`;
  }

  return null;
}

type TelegramBinding = {
  tenantId: string;
  telegramUserId: number;
  boundAgentId: string | null;
};

type VoximplantServiceAccount = {
  account_id?: string | number;
  key_id?: string;
  private_key?: string;
};

type RecordingDownloadResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
};

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export class TelegramClientService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly integrationsService: IntegrationsService,
    private readonly telephonyProvider: TelephonyProvider,
  ) {}

  async getState(telegramUserId: number): Promise<Record<string, unknown>> {
    const binding = await this.resolveBinding(telegramUserId);
    const agent = await this.getOrCreateTenantAgent(
      binding.tenantId,
      binding.boundAgentId,
    );

    const calls = await this.prisma.call.findMany({
      where: { tenantId: binding.tenantId },
      orderBy: { startedAt: "desc" },
      take: 10,
      include: {
        messages: {
          orderBy: { sequenceNo: "asc" },
          take: 40,
        },
      },
    });

    return {
      tenantId: binding.tenantId,
      telegramUserId: binding.telegramUserId,
      boundAgentId: binding.boundAgentId,
      agent: {
        id: agent.id,
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        ttsVoiceId: agent.ttsVoiceId,
        language: agent.language,
        isActive: agent.isActive,
        updatedAt: agent.updatedAt,
      },
      recentCalls: calls.map((call) => {
        const recordingUrl = call.recordingUrl
          ? this.buildRecordingProxyUrl(call.id)
          : null;

        return {
          id: call.id,
          externalCallId: call.externalCallId,
          status: call.status,
          direction: call.direction,
          callerPhone: call.callerPhone,
          calleePhone: call.calleePhone,
          startedAt: call.startedAt,
          endedAt: call.endedAt,
          durationSec: call.durationSec,
          recordingUrl,
          transcriptText: call.transcriptText,
          messages: call.messages.map((message) => ({
            id: message.id,
            role: message.role,
            text: message.text,
            sequenceNo: message.sequenceNo,
            createdAt: message.createdAt,
          })),
        };
      }),
    };
  }

  async updatePrompt(
    input: TelegramClientUpdatePromptInput,
  ): Promise<Record<string, unknown>> {
    const binding = await this.resolveBinding(input.telegramUserId);
    const agent = await this.getOrCreateTenantAgent(
      binding.tenantId,
      binding.boundAgentId,
    );

    const updated = await this.prisma.agent.update({
      where: { id: agent.id },
      data: {
        systemPrompt: input.prompt,
      },
    });

    return {
      ok: true,
      tenantId: binding.tenantId,
      agent: {
        id: updated.id,
        name: updated.name,
        systemPrompt: updated.systemPrompt,
        updatedAt: updated.updatedAt,
      },
    };
  }

  async updateVoice(
    input: TelegramClientUpdateVoiceInput,
  ): Promise<Record<string, unknown>> {
    const binding = await this.resolveBinding(input.telegramUserId);
    const agent = await this.getOrCreateTenantAgent(
      binding.tenantId,
      binding.boundAgentId,
    );

    const updated = await this.prisma.agent.update({
      where: { id: agent.id },
      data: {
        ttsVoiceId: input.voiceId,
      },
    });

    return {
      ok: true,
      tenantId: binding.tenantId,
      agent: {
        id: updated.id,
        name: updated.name,
        ttsVoiceId: updated.ttsVoiceId,
        updatedAt: updated.updatedAt,
      },
    };
  }

  async startCampaign(
    input: TelegramClientStartCampaignInput,
  ): Promise<Record<string, unknown>> {
    const binding = await this.resolveBinding(input.telegramUserId);
    const agent = await this.getOrCreateTenantAgent(
      binding.tenantId,
      binding.boundAgentId,
    );
    const integrations = await this.integrationsService.getDecryptedForTenant(
      binding.tenantId,
    );

    const tenantNumber = await this.prisma.phoneNumber.findFirst({
      where: { tenantId: binding.tenantId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { e164: true },
    });

    const from =
      normalizePhone(input.from) ??
      normalizePhone(tenantNumber?.e164) ??
      normalizePhone(integrations.phoneNumberE164) ??
      normalizePhone(env.PHONE_NUMBER_E164) ??
      null;

    const ruleId =
      input.ruleId?.trim() ||
      integrations.voximplant.outboundRuleId?.trim() ||
      env.VOXIMPLANT_OUTBOUND_RULE_ID?.trim();
    if (!ruleId) {
      throw new Error("OUTBOUND_RULE_NOT_CONFIGURED");
    }

    const assistantId = from ?? "default";
    const started: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];

    const uniqueNumbers = Array.from(new Set(input.numbers));

    for (const number of uniqueNumbers) {
      try {
        const result = await this.telephonyProvider.startOutboundCall({
          to: number,
          from,
          assistantId,
          ruleId,
          metadata: {
            source: "telegram",
            tenantId: binding.tenantId,
            telegramUserId: input.telegramUserId,
          },
          credentials: {
            accountId: integrations.voximplant.accountId,
            apiKey: integrations.voximplant.apiKey,
            apiSecret: integrations.voximplant.apiSecret,
          },
        });

        started.push({
          to: number,
          provider: result.provider,
          requestId: result.requestId ?? null,
          raw: result.raw ?? null,
        });
      } catch (error) {
        failed.push({
          to: number,
          error: error instanceof Error ? error.message : "START_FAILED",
        });
      }
    }

    return {
      ok: true,
      tenantId: binding.tenantId,
      agentId: agent.id,
      total: uniqueNumbers.length,
      started: started.length,
      failed: failed.length,
      from,
      ruleId,
      items: {
        started,
        failed,
      },
    };
  }

  async downloadRecording(
    callId: string,
    token: string,
    range?: string,
  ): Promise<RecordingDownloadResult> {
    if (!this.verifyRecordingToken(callId, token)) {
      throw new Error("INVALID_RECORDING_TOKEN");
    }

    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      select: {
        recordingUrl: true,
        externalCallId: true,
      },
    });

    if (!call?.recordingUrl) {
      throw new Error("RECORDING_NOT_FOUND");
    }

    const authHeader = this.buildVoximplantRecordingAuthHeader();
    if (!authHeader) {
      throw new Error("VOXIMPLANT_RECORDING_AUTH_NOT_CONFIGURED");
    }

    const headers: Record<string, string> = {
      authorization: authHeader,
    };
    if (range?.trim()) {
      headers.range = range.trim();
    }

    const response = await fetch(call.recordingUrl, { headers });
    const body = Buffer.from(await response.arrayBuffer());

    if (!response.ok) {
      throw new Error(`VOXIMPLANT_RECORDING_FETCH_FAILED_${response.status}`);
    }

    const responseHeaders: Record<string, string> = {
      "content-type":
        response.headers.get("content-type") ?? "audio/mpeg",
      "content-disposition": `inline; filename="${call.externalCallId}.mp3"`,
    };

    for (const header of ["content-length", "content-range", "accept-ranges"]) {
      const value = response.headers.get(header);
      if (value) {
        responseHeaders[header] = value;
      }
    }

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body,
    };
  }

  private async resolveBinding(
    telegramUserId: number,
  ): Promise<TelegramBinding> {
    const binding = await this.prisma.telegramBinding.findUnique({
      where: { telegramUserId: BigInt(telegramUserId) },
      select: {
        tenantId: true,
        boundAgentId: true,
      },
    });

    if (!binding) {
      throw new Error("TELEGRAM_BINDING_NOT_FOUND");
    }

    return {
      tenantId: binding.tenantId,
      telegramUserId,
      boundAgentId: binding.boundAgentId,
    };
  }

  private async getOrCreateTenantAgent(
    tenantId: string,
    boundAgentId?: string | null,
  ) {
    if (boundAgentId) {
      const boundAgent = await this.prisma.agent.findFirst({
        where: { id: boundAgentId, tenantId },
      });

      if (!boundAgent) {
        throw new Error("BOUND_AGENT_NOT_FOUND");
      }

      return boundAgent;
    }

    const existing =
      (await this.prisma.agent.findFirst({
        where: { tenantId, isActive: true },
        orderBy: { createdAt: "asc" },
      })) ??
      (await this.prisma.agent.findFirst({
        where: { tenantId },
        orderBy: { createdAt: "asc" },
      }));

    if (existing) {
      return existing;
    }

    return this.prisma.agent.create({
      data: {
        tenantId,
        name: "Main Voice Agent",
        systemPrompt: "Ты голосовой AI-агент. Отвечай кратко и вежливо.",
        greetingText: "Здравствуйте! Чем могу помочь?",
        fallbackText: "Извините, повторите, пожалуйста.",
        goodbyeText: "Спасибо за звонок. До свидания!",
        language: "ru-RU",
        ttsVoiceId: "Kore",
      },
    });
  }

  private buildRecordingProxyUrl(callId: string): string {
    const publicBaseUrl = (
      env.PUBLIC_API_BASE_URL ||
      env.WEB_ORIGIN ||
      ""
    ).replace(/\/+$/, "");
    const token = this.createRecordingToken(callId);

    return `${publicBaseUrl}/api/telegram/client/calls/${encodeURIComponent(
      callId,
    )}/recording?token=${encodeURIComponent(token)}`;
  }

  private createRecordingToken(callId: string): string {
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const signature = crypto
      .createHmac("sha256", env.JWT_SECRET)
      .update(`${callId}.${expiresAt}`)
      .digest("base64url");

    return `${expiresAt}.${signature}`;
  }

  private verifyRecordingToken(callId: string, token: string): boolean {
    const [expiresAtRaw, signature] = token.split(".");
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || !signature) {
      return false;
    }

    if (expiresAt <= Math.floor(Date.now() / 1000)) {
      return false;
    }

    const expected = crypto
      .createHmac("sha256", env.JWT_SECRET)
      .update(`${callId}.${expiresAt}`)
      .digest("base64url");
    if (signature.length !== expected.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  }

  private buildVoximplantRecordingAuthHeader(): string | null {
    const explicitHeader = env.VOXIMPLANT_RECORDING_AUTH_HEADER?.trim();
    if (explicitHeader) {
      return explicitHeader;
    }

    const serviceAccount = this.readVoximplantServiceAccount();
    if (!serviceAccount) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(
      JSON.stringify({
        alg: "RS256",
        typ: "JWT",
        kid: serviceAccount.key_id,
      }),
    );
    const payload = base64Url(
      JSON.stringify({
        iss: String(serviceAccount.account_id),
        iat: now,
        exp: now + 64,
      }),
    );
    const signingInput = `${header}.${payload}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = base64Url(signer.sign(serviceAccount.private_key));

    return `Bearer ${signingInput}.${signature}`;
  }

  private readVoximplantServiceAccount(): Required<VoximplantServiceAccount> | null {
    const raw =
      env.VOXIMPLANT_SERVICE_ACCOUNT_JSON?.trim() ||
      (env.VOXIMPLANT_SERVICE_ACCOUNT_KEY_PATH
        ? readFileSync(env.VOXIMPLANT_SERVICE_ACCOUNT_KEY_PATH, "utf8")
        : "");

    if (!raw) {
      return null;
    }

    const parsed = this.parseServiceAccountJson(raw);
    if (!parsed?.account_id || !parsed.key_id || !parsed.private_key) {
      return null;
    }

    return {
      account_id: parsed.account_id,
      key_id: parsed.key_id,
      private_key: parsed.private_key,
    };
  }

  private parseServiceAccountJson(
    raw: string,
  ): VoximplantServiceAccount | null {
    for (const candidate of [
      raw,
      Buffer.from(raw, "base64").toString("utf8"),
    ]) {
      try {
        const parsed = JSON.parse(candidate) as VoximplantServiceAccount;
        return parsed;
      } catch {
        // Try the next representation.
      }
    }

    return null;
  }
}
