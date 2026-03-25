import type { FastifyInstance } from "fastify";
import type { AgentService } from "@/agent/agent.service.js";
import {
  testPromptSchema,
  testTtsSchema,
  updateAgentSchema,
} from "@/agent/agent.schemas.js";

type AgentRoutesDeps = {
  agentService: AgentService;
};

export async function registerAgentRoutes(
  app: FastifyInstance,
  deps: AgentRoutesDeps,
): Promise<void> {
  app.get(
    "/api/agent",
    {
      preHandler: [app.authenticate],
    },
    async (_request, reply) => {
      const data = await deps.agentService.get();
      return reply.send(data);
    },
  );

  app.put(
    "/api/agent",
    {
      preHandler: [app.authenticate, app.verifyCsrf],
    },
    async (request, reply) => {
      const parsed = updateAgentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
      }

      if (!request.adminId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const data = await deps.agentService.update(request.adminId, parsed.data);
      return reply.send(data);
    },
  );

  app.post(
    "/api/agent/test-tts",
    {
      preHandler: [app.authenticate, app.verifyCsrf],
    },
    async (request, reply) => {
      const parsed = testTtsSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
      }

      const result = await deps.agentService.testTts(parsed.data.text);
      reply.header("Content-Type", result.contentType);
      reply.header("X-TTS-Duration-Ms", String(result.durationMs));
      return reply.send(result.buffer);
    },
  );

  app.post(
    "/api/agent/test-prompt",
    {
      preHandler: [app.authenticate, app.verifyCsrf],
    },
    async (request, reply) => {
      const parsed = testPromptSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
      }

      const data = await deps.agentService.testPrompt(parsed.data.text);
      return reply.send(data);
    },
  );
}
