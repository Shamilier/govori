import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerOnboardingRoutes } from "@/onboarding/onboarding.routes.js";

const onboardingService = {
  provisionClient: vi.fn(async () => ({
    tenant: { id: "tenant-1", name: "Client" },
    phoneNumber: { e164: "+79990001122" },
    telegramAccess: { accessCode: "ABCD-EFGH-IJKL" },
  })),
  isUniqueConstraintError: vi.fn(() => false),
};

describe("Onboarding routes", () => {
  it("provisions client", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.adminId = "admin-1";
    });
    app.decorate("verifyCsrf", async () => undefined);

    await registerOnboardingRoutes(app, {
      onboardingService: onboardingService as never,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/onboarding/clients",
      payload: {
        name: "Clinic North",
        phoneNumberE164: "+79990001122",
        systemPrompt: "Ты голосовой агент клиники. Отвечай кратко.",
        voximplant: {
          outboundRuleId: "12345",
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      tenant: { id: "tenant-1" },
      telegramAccess: { accessCode: "ABCD-EFGH-IJKL" },
    });
    expect(onboardingService.provisionClient).toHaveBeenCalled();

    await app.close();
  });
});
