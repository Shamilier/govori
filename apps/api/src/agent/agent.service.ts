import type { Agent, PrismaClient } from "@prisma/client";
import type { AuditService } from "@/audit/audit.service.js";
import type { UpdateAgentInput } from "@/agent/agent.schemas.js";
import { toNumber } from "@/common/number.js";
import type { TtsProvider } from "@/providers/types.js";
import type { ConversationService } from "@/calls/conversation.service.js";

export class AgentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly ttsProvider: TtsProvider,
    private readonly conversationService: ConversationService,
  ) {}

  private async getDefaultTenantId(): Promise<string> {
    const tenant =
      (await this.prisma.tenant.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
      })) ??
      (await this.prisma.tenant.create({
        data: {
          id: "tenant_default",
          slug: "default",
          name: "Default Tenant",
          isActive: true,
        },
      }));

    return tenant.id;
  }

  private async getOrCreate(): Promise<Agent> {
    const tenantId = await this.getDefaultTenantId();
    const existing = await this.prisma.agent.findFirst({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
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
        ttsVoiceId: "default",
      },
    });
  }

  private toDto(agent: Agent): Record<string, unknown> {
    return {
      id: agent.id,
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      greetingText: agent.greetingText,
      fallbackText: agent.fallbackText,
      goodbyeText: agent.goodbyeText,
      language: agent.language,
      isActive: agent.isActive,
      interruptionEnabled: agent.interruptionEnabled,
      silenceTimeoutMs: agent.silenceTimeoutMs,
      maxCallDurationSec: agent.maxCallDurationSec,
      maxTurns: agent.maxTurns,
      responseTemperature: toNumber(agent.responseTemperature, 0.3),
      responseMaxTokens: agent.responseMaxTokens,
      ttsProvider: agent.ttsProvider,
      ttsVoiceId: agent.ttsVoiceId,
      ttsSpeed: toNumber(agent.ttsSpeed, 1),
      ttsSampleRate: agent.ttsSampleRate,
      sttProvider: agent.sttProvider,
      llmProvider: agent.llmProvider,
      recordCalls: agent.recordCalls,
      ttsTestPhrase: agent.ttsTestPhrase,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    };
  }

  async get(): Promise<Record<string, unknown>> {
    const agent = await this.getOrCreate();
    return this.toDto(agent);
  }

  async update(
    adminId: string,
    input: UpdateAgentInput,
  ): Promise<Record<string, unknown>> {
    const current = await this.getOrCreate();

    const updated = await this.prisma.agent.update({
      where: { id: current.id },
      data: {
        name: input.name,
        systemPrompt: input.systemPrompt,
        greetingText: input.greetingText,
        fallbackText: input.fallbackText,
        goodbyeText: input.goodbyeText,
        language: input.language,
        isActive: input.isActive,
        interruptionEnabled: input.interruptionEnabled,
        silenceTimeoutMs: input.silenceTimeoutMs,
        maxCallDurationSec: input.maxCallDurationSec,
        maxTurns: input.maxTurns,
        responseTemperature: input.responseTemperature,
        responseMaxTokens: input.responseMaxTokens,
        ttsProvider: input.ttsProvider,
        ttsVoiceId: input.ttsVoiceId,
        ttsSpeed: input.ttsSpeed,
        ttsSampleRate: input.ttsSampleRate,
        sttProvider: input.sttProvider,
        llmProvider: input.llmProvider,
        recordCalls: input.recordCalls,
        ttsTestPhrase: input.ttsTestPhrase,
      },
    });

    await this.auditService.log({
      adminId,
      action: "AGENT_UPDATED",
      entityType: "agent",
      entityId: current.id,
    });

    return this.toDto(updated);
  }

  async testTts(
    inputText?: string,
  ): Promise<{ buffer: Buffer; contentType: string; durationMs: number }> {
    const agent = await this.getOrCreate();
    const text = inputText?.trim() || agent.ttsTestPhrase;

    const synthesized = await this.ttsProvider.synthesize({
      text,
      language: agent.language,
      voiceId: agent.ttsVoiceId,
      speed: toNumber(agent.ttsSpeed, 1),
      sampleRate: agent.ttsSampleRate,
    });

    return {
      buffer: synthesized.audio,
      contentType: synthesized.contentType,
      durationMs: synthesized.durationMs,
    };
  }

  async testPrompt(text: string): Promise<Record<string, unknown>> {
    const agent = await this.getOrCreate();
    const result = await this.conversationService.generateTurn({
      agent,
      history: [],
      userText: text,
    });

    return result;
  }
}
