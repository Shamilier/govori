import type { FastifyInstance } from "fastify";
import type { IntegrationsService } from "@/integrations/integrations.service.js";
import {
  integrationsHealthSchema,
  integrationsUpdateSchema,
} from "@/integrations/integrations.schemas.js";
import type { ConversationModelProvider } from "@/providers/conversation-model.provider.js";
import type { TelephonyProvider } from "@/providers/telephony.provider.js";
import type { SpeechToTextProvider, TtsProvider } from "@/providers/types.js";

type IntegrationRoutesDeps = {
  integrationsService: IntegrationsService;
  telephonyProvider: TelephonyProvider;
  ttsProvider: TtsProvider;
  sttProvider: SpeechToTextProvider;
  llmProvider: ConversationModelProvider;
};

export async function registerIntegrationsRoutes(
  app: FastifyInstance,
  deps: IntegrationRoutesDeps,
): Promise<void> {
  app.get(
    "/api/integrations",
    {
      preHandler: [app.authenticate],
    },
    async (_request, reply) => {
      const data = await deps.integrationsService.getMasked();
      return reply.send(data);
    },
  );

  app.put(
    "/api/integrations",
    {
      preHandler: [app.authenticate, app.verifyCsrf],
    },
    async (request, reply) => {
      const parsed = integrationsUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
      }

      if (!request.adminId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const data = await deps.integrationsService.update(
        request.adminId,
        parsed.data,
      );
      return reply.send(data);
    },
  );

  app.post(
    "/api/integrations/health",
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const parsed = integrationsHealthSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
      }

      const include = parsed.data.includeProviders ?? [
        "telephony",
        "tts",
        "llm",
        "stt",
      ];

      const checks: Record<string, unknown> = {};
      if (include.includes("telephony")) {
        checks.telephony = await deps.telephonyProvider.healthcheck();
      }
      if (include.includes("tts")) {
        checks.tts = await deps.ttsProvider.healthcheck();
      }
      if (include.includes("llm")) {
        checks.llm = await deps.llmProvider.healthcheck();
      }
      if (include.includes("stt")) {
        checks.stt = await deps.sttProvider.healthcheck();
      }

      const ok = Object.values(checks).every(
        (value) => (value as { ok?: boolean }).ok !== false,
      );

      return reply.send({ ok, checks });
    },
  );
}
