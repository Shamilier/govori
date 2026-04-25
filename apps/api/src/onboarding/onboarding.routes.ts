import type { FastifyInstance } from "fastify";
import { provisionClientSchema } from "@/onboarding/onboarding.schemas.js";
import type { OnboardingService } from "@/onboarding/onboarding.service.js";

type OnboardingRoutesDeps = {
  onboardingService: OnboardingService;
};

export async function registerOnboardingRoutes(
  app: FastifyInstance,
  deps: OnboardingRoutesDeps,
): Promise<void> {
  app.post(
    "/api/onboarding/clients",
    {
      preHandler: [app.authenticate, app.verifyCsrf],
    },
    async (request, reply) => {
      const parsed = provisionClientSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_PAYLOAD", details: parsed.error.flatten() });
      }

      if (!request.adminId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      try {
        const data = await deps.onboardingService.provisionClient(
          request.adminId,
          parsed.data,
        );
        return reply.code(201).send(data);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "PHONE_NUMBER_ALREADY_EXISTS"
        ) {
          return reply.code(409).send({ error: "PHONE_NUMBER_ALREADY_EXISTS" });
        }
        if (
          error instanceof Error &&
          error.message === "ACCESS_CODE_ALREADY_EXISTS"
        ) {
          return reply.code(409).send({ error: "ACCESS_CODE_ALREADY_EXISTS" });
        }
        if (deps.onboardingService.isUniqueConstraintError(error)) {
          return reply.code(409).send({ error: "CLIENT_RESOURCE_ALREADY_EXISTS" });
        }
        throw error;
      }
    },
  );
}
