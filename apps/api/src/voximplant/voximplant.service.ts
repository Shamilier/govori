import crypto from "node:crypto";
import type { Agent, MessageRole, Prisma, PrismaClient } from "@prisma/client";
import type { ConversationService } from "@/calls/conversation.service.js";
import type { IntegrationsService } from "@/integrations/integrations.service.js";
import type { RedisService } from "@/redis/redis.service.js";
import type { TtsProvider } from "@/providers/types.js";
import { env } from "@/common/env.js";
import type {
  VoximplantExecuteFunctionInput,
  VoximplantLogInput,
  VoximplantSynthesizeInput,
} from "@/voximplant/voximplant.schemas.js";

function cleanPhone(value?: string): string | null {
  if (!value) {
    return null;
  }
  return value.replace(/^INBOUND:\s*/i, "").trim() || null;
}

function normalizePhone(value?: string): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[^\d+]/g, "").trim();
  return normalized.length > 0 ? normalized : null;
}

function clampNumber(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

const AUDIO_TTL_SEC = 120;
const AUDIO_KEY_PREFIX = "vox:audio:";

export class VoximplantService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly integrationsService: IntegrationsService,
    private readonly conversationService: ConversationService,
    private readonly ttsProvider: TtsProvider,
    private readonly redis: RedisService,
  ) {}

  private async getDefaultTenantId(): Promise<string> {
    const tenant = await this.prisma.tenant.upsert({
      where: { slug: "default" },
      update: { isActive: true },
      create: {
        id: "tenant_default",
        slug: "default",
        name: "Default Tenant",
        isActive: true,
      },
    });

    return tenant.id;
  }

  private async resolvePhoneNumber(params: {
    assistantId?: string;
    destinationNumber?: string;
  }) {
    const byAssistant = params.assistantId?.trim();
    if (byAssistant && byAssistant !== "default") {
      const phoneByAssistant = await this.prisma.phoneNumber.findFirst({
        where: {
          isActive: true,
          OR: [{ id: byAssistant }, { e164: byAssistant }],
        },
      });
      if (phoneByAssistant) {
        return phoneByAssistant;
      }
    }

    const normalizedDestination = normalizePhone(params.destinationNumber);
    if (normalizedDestination) {
      return this.prisma.phoneNumber.findFirst({
        where: { e164: normalizedDestination, isActive: true },
      });
    }

    return null;
  }

  private async resolveAgentForTenant(params: {
    tenantId: string;
    preferredAgentId?: string | null;
  }): Promise<Agent> {
    const preferredAgentId = params.preferredAgentId ?? null;
    if (preferredAgentId) {
      const preferred = await this.prisma.agent.findFirst({
        where: {
          id: preferredAgentId,
          tenantId: params.tenantId,
          isActive: true,
        },
      });
      if (preferred) {
        return preferred;
      }
    }

    const tenantAgent =
      (await this.prisma.agent.findFirst({
        where: { tenantId: params.tenantId, isActive: true },
        orderBy: { createdAt: "asc" },
      })) ??
      (await this.prisma.agent.findFirst({
        where: { tenantId: params.tenantId },
        orderBy: { createdAt: "asc" },
      }));

    if (tenantAgent) {
      return tenantAgent;
    }

    const globalAgent =
      (await this.prisma.agent.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
      })) ??
      (await this.prisma.agent.findFirst({ orderBy: { createdAt: "asc" } }));

    if (!globalAgent) {
      throw new Error("No agent configured");
    }

    return globalAgent;
  }

  async synthesize(
    input: VoximplantSynthesizeInput,
  ): Promise<{ audio_url: string; duration_ms: number; audio_id: string }> {
    const phoneNumber = await this.resolvePhoneNumber({
      assistantId: input.assistant_id,
    });
    const tenantId = phoneNumber?.tenantId ?? (await this.getDefaultTenantId());
    const integrations =
      await this.integrationsService.getDecryptedForTenant(tenantId);

    const result = await this.ttsProvider.synthesize({
      text: input.text,
      voiceId: input.voice_id,
      speed: input.speed,
      language: input.language,
      apiKey: integrations.gemini.apiKey,
      modelId: integrations.gemini.ttsModel,
    });

    const audioId = crypto.randomUUID();
    await this.redis.set(
      `${AUDIO_KEY_PREFIX}${audioId}`,
      result.audio.toString("base64"),
      AUDIO_TTL_SEC,
    );

    const baseUrl =
      env.PUBLIC_API_BASE_URL ||
      `http://${env.API_HOST === "0.0.0.0" ? "localhost" : env.API_HOST}:${env.API_PORT}`;

    return {
      audio_url: `${baseUrl}/api/voximplant/audio/${audioId}`,
      duration_ms: result.durationMs,
      audio_id: audioId,
    };
  }

  async getAudio(audioId: string): Promise<Buffer | null> {
    const data = await this.redis.get(`${AUDIO_KEY_PREFIX}${audioId}`);
    if (!data) {
      return null;
    }
    return Buffer.from(data, "base64");
  }

  async getAssistantConfig(
    assistantId: string,
  ): Promise<Record<string, unknown>> {
    const phoneNumber = await this.resolvePhoneNumber({ assistantId });
    const tenantId = phoneNumber?.tenantId ?? (await this.getDefaultTenantId());
    const agent = await this.resolveAgentForTenant({
      tenantId,
      preferredAgentId: phoneNumber?.agentId,
    });

    const integrations =
      await this.integrationsService.getDecryptedForTenant(tenantId);

    const baseUrl =
      env.PUBLIC_API_BASE_URL ||
      `http://${env.API_HOST === "0.0.0.0" ? "localhost" : env.API_HOST}:${env.API_PORT}`;

    const responseMaxTokens = clampNumber(
      Number(agent.responseMaxTokens ?? 80),
      32,
      120,
      80,
    );
    const responseTemperature = clampNumber(
      Number(agent.responseTemperature ?? 0.2),
      0,
      1.2,
      0.2,
    );

    return {
      assistant_name: agent.name,
      tenant_id: tenantId,
      phone_number: phoneNumber?.e164 ?? null,
      api_key: integrations.gemini.apiKey,
      model: integrations.gemini.llmModel,
      chat_model: integrations.gemini.llmModel,
      prompt: agent.systemPrompt,
      hello: agent.greetingText,
      google_sheet_id: null,
      tts_endpoint: `${baseUrl}/api/voximplant/synthesize`,
      tts_audio_base_url: `${baseUrl}/api/voximplant/audio`,
      voice_config: {
        voice_id: agent.ttsVoiceId ?? integrations.gemini.ttsVoice ?? env.GEMINI_TTS_VOICE ?? null,
        speed: agent.ttsSpeed ?? 1,
        language: agent.language ?? "ru",
      },
      goodbye_text: agent.goodbyeText ?? "До свидания!",
      fallback_text: agent.fallbackText ?? "Извините, произошла ошибка. Попробуйте позвонить позже.",
      agent_settings: {
        interrupt_on_user_speech: agent.interruptionEnabled ?? true,
        silence_timeout_ms: agent.silenceTimeoutMs ?? 10000,
        vad_silence_ms: 240,
        max_call_duration_sec: agent.maxCallDurationSec ?? 300,
        max_turns: agent.maxTurns ?? 20,
        response_temperature: responseTemperature,
        response_max_tokens: responseMaxTokens,
      },
      functions: [
        {
          type: "function",
          function: {
            name: "hangup_call",
            description: "Завершить звонок",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string" },
                farewell_message: { type: "string" },
              },
              required: ["reason"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "save_callback_request",
            description: "Сохранить запрос на обратный звонок",
            parameters: {
              type: "object",
              properties: {
                caller_name: { type: "string" },
                caller_phone: { type: "string" },
                comment: { type: "string" },
              },
              required: ["caller_phone"],
            },
          },
        },
      ],
    };
  }

  async executeFunction(
    input: VoximplantExecuteFunctionInput,
  ): Promise<Record<string, unknown>> {
    const callId = input.call_data.call_id;

    if (
      input.function_id === "2" ||
      input.arguments.function_name === "save_callback_request"
    ) {
      if (callId) {
        const call = await this.prisma.call.findUnique({
          where: { externalCallId: callId },
        });
        if (call) {
          await this.prisma.callEvent.create({
            data: {
              callId: call.id,
              eventType: "voximplant.function.save_callback_request",
              payloadJson: {
                arguments: input.arguments,
                call_data: input.call_data,
              } as Prisma.InputJsonValue,
            },
          });
        }
      }

      return {
        success: true,
        status: "callback_request_saved",
        received: input.arguments,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      success: true,
      status: "function_processed",
      function_id: input.function_id,
      received: input.arguments,
      timestamp: new Date().toISOString(),
    };
  }

  async ingestLog(
    input: VoximplantLogInput,
  ): Promise<{ ok: true; callId: string }> {
    const phoneNumber = await this.resolvePhoneNumber({
      assistantId: input.assistant_id,
      destinationNumber: input.destination_number,
    });
    const tenantId = phoneNumber?.tenantId ?? (await this.getDefaultTenantId());
    const agent = await this.resolveAgentForTenant({
      tenantId,
      preferredAgentId: phoneNumber?.agentId,
    });

    const call = await this.prisma.call.upsert({
      where: { externalCallId: input.call_id },
      create: {
        externalCallId: input.call_id,
        tenantId,
        phoneNumberId: phoneNumber?.id ?? null,
        agentId: agent.id,
        callerPhone: cleanPhone(input.caller_number),
        calleePhone: normalizePhone(input.destination_number),
        status: "ANSWERED",
        systemPromptSnapshot: agent.systemPrompt,
      },
      update: {
        callerPhone: cleanPhone(input.caller_number),
        calleePhone: normalizePhone(input.destination_number),
        tenantId,
        phoneNumberId: phoneNumber?.id ?? null,
        agentId: agent.id,
      },
    });

    await this.prisma.callEvent.create({
      data: {
        callId: call.id,
        eventType: `voximplant.log.${input.type}`,
        payloadJson: input as unknown as Prisma.InputJsonValue,
      },
    });

    if (input.data.user_message) {
      await this.addMessage(call.id, "USER", input.data.user_message);
    }

    if (input.data.assistant_message) {
      await this.addMessage(call.id, "ASSISTANT", input.data.assistant_message);
    }

    const functionResult = input.data.function_result;
    const isTerminated =
      typeof functionResult === "object" &&
      functionResult !== null &&
      "action" in functionResult &&
      (functionResult as { action?: string }).action === "call_terminated";

    if (isTerminated || input.type === "call_ended") {
      await this.finalizeCall(call.id);
    }

    return { ok: true, callId: call.id };
  }

  private async addMessage(
    callId: string,
    role: MessageRole,
    text: string,
  ): Promise<void> {
    const lastMessage = await this.prisma.callMessage.findFirst({
      where: { callId },
      orderBy: { sequenceNo: "desc" },
    });

    await this.prisma.callMessage.create({
      data: {
        callId,
        role,
        text,
        sequenceNo: (lastMessage?.sequenceNo ?? 0) + 1,
      },
    });
  }

  private async finalizeCall(callId: string): Promise<void> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: {
        messages: {
          orderBy: { sequenceNo: "asc" },
        },
      },
    });

    if (!call || call.endedAt) {
      return;
    }

    const endedAt = new Date();
    const durationSec = Math.max(
      1,
      Math.floor((endedAt.getTime() - call.startedAt.getTime()) / 1000),
    );

    const outcome = this.conversationService.buildOutcome({
      messages: call.messages,
      callerPhone: call.callerPhone,
    });

    await this.prisma.call.update({
      where: { id: call.id },
      data: {
        status: "COMPLETED",
        endedAt,
        durationSec,
        transcriptText: call.messages
          .map((message) => `${message.role}: ${message.text}`)
          .join("\n"),
        outcomeJson: outcome as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
