import type {
  Agent,
  Call,
  CallStatus,
  MessageRole,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import type { ConversationService } from "@/calls/conversation.service.js";
import type {
  DecryptedIntegrationSettings,
  IntegrationsService,
} from "@/integrations/integrations.service.js";
import type { RedisService } from "@/redis/redis.service.js";
import type { TelephonyProvider } from "@/providers/telephony.provider.js";
import type {
  InboundCallEvent,
  SpeechToTextProvider,
  TtsProvider,
} from "@/providers/types.js";

function normalizePhone(value?: string): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[^\d+]/g, "").trim();
  return normalized.length > 0 ? normalized : null;
}

export class CallSessionOrchestrator {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisService,
    private readonly integrationsService: IntegrationsService,
    private readonly telephonyProvider: TelephonyProvider,
    private readonly sttProvider: SpeechToTextProvider,
    private readonly ttsProvider: TtsProvider,
    private readonly conversationService: ConversationService,
  ) {}

  private async getTenantIntegrations(
    tenantId: string,
  ): Promise<DecryptedIntegrationSettings> {
    return this.integrationsService.getDecryptedForTenant(tenantId);
  }

  private async resolveTenantAndAgent(inbound: InboundCallEvent): Promise<{
    tenantId: string;
    phoneNumberId: string | null;
    agent: Agent;
    normalizedCallee: string | null;
  }> {
    const normalizedCallee = normalizePhone(inbound.calleePhone);
    const normalizedCaller = normalizePhone(inbound.callerPhone);

    const phoneNumber = normalizedCallee
      ? await this.prisma.phoneNumber.findFirst({
          where: { e164: normalizedCallee, isActive: true },
        })
      : null;

    const tenantId =
      phoneNumber?.tenantId ??
      (
        await this.prisma.tenant.upsert({
          where: { slug: "default" },
          update: { isActive: true },
          create: {
            id: "tenant_default",
            slug: "default",
            name: "Default Tenant",
            isActive: true,
          },
        })
      ).id;

    let agent: Agent | null = null;
    if (phoneNumber?.agentId) {
      agent = await this.prisma.agent.findFirst({
        where: {
          id: phoneNumber.agentId,
          tenantId,
          isActive: true,
        },
      });
    }

    if (!agent) {
      agent =
        (await this.prisma.agent.findFirst({
          where: { tenantId, isActive: true },
          orderBy: { createdAt: "asc" },
        })) ??
        (await this.prisma.agent.findFirst({
          where: { tenantId },
          orderBy: { createdAt: "asc" },
        }));
    }

    if (!agent && normalizedCaller) {
      agent =
        (await this.prisma.agent.findFirst({
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
        })) ??
        (await this.prisma.agent.findFirst({ orderBy: { createdAt: "asc" } }));
    }

    if (!agent) {
      throw new Error("No agent configured");
    }

    return {
      tenantId,
      phoneNumberId: phoneNumber?.id ?? null,
      agent,
      normalizedCallee,
    };
  }

  async handleInboundWebhook(
    payload: Record<string, unknown>,
  ): Promise<{ callId: string; externalCallId: string }> {
    const inbound = await this.telephonyProvider.handleInboundWebhook(payload);

    const existingCall = await this.prisma.call.findUnique({
      where: { externalCallId: inbound.externalCallId },
    });

    if (existingCall) {
      await this.addEvent(
        existingCall.id,
        "webhook.inbound.duplicate",
        payload,
      );
      return {
        callId: existingCall.id,
        externalCallId: existingCall.externalCallId,
      };
    }

    const routing = await this.resolveTenantAndAgent(inbound);
    const integrations = await this.getTenantIntegrations(routing.tenantId);
    const callerPhone = normalizePhone(inbound.callerPhone) ?? inbound.callerPhone;
    const calleePhone = routing.normalizedCallee ?? inbound.calleePhone;

    const call = await this.prisma.call.create({
      data: {
        externalCallId: inbound.externalCallId,
        tenantId: routing.tenantId,
        phoneNumberId: routing.phoneNumberId,
        agentId: routing.agent.id,
        callerPhone,
        calleePhone,
        status: "RINGING",
        systemPromptSnapshot: routing.agent.systemPrompt,
      },
    });

    await this.addEvent(call.id, "webhook.inbound.received", payload);

    try {
      await this.telephonyProvider.answerCall(inbound.externalCallId);
      await this.setStatus(call.id, "ANSWERED", { answeredAt: new Date() });

      await this.setStatus(call.id, "GREETING");
      const greeting = await this.ttsProvider.synthesize({
        text: routing.agent.greetingText,
        language: routing.agent.language,
        speed: Number(routing.agent.ttsSpeed),
        voiceId: routing.agent.ttsVoiceId,
        sampleRate: routing.agent.ttsSampleRate,
        apiKey: integrations.cartesia.apiKey,
        modelId: integrations.cartesia.modelId,
      });

      await this.telephonyProvider.playAudio(
        inbound.externalCallId,
        greeting.audio,
        greeting.contentType,
      );
      await this.addMessage(call.id, "ASSISTANT", routing.agent.greetingText, {
        kind: "greeting",
      });
      await this.setStatus(call.id, "LISTENING");
    } catch (error) {
      await this.failSafe(
        call.id,
        inbound.externalCallId,
        routing.agent,
        integrations,
        error,
      );
    }

    return { callId: call.id, externalCallId: inbound.externalCallId };
  }

  async handleMediaWebhook(payload: Record<string, unknown>): Promise<void> {
    const externalCallId = String(
      payload.call_id ?? payload.external_call_id ?? "",
    );
    if (!externalCallId) {
      return;
    }

    const eventId = payload.event_id ? String(payload.event_id) : null;
    if (eventId) {
      const isNew = await this.redis.setNX(
        `webhook:media:${externalCallId}:${eventId}`,
        "1",
        3600,
      );
      if (!isNew) {
        return;
      }
    }

    const call = await this.prisma.call.findUnique({
      where: { externalCallId },
      include: { agent: true },
    });

    if (!call || call.status === "COMPLETED" || call.status === "FAILED") {
      return;
    }
    const integrations = await this.getTenantIntegrations(call.tenantId);

    await this.addEvent(call.id, "webhook.media.received", payload);
    await this.setStatus(call.id, "TRANSCRIBING");

    const transcript = await this.sttProvider.transcribeTurn({
      hintedText: typeof payload.text === "string" ? payload.text : undefined,
      audioBase64:
        typeof payload.audio_base64 === "string"
          ? payload.audio_base64
          : undefined,
      language: call.agent.language,
    });

    const userText = transcript.trim();
    if (!userText) {
      await this.handleSilence(call, externalCallId, integrations);
      return;
    }

    await this.addMessage(call.id, "USER", userText, { source: "media" });
    await this.setStatus(call.id, "THINKING");

    const history = await this.prisma.callMessage.findMany({
      where: { callId: call.id },
      orderBy: { sequenceNo: "asc" },
      take: 24,
    });

    const turnResult = await this.conversationService.generateTurn({
      agent: call.agent,
      history,
      userText,
      llmApiKey: integrations.llm.apiKey,
      llmModel: integrations.llm.model,
    });

    const assistantText = turnResult.assistantText || call.agent.fallbackText;
    await this.addMessage(
      call.id,
      "ASSISTANT",
      assistantText,
      turnResult.metadata,
    );

    await this.setStatus(call.id, "SYNTHESIZING");
    const speech = await this.ttsProvider.synthesize({
      text: assistantText,
      voiceId: call.agent.ttsVoiceId,
      speed: Number(call.agent.ttsSpeed),
      language: call.agent.language,
      sampleRate: call.agent.ttsSampleRate,
      apiKey: integrations.cartesia.apiKey,
      modelId: integrations.cartesia.modelId,
    });

    await this.setStatus(call.id, "SPEAKING");
    await this.telephonyProvider.playAudio(
      externalCallId,
      speech.audio,
      speech.contentType,
    );

    if (turnResult.shouldHangup) {
      await this.telephonyProvider.hangupCall(externalCallId);
      await this.finalizeCall(call.id, "COMPLETED");
      return;
    }

    await this.setStatus(call.id, "LISTENING");
  }

  async handleStatusWebhook(payload: Record<string, unknown>): Promise<void> {
    const externalCallId = String(
      payload.call_id ?? payload.external_call_id ?? "",
    );
    if (!externalCallId) {
      return;
    }

    const call = await this.prisma.call.findUnique({
      where: { externalCallId },
    });
    if (!call) {
      return;
    }

    await this.addEvent(call.id, "webhook.status.received", payload);

    const status = String(
      payload.status ?? payload.call_status ?? "",
    ).toLowerCase();
    const recordingUrl =
      typeof payload.recording_url === "string" ? payload.recording_url : null;
    const errorMessage =
      typeof payload.error_message === "string" ? payload.error_message : null;

    if (recordingUrl) {
      await this.prisma.call.update({
        where: { id: call.id },
        data: { recordingUrl },
      });
    }

    if (["failed", "error"].includes(status)) {
      await this.finalizeCall(
        call.id,
        "FAILED",
        errorMessage ?? "provider_status_failed",
      );
      return;
    }

    if (["completed", "hangup", "disconnected", "ended"].includes(status)) {
      await this.finalizeCall(
        call.id,
        "COMPLETED",
        undefined,
        recordingUrl ?? undefined,
      );
    }
  }

  private async handleSilence(
    call: Call & { agent: Agent },
    externalCallId: string,
    integrations: DecryptedIntegrationSettings,
  ): Promise<void> {
    const silenceCount = await this.redis.incr(`call:silence:${call.id}`, 3600);

    if (silenceCount >= 2) {
      const goodbye = call.agent.goodbyeText;
      await this.addMessage(call.id, "ASSISTANT", goodbye, {
        reason: "silence_timeout",
      });
      await this.setStatus(call.id, "SYNTHESIZING");
      const speech = await this.ttsProvider.synthesize({
        text: goodbye,
        voiceId: call.agent.ttsVoiceId,
        speed: Number(call.agent.ttsSpeed),
        language: call.agent.language,
        sampleRate: call.agent.ttsSampleRate,
        apiKey: integrations.cartesia.apiKey,
        modelId: integrations.cartesia.modelId,
      });
      await this.telephonyProvider.playAudio(
        externalCallId,
        speech.audio,
        speech.contentType,
      );
      await this.telephonyProvider.hangupCall(externalCallId);
      await this.finalizeCall(call.id, "COMPLETED");
      return;
    }

    const fallback = call.agent.fallbackText;
    await this.addMessage(call.id, "ASSISTANT", fallback, {
      reason: "silence_retry",
    });
    await this.setStatus(call.id, "SYNTHESIZING");
    const speech = await this.ttsProvider.synthesize({
      text: fallback,
      voiceId: call.agent.ttsVoiceId,
      speed: Number(call.agent.ttsSpeed),
      language: call.agent.language,
      sampleRate: call.agent.ttsSampleRate,
      apiKey: integrations.cartesia.apiKey,
      modelId: integrations.cartesia.modelId,
    });
    await this.setStatus(call.id, "SPEAKING");
    await this.telephonyProvider.playAudio(
      externalCallId,
      speech.audio,
      speech.contentType,
    );
    await this.setStatus(call.id, "LISTENING");
  }

  private async failSafe(
    callId: string,
    externalCallId: string,
    agent: Agent,
    integrations: DecryptedIntegrationSettings,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : "unknown_error";
    await this.addEvent(callId, "call.fail_safe", { message });

    try {
      const speech = await this.ttsProvider.synthesize({
        text: agent.fallbackText,
        voiceId: agent.ttsVoiceId,
        speed: Number(agent.ttsSpeed),
        language: agent.language,
        sampleRate: agent.ttsSampleRate,
        apiKey: integrations.cartesia.apiKey,
        modelId: integrations.cartesia.modelId,
      });
      await this.telephonyProvider.playAudio(
        externalCallId,
        speech.audio,
        speech.contentType,
      );
      await this.telephonyProvider.hangupCall(externalCallId);
    } catch (innerError) {
      await this.addEvent(callId, "call.fail_safe.error", {
        message: innerError instanceof Error ? innerError.message : "unknown",
      });
    }

    await this.finalizeCall(callId, "FAILED", message);
  }

  private async finalizeCall(
    callId: string,
    status: "COMPLETED" | "FAILED",
    errorMessage?: string,
    recordingUrl?: string,
  ): Promise<void> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: {
        agent: true,
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
    const transcriptText = call.messages
      .map((message) => `${message.role}: ${message.text}`)
      .join("\n");

    const outcome = this.conversationService.buildOutcome({
      messages: call.messages,
      callerPhone: call.callerPhone,
      fallbackSummary:
        status === "FAILED" ? "Разговор завершён с ошибкой." : undefined,
    });

    const finalRecordingUrl =
      recordingUrl ??
      call.recordingUrl ??
      (await this.telephonyProvider.getRecording(call.externalCallId));

    await this.prisma.call.update({
      where: { id: call.id },
      data: {
        status,
        endedAt,
        durationSec,
        transcriptText,
        outcomeJson: outcome,
        errorMessage: errorMessage ?? null,
        recordingUrl: finalRecordingUrl,
      },
    });

    await this.addEvent(call.id, "call.finalized", {
      status,
      durationSec,
      errorMessage,
      recordingUrl: finalRecordingUrl,
    });

    await this.sttProvider.finalize(call.id);
  }

  private async setStatus(
    callId: string,
    status: CallStatus,
    extraData?: Prisma.CallUpdateInput,
  ): Promise<void> {
    await this.prisma.call.update({
      where: { id: callId },
      data: {
        status,
        ...(extraData ?? {}),
      },
    });

    await this.addEvent(callId, "call.state.changed", { status });
  }

  private async addEvent(
    callId: string,
    eventType: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.callEvent.create({
      data: {
        callId,
        eventType,
        payloadJson: payload as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private async addMessage(
    callId: string,
    role: MessageRole,
    text: string,
    meta?: Record<string, unknown>,
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
        startedAt: new Date(),
        metaJson: meta as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
