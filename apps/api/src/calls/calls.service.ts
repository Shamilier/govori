import type { Prisma, PrismaClient } from "@prisma/client";
import { toNumber } from "@/common/number.js";
import type { CallsQuery } from "@/calls/calls.schemas.js";

function asObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export class CallsService {
  constructor(private readonly prisma: PrismaClient) {}

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
}
