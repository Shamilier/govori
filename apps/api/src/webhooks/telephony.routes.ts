import type { FastifyInstance } from "fastify";
import type { CallSessionOrchestrator } from "@/calls/call-session.orchestrator.js";

type TelephonyWebhookDeps = {
  orchestrator: CallSessionOrchestrator;
};

export async function registerTelephonyWebhooks(
  app: FastifyInstance,
  deps: TelephonyWebhookDeps,
): Promise<void> {
  app.post("/api/webhooks/telephony/inbound", async (request, reply) => {
    const payload = (request.body ?? {}) as Record<string, unknown>;
    const result = await deps.orchestrator.handleInboundWebhook(payload);
    return reply.send({ ok: true, ...result });
  });

  app.post("/api/webhooks/telephony/media", async (request, reply) => {
    const payload = (request.body ?? {}) as Record<string, unknown>;
    await deps.orchestrator.handleMediaWebhook(payload);
    return reply.send({ ok: true });
  });

  app.post("/api/webhooks/telephony/status", async (request, reply) => {
    const payload = (request.body ?? {}) as Record<string, unknown>;
    await deps.orchestrator.handleStatusWebhook(payload);
    return reply.send({ ok: true });
  });
}
