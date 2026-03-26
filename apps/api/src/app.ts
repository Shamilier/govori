import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { env } from "@/common/env.js";
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/common/constants.js";
import { prisma as defaultPrisma } from "@/db/prisma.js";
import { RedisService } from "@/redis/redis.service.js";
import { AuthService } from "@/auth/auth.service.js";
import { AuditService } from "@/audit/audit.service.js";
import { IntegrationsService } from "@/integrations/integrations.service.js";
import { VoximplantTelephonyProvider } from "@/providers/voximplant-telephony.provider.js";
import { MockSpeechToTextProvider } from "@/providers/mock-stt.provider.js";
import { CartesiaTtsProvider } from "@/providers/cartesia-tts.provider.js";
import { OpenAIConversationProvider } from "@/providers/openai-conversation.provider.js";
import { ConversationService } from "@/calls/conversation.service.js";
import { AgentService } from "@/agent/agent.service.js";
import { CallsService } from "@/calls/calls.service.js";
import { CallSessionOrchestrator } from "@/calls/call-session.orchestrator.js";
import { registerAuthRoutes } from "@/auth/auth.routes.js";
import { registerAgentRoutes } from "@/agent/agent.routes.js";
import { registerIntegrationsRoutes } from "@/integrations/integrations.routes.js";
import { registerCallsRoutes } from "@/calls/calls.routes.js";
import { registerTelephonyWebhooks } from "@/webhooks/telephony.routes.js";
import { registerHealthRoutes } from "@/health/health.routes.js";
import { VoximplantService } from "@/voximplant/voximplant.service.js";
import { registerVoximplantRoutes } from "@/voximplant/voximplant.routes.js";
import type { PrismaClient } from "@prisma/client";
import type { ConversationModelProvider } from "@/providers/conversation-model.provider.js";
import type { TelephonyProvider } from "@/providers/telephony.provider.js";
import type { SpeechToTextProvider, TtsProvider } from "@/providers/types.js";

export type BuildAppOptions = {
  prisma?: PrismaClient;
  redis?: RedisService;
  telephonyProvider?: TelephonyProvider;
  sttProvider?: SpeechToTextProvider;
  ttsProvider?: TtsProvider;
  llmProvider?: ConversationModelProvider;
};

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      env.NODE_ENV === "development"
        ? {
            transport: {
              target: "pino-pretty",
            },
          }
        : true,
  });

  const prisma = options.prisma ?? defaultPrisma;
  const redis = options.redis ?? new RedisService();
  await redis.connect();

  const auditService = new AuditService(prisma);
  const integrationsService = new IntegrationsService(prisma, auditService);

  const telephonyProvider =
    options.telephonyProvider ?? new VoximplantTelephonyProvider();
  const sttProvider = options.sttProvider ?? new MockSpeechToTextProvider();
  const ttsProvider =
    options.ttsProvider ??
    new CartesiaTtsProvider({
      getApiKey: async () =>
        (await integrationsService.getDecrypted()).cartesia.apiKey,
      getVoiceId: async () =>
        (await integrationsService.getDecrypted()).cartesia.voiceId,
      getModelId: async () =>
        (await integrationsService.getDecrypted()).cartesia.modelId,
    });

  const llmProvider =
    options.llmProvider ??
    new OpenAIConversationProvider({
      getApiKey: async () =>
        (await integrationsService.getDecrypted()).llm.apiKey,
      getModel: async () =>
        (await integrationsService.getDecrypted()).llm.model,
    });

  const conversationService = new ConversationService(llmProvider);
  const authService = new AuthService(prisma);
  const agentService = new AgentService(
    prisma,
    auditService,
    ttsProvider,
    conversationService,
  );
  const callsService = new CallsService(prisma);
  const voximplantService = new VoximplantService(
    prisma,
    integrationsService,
    conversationService,
    ttsProvider,
    redis,
  );
  const orchestrator = new CallSessionOrchestrator(
    prisma,
    redis,
    telephonyProvider,
    sttProvider,
    ttsProvider,
    conversationService,
  );

  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
  });

  await app.register(cookie);
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: SESSION_COOKIE_NAME,
      signed: false,
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_TIME_WINDOW,
    skipOnError: true,
    allowList: (request) =>
      request.url.startsWith("/api/health") ||
      request.url.startsWith("/api/webhooks/telephony"),
  });

  app.decorate("authenticate", async (request, reply) => {
    try {
      const payload = (await request.jwtVerify()) as { adminId: string };
      request.adminId = payload.adminId;
    } catch {
      reply.code(401).send({ error: "UNAUTHORIZED" });
    }
  });

  app.decorate("verifyCsrf", async (request, reply) => {
    const headerToken = request.headers["x-csrf-token"];
    const csrfHeader = Array.isArray(headerToken)
      ? headerToken[0]
      : headerToken;
    const csrfCookie = request.cookies[CSRF_COOKIE_NAME];

    if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
      return reply.code(403).send({ error: "CSRF_VALIDATION_FAILED" });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    requestScopedLog(app, error);

    if (reply.sent) {
      return;
    }

    reply.code(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message:
        env.NODE_ENV === "development" && error instanceof Error
          ? error.message
          : undefined,
    });
  });

  await registerHealthRoutes(app, { prisma, redis });
  await registerAuthRoutes(app, { authService, auditService });
  await registerAgentRoutes(app, { agentService });
  await registerIntegrationsRoutes(app, {
    integrationsService,
    telephonyProvider,
    ttsProvider,
    sttProvider,
    llmProvider,
  });
  await registerVoximplantRoutes(app, { voximplantService });
  await registerCallsRoutes(app, { callsService });
  await registerTelephonyWebhooks(app, { orchestrator });

  app.addHook("onClose", async () => {
    await redis.close();
    await prisma.$disconnect();
  });

  return app;
}

function requestScopedLog(app: FastifyInstance, error: unknown): void {
  if (error instanceof Error) {
    app.log.error({ err: error }, error.message);
  } else {
    app.log.error({ err: error }, "Unhandled error");
  }
}
