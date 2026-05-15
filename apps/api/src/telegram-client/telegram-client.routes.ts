import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "@/common/env.js";
import {
  telegramClientReportQuerySchema,
  telegramClientStartCampaignSchema,
  telegramClientStateQuerySchema,
  telegramClientUpdatePromptSchema,
  telegramClientUpdateVoiceSchema,
} from "@/telegram-client/telegram-client.schemas.js";
import type {
  DashboardPeriod,
  TelegramClientService,
} from "@/telegram-client/telegram-client.service.js";
import {
  extractInitDataFromHeaders,
  verifyWebAppInitData,
} from "@/telegram-client/webapp-auth.js";

type TelegramClientRoutesDeps = {
  telegramClientService: TelegramClientService;
};

function authenticateWebApp(
  request: FastifyRequest,
  reply: FastifyReply,
): { telegramUserId: number } | null {
  const initData = extractInitDataFromHeaders(
    request.headers as Record<string, unknown>,
  );
  if (!initData) {
    reply.code(401).send({ error: "INIT_DATA_REQUIRED" });
    return null;
  }

  const result = verifyWebAppInitData(initData);
  if (!result.ok) {
    reply.code(result.code).send({ error: result.error });
    return null;
  }

  return { telegramUserId: result.telegramUserId };
}

function parsePeriod(value: unknown): DashboardPeriod {
  if (value === "today" || value === "yesterday" || value === "month" || value === "all") {
    return value;
  }
  return "week";
}

function parseCategory(
  value: unknown,
): "all" | "hot" | "warm" | "cold" | "no_answer" {
  if (
    value === "hot" ||
    value === "warm" ||
    value === "cold" ||
    value === "no_answer"
  ) {
    return value;
  }
  return "all";
}

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

  app.get("/api/telegram/client/report", async (request, reply) => {
    const invalidSecret = verifyTelegramServiceSecret(request, reply);
    if (invalidSecret) {
      return invalidSecret;
    }

    const parsed = telegramClientReportQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_QUERY", details: parsed.error.flatten() });
    }

    try {
      const data = await deps.telegramClientService.getReport(
        parsed.data.telegram_user_id,
        parsed.data.limit,
      );
      return reply.send(data);
    } catch (error) {
      return reply.code(404).send({
        error:
          error instanceof Error ? error.message : "TELEGRAM_BINDING_NOT_FOUND",
      });
    }
  });

  app.get(
    "/api/telegram/client/calls/:id/recording",
    async (request, reply) => {
      const params = request.params as { id?: string };
      const query = request.query as { token?: string };
      const callId = params.id?.trim();
      const token = query.token?.trim();

      if (!callId || !token) {
        return reply.code(401).send({ error: "RECORDING_TOKEN_REQUIRED" });
      }

      const rangeHeader = request.headers.range;
      const range = Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader;

      try {
        const data = await deps.telegramClientService.downloadRecording(
          callId,
          token,
          range,
        );

        for (const [name, value] of Object.entries(data.headers)) {
          reply.header(name, value);
        }

        return reply.code(data.statusCode).send(data.body);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "RECORDING_DOWNLOAD_FAILED";

        if (message === "INVALID_RECORDING_TOKEN") {
          return reply.code(401).send({ error: message });
        }
        if (message === "RECORDING_NOT_FOUND") {
          return reply.code(404).send({ error: message });
        }
        if (message === "VOXIMPLANT_RECORDING_AUTH_NOT_CONFIGURED") {
          return reply.code(503).send({ error: message });
        }
        if (message.startsWith("VOXIMPLANT_RECORDING_FETCH_FAILED_")) {
          return reply.code(502).send({ error: message });
        }

        throw error;
      }
    },
  );

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

  // ─────────────────────────────────────────────
  // Mini App (WebApp) endpoints — auth via initData HMAC
  // ─────────────────────────────────────────────

  app.get("/api/telegram/webapp/dashboard", async (request, reply) => {
    const auth = authenticateWebApp(request, reply);
    if (!auth) return;

    const query = request.query as { period?: string };
    const period = parsePeriod(query.period);

    try {
      const data = await deps.telegramClientService.getDashboard(
        auth.telegramUserId,
        period,
      );
      return reply.send(data);
    } catch (error) {
      return reply.code(404).send({
        error:
          error instanceof Error ? error.message : "TELEGRAM_BINDING_NOT_FOUND",
      });
    }
  });

  app.get("/api/telegram/webapp/leads", async (request, reply) => {
    const auth = authenticateWebApp(request, reply);
    if (!auth) return;

    const query = request.query as {
      period?: string;
      category?: string;
      limit?: string;
      offset?: string;
    };

    const limit = Math.min(
      Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1),
      200,
    );
    const offset = Math.max(Number.parseInt(query.offset ?? "0", 10) || 0, 0);

    try {
      const data = await deps.telegramClientService.getLeads(
        auth.telegramUserId,
        {
          period: parsePeriod(query.period),
          category: parseCategory(query.category),
          limit,
          offset,
        },
      );
      return reply.send(data);
    } catch (error) {
      return reply.code(404).send({
        error:
          error instanceof Error ? error.message : "TELEGRAM_BINDING_NOT_FOUND",
      });
    }
  });

  app.get("/api/telegram/webapp/leads/:id", async (request, reply) => {
    const auth = authenticateWebApp(request, reply);
    if (!auth) return;

    const params = request.params as { id?: string };
    const callId = params.id?.trim();
    if (!callId) {
      return reply.code(400).send({ error: "CALL_ID_REQUIRED" });
    }

    try {
      const data = await deps.telegramClientService.getLeadDetail(
        auth.telegramUserId,
        callId,
      );
      if (!data) {
        return reply.code(404).send({ error: "CALL_NOT_FOUND" });
      }
      return reply.send(data);
    } catch (error) {
      return reply.code(404).send({
        error:
          error instanceof Error ? error.message : "TELEGRAM_BINDING_NOT_FOUND",
      });
    }
  });
}
