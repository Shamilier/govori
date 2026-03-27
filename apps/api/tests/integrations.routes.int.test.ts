import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerIntegrationsRoutes } from "@/integrations/integrations.routes.js";

const integrationsService = {
  getMasked: vi.fn(async () => ({ telephonyProvider: "voximplant" })),
  update: vi.fn(async () => ({ ok: true })),
  getMaskedForTenant: vi.fn(async () => ({ tenantId: "tenant-1" })),
  updateTenant: vi.fn(async () => ({ tenantId: "tenant-1", ok: true })),
};

const telephonyProvider = {
  healthcheck: vi.fn(async () => ({ ok: true, provider: "telephony" })),
};

const ttsProvider = {
  healthcheck: vi.fn(async () => ({ ok: true, provider: "tts" })),
};

const sttProvider = {
  healthcheck: vi.fn(async () => ({ ok: true, provider: "stt" })),
};

const llmProvider = {
  healthcheck: vi.fn(async () => ({ ok: true, provider: "llm" })),
};

describe("Integrations routes", () => {
  it("returns tenant integrations", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.adminId = "admin-1";
    });
    app.decorate("verifyCsrf", async () => undefined);

    await registerIntegrationsRoutes(app, {
      integrationsService: integrationsService as never,
      telephonyProvider: telephonyProvider as never,
      ttsProvider: ttsProvider as never,
      sttProvider: sttProvider as never,
      llmProvider: llmProvider as never,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/tenants/tenant-1/integrations",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ tenantId: "tenant-1" });

    await app.close();
  });
});
