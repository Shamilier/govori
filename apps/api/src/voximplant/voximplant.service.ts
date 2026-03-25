import type { MessageRole, Prisma, PrismaClient } from "@prisma/client";
import type { ConversationService } from "@/calls/conversation.service.js";
import type { IntegrationsService } from "@/integrations/integrations.service.js";
import type {
  VoximplantExecuteFunctionInput,
  VoximplantLogInput,
} from "@/voximplant/voximplant.schemas.js";

function cleanPhone(value?: string): string | null {
  if (!value) {
    return null;
  }
  return value.replace(/^INBOUND:\s*/i, "").trim() || null;
}

export class VoximplantService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly integrationsService: IntegrationsService,
    private readonly conversationService: ConversationService,
  ) {}

  async getAssistantConfig(
    _assistantId: string,
  ): Promise<Record<string, unknown>> {
    const agent =
      (await this.prisma.agent.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
      })) ??
      (await this.prisma.agent.findFirst({ orderBy: { createdAt: "asc" } }));

    if (!agent) {
      throw new Error("No agent configured");
    }

    const integrations = await this.integrationsService.getDecrypted();

    return {
      assistant_name: agent.name,
      api_key: integrations.llm.apiKey,
      model: integrations.llm.model,
      prompt: agent.systemPrompt,
      hello: agent.greetingText,
      google_sheet_id: null,
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
    const agent =
      (await this.prisma.agent.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
      })) ??
      (await this.prisma.agent.findFirst({ orderBy: { createdAt: "asc" } }));

    if (!agent) {
      throw new Error("No agent configured");
    }

    const call = await this.prisma.call.upsert({
      where: { externalCallId: input.call_id },
      create: {
        externalCallId: input.call_id,
        agentId: agent.id,
        callerPhone: cleanPhone(input.caller_number),
        status: "ANSWERED",
        systemPromptSnapshot: agent.systemPrompt,
      },
      update: {
        callerPhone: cleanPhone(input.caller_number),
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
