import type { FastifyInstance } from "fastify";
import {
  callsQuerySchema,
  startOutboundCallSchema,
} from "@/calls/calls.schemas.js";
import type { CallsService } from "@/calls/calls.service.js";

type CallsRoutesDeps = {
  callsService: CallsService;
};

export async function registerCallsRoutes(
  app: FastifyInstance,
  deps: CallsRoutesDeps,
): Promise<void> {
  app.get(
    "/api/calls",
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const parsed = callsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_QUERY", details: parsed.error.flatten() });
      }

      const data = await deps.callsService.list(parsed.data);
      return reply.send(data);
    },
  );

  app.get(
    "/api/calls/:id",
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const data = await deps.callsService.getById(params.id);
      if (!data) {
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      return reply.send(data);
    },
  );

  app.get(
    "/api/calls/:id/transcript",
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const data = await deps.callsService.getTranscript(params.id);
      if (!data) {
        return reply.code(404).send({ error: "NOT_FOUND" });
      }

      return reply.send(data);
    },
  );

  app.post(
    "/api/calls/outbound",
    {
      preHandler: [app.authenticate, app.verifyCsrf],
    },
    async (request, reply) => {
      const parsed = startOutboundCallSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
      }

      if (!request.adminId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      try {
        const data = await deps.callsService.startOutboundCall(
          request.adminId,
          parsed.data,
        );
        return reply.code(202).send(data);
      } catch (error) {
        return reply.code(400).send({
          error:
            error instanceof Error
              ? error.message
              : "OUTBOUND_CALL_START_FAILED",
        });
      }
    },
  );
}
