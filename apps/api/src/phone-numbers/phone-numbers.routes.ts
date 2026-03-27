import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import {
  createPhoneNumberSchema,
  updatePhoneNumberSchema,
} from "@/phone-numbers/phone-numbers.schemas.js";
import type { PhoneNumbersService } from "@/phone-numbers/phone-numbers.service.js";

type PhoneNumbersRoutesDeps = {
  phoneNumbersService: PhoneNumbersService;
};

function asKnownError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (["TENANT_NOT_FOUND", "AGENT_NOT_FOUND_IN_TENANT"].includes(error.message)) {
    return error.message;
  }

  return null;
}

export async function registerPhoneNumbersRoutes(
  app: FastifyInstance,
  deps: PhoneNumbersRoutesDeps,
): Promise<void> {
  app.get(
    "/api/phone-numbers",
    {
      preHandler: [app.authenticate],
    },
    async (_request, reply) => {
      const data = await deps.phoneNumbersService.list();
      return reply.send(data);
    },
  );

  app.post(
    "/api/phone-numbers",
    {
      preHandler: [app.authenticate, app.verifyCsrf],
    },
    async (request, reply) => {
      const parsed = createPhoneNumberSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
      }

      if (!request.adminId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      try {
        const data = await deps.phoneNumbersService.create(
          request.adminId,
          parsed.data,
        );
        return reply.code(201).send(data);
      } catch (error) {
        const known = asKnownError(error);
        if (known) {
          return reply.code(400).send({ error: known });
        }
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          return reply.code(409).send({ error: "PHONE_NUMBER_ALREADY_EXISTS" });
        }
        throw error;
      }
    },
  );

  app.put(
    "/api/phone-numbers/:id",
    {
      preHandler: [app.authenticate, app.verifyCsrf],
    },
    async (request, reply) => {
      const parsed = updatePhoneNumberSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
      }

      if (!request.adminId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const params = request.params as { id: string };

      try {
        const data = await deps.phoneNumbersService.update(
          request.adminId,
          params.id,
          parsed.data,
        );

        if (!data) {
          return reply.code(404).send({ error: "NOT_FOUND" });
        }

        return reply.send(data);
      } catch (error) {
        const known = asKnownError(error);
        if (known) {
          return reply.code(400).send({ error: known });
        }
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          return reply.code(409).send({ error: "PHONE_NUMBER_ALREADY_EXISTS" });
        }
        throw error;
      }
    },
  );
}
