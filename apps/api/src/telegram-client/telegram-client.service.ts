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
      recentCalls: calls.map((call) => ({
        id: call.id,
        externalCallId: call.externalCallId,
        status: call.status,
        direction: call.direction,
        callerPhone: call.callerPhone,
        calleePhone: call.calleePhone,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
      })),
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
      input.ruleId?.trim() || env.VOXIMPLANT_OUTBOUND_RULE_ID?.trim();
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
}
