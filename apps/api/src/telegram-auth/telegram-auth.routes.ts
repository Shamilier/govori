import type { FastifyInstance } from "fastify";
import { env } from "@/common/env.js";
import {
  bindTelegramByAccessCodeSchema,
  createTenantAccessCodeSchema,
  consumeTelegramAuthTokenSchema,
  createTelegramAuthLinkSchema,
  revokeTenantAccessCodeParamsSchema,
  resolveTelegramBindingQuerySchema,
} from "./telegram-auth.schemas.js";
import {
  TelegramAuthError,
  type TelegramAuthService,
} from "./telegram-auth.service.js";

type TelegramAuthRoutesDeps = {
  telegramAuthService: TelegramAuthService;
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

export async function registerTelegramAuthRoutes(
  app: FastifyInstance,
  deps: TelegramAuthRoutesDeps,
): Promise<void> {
  app.post("/api/telegram/auth/link", async (request, reply) => {
    const invalidSecret = verifyTelegramServiceSecret(request, reply);
    if (invalidSecret) {
      return invalidSecret;
    }

    const parsed = createTelegramAuthLinkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
    }

    const data = await deps.telegramAuthService.createAuthLink(parsed.data);

    return reply.send({
      url: data.url,
      expiresAt: data.expiresAt.toISOString(),
    });
  });

  app.get("/api/telegram/auth/resolve", async (request, reply) => {
    const invalidSecret = verifyTelegramServiceSecret(request, reply);
    if (invalidSecret) {
      return invalidSecret;
    }

    const parsed = resolveTelegramBindingQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_QUERY", details: parsed.error.flatten() });
    }

    const data = await deps.telegramAuthService.resolveBinding(
      parsed.data.telegram_user_id,
    );

    if (!data) {
      return reply.code(404).send({ error: "BINDING_NOT_FOUND" });
    }

    return reply.send(data);
  });

  app.post("/api/telegram/auth/bind-by-code", async (request, reply) => {
    const invalidSecret = verifyTelegramServiceSecret(request, reply);
    if (invalidSecret) {
      return invalidSecret;
    }

    const parsed = bindTelegramByAccessCodeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
    }

    try {
      const data = await deps.telegramAuthService.bindByAccessCode(parsed.data);
      return reply.send(data);
    } catch (error) {
      if (error instanceof TelegramAuthError) {
        switch (error.code) {
          case "ACCESS_CODE_INVALID":
            return reply.code(404).send({ error: error.code });
          case "ACCESS_CODE_INACTIVE":
            return reply.code(403).send({ error: error.code });
          case "ACCESS_CODE_EXPIRED":
            return reply.code(410).send({ error: error.code });
          case "ACCESS_CODE_LIMIT_REACHED":
            return reply.code(409).send({ error: error.code });
          case "ACCESS_CODE_AGENT_NOT_FOUND":
            return reply.code(422).send({ error: error.code });
          case "TELEGRAM_ID_OUT_OF_RANGE":
            return reply.code(422).send({ error: error.code });
          default:
            return reply.code(400).send({ error: error.code });
        }
      }

      throw error;
    }
  });

  app.get(
    "/api/telegram/auth/access-codes",
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      if (!request.adminId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      try {
        const items = await deps.telegramAuthService.listTenantAccessCodes(
          request.adminId,
        );
        return reply.send({ items });
      } catch (error) {
        if (error instanceof TelegramAuthError) {
          switch (error.code) {
            case "ADMIN_NOT_FOUND":
              return reply.code(401).send({ error: error.code });
            case "ADMIN_TENANT_REQUIRED":
              return reply.code(409).send({ error: error.code });
            default:
              return reply.code(400).send({ error: error.code });
          }
        }

        throw error;
      }
    },
  );

  app.get(
    "/api/telegram/auth/agents",
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      if (!request.adminId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      try {
        const items = await deps.telegramAuthService.listTenantAgents(
          request.adminId,
        );
        return reply.send({ items });
      } catch (error) {
        if (error instanceof TelegramAuthError) {
          switch (error.code) {
            case "ADMIN_NOT_FOUND":
              return reply.code(401).send({ error: error.code });
            case "ADMIN_TENANT_REQUIRED":
              return reply.code(409).send({ error: error.code });
            default:
              return reply.code(400).send({ error: error.code });
          }
        }

        throw error;
      }
    },
  );

  app.post(
    "/api/telegram/auth/access-codes",
    {
      preHandler: [app.authenticate, app.verifyCsrf],
    },
    async (request, reply) => {
      if (!request.adminId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const parsed = createTenantAccessCodeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
      }

      try {
        const data = await deps.telegramAuthService.createTenantAccessCode(
          request.adminId,
          parsed.data,
        );
        return reply.code(201).send(data);
      } catch (error) {
        if (error instanceof TelegramAuthError) {
          switch (error.code) {
            case "ADMIN_NOT_FOUND":
              return reply.code(401).send({ error: error.code });
            case "ADMIN_TENANT_REQUIRED":
              return reply.code(409).send({ error: error.code });
            case "ACCESS_CODE_ALREADY_EXISTS":
              return reply.code(409).send({ error: error.code });
            case "ACCESS_CODE_AGENT_NOT_FOUND":
              return reply.code(422).send({ error: error.code });
            default:
              return reply.code(400).send({ error: error.code });
          }
        }

        throw error;
      }
    },
  );

  app.delete(
    "/api/telegram/auth/access-codes/:id",
    {
      preHandler: [app.authenticate, app.verifyCsrf],
    },
    async (request, reply) => {
      if (!request.adminId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const parsed = revokeTenantAccessCodeParamsSchema.safeParse(
        request.params,
      );
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PARAMS", details: parsed.error.flatten() });
      }

      try {
        await deps.telegramAuthService.revokeTenantAccessCode(
          request.adminId,
          parsed.data.id,
        );
        return reply.send({ ok: true });
      } catch (error) {
        if (error instanceof TelegramAuthError) {
          switch (error.code) {
            case "ADMIN_NOT_FOUND":
              return reply.code(401).send({ error: error.code });
            case "ADMIN_TENANT_REQUIRED":
              return reply.code(409).send({ error: error.code });
            case "ACCESS_CODE_NOT_FOUND":
              return reply.code(404).send({ error: error.code });
            default:
              return reply.code(400).send({ error: error.code });
          }
        }

        throw error;
      }
    },
  );

  app.post(
    "/api/telegram/auth/consume",
    {
      preHandler: [app.authenticate, app.verifyCsrf],
    },
    async (request, reply) => {
      if (!request.adminId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const parsed = consumeTelegramAuthTokenSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
      }

      try {
        const data = await deps.telegramAuthService.consumeAuthToken({
          token: parsed.data.token,
          adminId: request.adminId,
        });

        return reply.send(data);
      } catch (error) {
        if (error instanceof TelegramAuthError) {
          switch (error.code) {
            case "TOKEN_NOT_FOUND":
              return reply.code(404).send({ error: error.code });
            case "TOKEN_EXPIRED":
              return reply.code(410).send({ error: error.code });
            case "TOKEN_ALREADY_USED":
              return reply.code(409).send({ error: error.code });
            case "ADMIN_NOT_FOUND":
              return reply.code(401).send({ error: error.code });
            case "ADMIN_TENANT_REQUIRED":
              return reply.code(409).send({ error: error.code });
            case "TELEGRAM_ID_OUT_OF_RANGE":
              return reply.code(422).send({ error: error.code });
            default:
              return reply.code(400).send({ error: error.code });
          }
        }

        throw error;
      }
    },
  );
}
