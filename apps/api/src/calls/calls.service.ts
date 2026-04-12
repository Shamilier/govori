import type { Prisma, PrismaClient } from "@prisma/client";
import { env } from "@/common/env.js";
import { toNumber } from "@/common/number.js";
import type {
  CallsQuery,
  StartOutboundCallInput,
} from "@/calls/calls.schemas.js";
import type { IntegrationsService } from "@/integrations/integrations.service.js";
import type { TelephonyProvider } from "@/providers/telephony.provider.js";

function asObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

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

type CallsServiceDeps = {
  telephonyProvider?: TelephonyProvider;
  integrationsService?: IntegrationsService;
};

export class CallsService {
  private readonly telephonyProvider?: TelephonyProvider;
  private readonly integrationsService?: IntegrationsService;

  constructor(
    private readonly prisma: PrismaClient,
    deps: CallsServiceDeps = {},
  ) {
    this.telephonyProvider = deps.telephonyProvider;
    this.integrationsService = deps.integrationsService;
  }

  async list(query: CallsQuery): Promise<Record<string, unknown>> {
    const where: Prisma.CallWhereInput = {};

    if (query.status) {
      where.status =
        query.status.toUpperCase() as Prisma.EnumCallStatusFilter["equals"];
    }

    if (query.phone) {
      where.OR = [
        { callerPhone: { contains: query.phone } },
        { calleePhone: { contains: query.phone } },
      ];
    }

    if (query.dateFrom || query.dateTo) {
      where.startedAt = {
        gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
        lte: query.dateTo ? new Date(query.dateTo) : undefined,
      };
    }

    const calls = await this.prisma.call.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: query.limit,
    });

    return {
      items: calls.map((call) => {
        const outcome = asObject(call.outcomeJson);
        return {
          id: call.id,
          externalCallId: call.externalCallId,
          callerPhone: call.callerPhone,
          calleePhone: call.calleePhone,
          status: call.status,
          startedAt: call.startedAt,
          endedAt: call.endedAt,
          durationSec: call.durationSec,
          summary: typeof outcome.summary === "string" ? outcome.summary : null,
          recordingUrl: call.recordingUrl,
        };
      }),
    };
  }

  async getById(id: string): Promise<Record<string, unknown> | null> {
    const call = await this.prisma.call.findUnique({
      where: { id },
      include: {
        events: {
          orderBy: { createdAt: "asc" },
        },
        messages: {
          orderBy: { sequenceNo: "asc" },
        },
        agent: true,
      },
    });

    if (!call) {
      return null;
    }

    return {
      id: call.id,
      externalCallId: call.externalCallId,
      status: call.status,
      direction: call.direction,
      callerPhone: call.callerPhone,
      calleePhone: call.calleePhone,
      startedAt: call.startedAt,
      answeredAt: call.answeredAt,
      endedAt: call.endedAt,
      durationSec: call.durationSec,
      recordingUrl: call.recordingUrl,
      transcriptText: call.transcriptText,
      outcome: call.outcomeJson,
      errorMessage: call.errorMessage,
      systemPromptSnapshot: call.systemPromptSnapshot,
      agent: {
        id: call.agent.id,
        name: call.agent.name,
        voiceId: call.agent.ttsVoiceId,
        isActive: call.agent.isActive,
      },
      timeline: call.events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        payload: event.payloadJson,
        createdAt: event.createdAt,
      })),
      transcript: call.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        sequenceNo: message.sequenceNo,
        startedAt: message.startedAt,
        createdAt: message.createdAt,
        meta: message.metaJson,
      })),
      responseTemperature: toNumber(call.agent.responseTemperature, 0.3),
    };
  }

  async getTranscript(id: string): Promise<Record<string, unknown> | null> {
    const call = await this.prisma.call.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { sequenceNo: "asc" },
        },
      },
    });

    if (!call) {
      return null;
    }

    return {
      id: call.id,
      status: call.status,
      transcript: call.messages.map((message) => ({
        role: message.role,
        text: message.text,
        sequenceNo: message.sequenceNo,
        createdAt: message.createdAt,
      })),
      aggregate: call.transcriptText,
    };
  }

  async startOutboundCall(
    adminId: string,
    input: StartOutboundCallInput,
  ): Promise<Record<string, unknown>> {
    if (!this.telephonyProvider || !this.integrationsService) {
      throw new Error("OUTBOUND_TELEPHONY_NOT_AVAILABLE");
    }

    const to = normalizePhone(input.to);
    if (!to) {
      throw new Error("INVALID_TO_PHONE");
    }

    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { tenantId: true },
    });
    const tenantId = admin?.tenantId ?? null;

    const integrations = tenantId
      ? await this.integrationsService.getDecryptedForTenant(tenantId)
      : await this.integrationsService.getDecrypted();

    const tenantNumber = tenantId
      ? await this.prisma.phoneNumber.findFirst({
          where: { tenantId, isActive: true },
          orderBy: { createdAt: "asc" },
          select: { e164: true },
        })
      : null;

    const from =
      normalizePhone(input.from) ??
      normalizePhone(tenantNumber?.e164) ??
      normalizePhone(integrations.phoneNumberE164) ??
      normalizePhone(env.PHONE_NUMBER_E164) ??
      null;

    const ruleId =
      input.ruleId?.trim() || env.VOXIMPLANT_OUTBOUND_RULE_ID?.trim() || "";
    if (!ruleId) {
      throw new Error("OUTBOUND_RULE_NOT_CONFIGURED");
    }

    const assistantId = input.assistantId?.trim() || from || "default";

    const started = await this.telephonyProvider.startOutboundCall({
      to,
      from,
      assistantId,
      ruleId,
      metadata: input.metadata,
      credentials: {
        accountId: integrations.voximplant.accountId,
        apiKey: integrations.voximplant.apiKey,
        apiSecret: integrations.voximplant.apiSecret,
      },
    });

    return {
      ok: true,
      provider: started.provider,
      requestId: started.requestId ?? null,
      to,
      from,
      assistantId,
      ruleId,
      raw: started.raw ?? null,
    };
  }
}
