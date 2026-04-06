import type { FastifyInstance } from "fastify";
import {
  consumeTelegramAuthTokenSchema,
  createTelegramAuthLinkSchema,
  resolveTelegramBindingQuerySchema,
} from "./telegram-auth.schemas.js";
import {
  TelegramAuthError,
  type TelegramAuthService,
} from "./telegram-auth.service.js";

type TelegramAuthRoutesDeps = {
  telegramAuthService: TelegramAuthService;
};

export async function registerTelegramAuthRoutes(
  app: FastifyInstance,
  deps: TelegramAuthRoutesDeps,
): Promise<void> {
  app.post("/api/telegram/auth/link", async (request, reply) => {
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
