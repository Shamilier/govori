import type { FastifyInstance } from "fastify";
import { env } from "@/common/env.js";
import {
  voximplantExecuteFunctionSchema,
  voximplantLogSchema,
  voximplantSynthesizeSchema,
} from "@/voximplant/voximplant.schemas.js";
import type { VoximplantService } from "@/voximplant/voximplant.service.js";

type VoximplantRoutesDeps = {
  voximplantService: VoximplantService;
};

function verifySecret(
  request: { headers: Record<string, unknown> },
  reply: { code: (n: number) => { send: (body: unknown) => unknown } },
) {
  if (!env.VOXIMPLANT_WEBHOOK_SECRET) {
    return null;
  }

  const token = request.headers["x-webhook-secret"];
  if (typeof token !== "string" || token !== env.VOXIMPLANT_WEBHOOK_SECRET) {
    return reply.code(401).send({ error: "INVALID_WEBHOOK_SECRET" });
  }

  return null;
}

export async function registerVoximplantRoutes(
  app: FastifyInstance,
  deps: VoximplantRoutesDeps,
): Promise<void> {
  app.get("/api/voximplant/assistants/config/:id", async (request, reply) => {
    const invalid = verifySecret(request, reply);
    if (invalid) {
      return invalid;
    }

    const params = request.params as { id: string };
    const data = await deps.voximplantService.getAssistantConfig(params.id);
    return reply.send(data);
  });

  app.post("/api/voximplant/functions/execute", async (request, reply) => {
    const invalid = verifySecret(request, reply);
    if (invalid) {
      return invalid;
    }

    const parsed = voximplantExecuteFunctionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
    }

    const result = await deps.voximplantService.executeFunction(parsed.data);
    return reply.send(result);
  });

  app.post("/api/voximplant/log", async (request, reply) => {
    const invalid = verifySecret(request, reply);
    if (invalid) {
      return invalid;
    }

    const parsed = voximplantLogSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
    }

    const result = await deps.voximplantService.ingestLog(parsed.data);
    return reply.send(result);
  });

  app.post("/api/voximplant/synthesize", async (request, reply) => {
    const invalid = verifySecret(request, reply);
    if (invalid) {
      return invalid;
    }

    const parsed = voximplantSynthesizeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
    }

    const result = await deps.voximplantService.synthesize(parsed.data);
    return reply.send(result);
  });

  app.get("/api/voximplant/audio/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const audio = await deps.voximplantService.getAudio(params.id);
    if (!audio) {
      return reply.code(404).send({ error: "AUDIO_NOT_FOUND" });
    }

    return reply
      .header("Content-Type", "audio/wav")
      .header("Content-Length", audio.length)
      .header("Cache-Control", "no-store")
      .send(audio);
  });
}
