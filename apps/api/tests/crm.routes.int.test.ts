import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerCrmRoutes } from "@/crm/crm.routes.js";

const crmService = {
  listTemplates: vi.fn(() => ({
    items: [{ provider: "custom_webhook", name: "Custom webhook" }],
  })),
  getForTenant: vi.fn(async () => ({
    tenantId: "tenant-1",
    integration: null,
  })),
  upsertForTenant: vi.fn(async () => ({
    tenantId: "tenant-1",
    provider: "custom_webhook",
    isActive: true,
  })),
};

describe("CRM routes", () => {
  it("returns templates", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.adminId = "admin-1";
    });
    app.decorate("verifyCsrf", async () => undefined);

    await registerCrmRoutes(app, { crmService: crmService as never });

    const response = await app.inject({
      method: "GET",
      url: "/api/crm/templates",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);

    await app.close();
  });

  it("updates tenant CRM config", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.adminId = "admin-1";
    });
    app.decorate("verifyCsrf", async () => undefined);

    await registerCrmRoutes(app, { crmService: crmService as never });

    const response = await app.inject({
      method: "PUT",
      url: "/api/tenants/tenant-1/crm",
      payload: {
        provider: "custom_webhook",
        isActive: true,
        config: { webhookUrl: "https://example.com/hook" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(crmService.upsertForTenant).toHaveBeenCalled();

    await app.close();
  });
});
