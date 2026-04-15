import type { FastifyInstance } from "fastify";
import { env } from "@/common/env.js";
import {
  telegramClientStartCampaignSchema,
  telegramClientStateQuerySchema,
  telegramClientUpdatePromptSchema,
  telegramClientUpdateVoiceSchema,
} from "@/telegram-client/telegram-client.schemas.js";
import type { TelegramClientService } from "@/telegram-client/telegram-client.service.js";

type TelegramClientRoutesDeps = {
  telegramClientService: TelegramClientService;
};

function verifyTelegramServiceSecret(
  request: { headers: Record<string, unknown> },
  reply: { code: (n: number) => { send: (body: unknown) => unknown } },
) {
  const expected =
    env.TELEGRAM_BOT_SERVICE_SECRET || env.TELEGRAM_WEBHOOK_SECRET || "";

  if (!expected) {
    return reply
      .code(503)
      .send({ error: "TELEGRAM_SERVICE_SECRET_NOT_CONFIGURED" });
  }

  const incoming = request.headers["x-telegram-service-secret"];
  if (typeof incoming !== "string" || incoming !== expected) {
    return reply.code(401).send({ error: "INVALID_TELEGRAM_SERVICE_SECRET" });
  }

  return null;
}

export async function registerTelegramClientRoutes(
  app: FastifyInstance,
  deps: TelegramClientRoutesDeps,
): Promise<void> {
  app.get("/api/telegram/client/state", async (request, reply) => {
    const invalidSecret = verifyTelegramServiceSecret(request, reply);
    if (invalidSecret) {
      return invalidSecret;
    }

    const parsed = telegramClientStateQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_QUERY", details: parsed.error.flatten() });
    }

    try {
      const data = await deps.telegramClientService.getState(
        parsed.data.telegram_user_id,
      );
      return reply.send(data);
    } catch (error) {
      return reply.code(404).send({
        error:
          error instanceof Error ? error.message : "TELEGRAM_BINDING_NOT_FOUND",
      });
    }
  });

  app.post("/api/telegram/client/agent/prompt", async (request, reply) => {
    const invalidSecret = verifyTelegramServiceSecret(request, reply);
    if (invalidSecret) {
      return invalidSecret;
    }

    const parsed = telegramClientUpdatePromptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
    }

    try {
      const data = await deps.telegramClientService.updatePrompt(parsed.data);
      return reply.send(data);
    } catch (error) {
      return reply.code(404).send({
        error:
          error instanceof Error ? error.message : "TELEGRAM_BINDING_NOT_FOUND",
      });
    }
  });

  app.post("/api/telegram/client/agent/voice", async (request, reply) => {
    const invalidSecret = verifyTelegramServiceSecret(request, reply);
    if (invalidSecret) {
      return invalidSecret;
    }

    const parsed = telegramClientUpdateVoiceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
    }

    try {
      const data = await deps.telegramClientService.updateVoice(parsed.data);
      return reply.send(data);
    } catch (error) {
      return reply.code(404).send({
        error:
          error instanceof Error ? error.message : "TELEGRAM_BINDING_NOT_FOUND",
      });
    }
  });

  app.post("/api/telegram/client/campaign/start", async (request, reply) => {
    const invalidSecret = verifyTelegramServiceSecret(request, reply);
    if (invalidSecret) {
      return invalidSecret;
    }

    const parsed = telegramClientStartCampaignSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
    }

    try {
      const data = await deps.telegramClientService.startCampaign(parsed.data);
      return reply.code(202).send(data);
    } catch (error) {
      return reply.code(400).send({
        error:
          error instanceof Error
            ? error.message
            : "TELEGRAM_CAMPAIGN_START_FAILED",
      });
    }
  });
}
