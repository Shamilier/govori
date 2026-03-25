import type { FastifyInstance } from "fastify";
import { callsQuerySchema } from "@/calls/calls.schemas.js";
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
}
