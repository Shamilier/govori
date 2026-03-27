import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerTenantsRoutes } from "@/tenants/tenants.routes.js";

const tenantsService = {
  list: vi.fn(async () => ({
    items: [{ id: "tenant-1", name: "Client", slug: "client", isActive: true }],
  })),
  create: vi.fn(async () => ({
    id: "tenant-1",
    name: "Client",
    slug: "client",
    isActive: true,
  })),
};

describe("Tenants routes", () => {
  it("returns tenants list", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.adminId = "admin-1";
    });
    app.decorate("verifyCsrf", async () => undefined);

    await registerTenantsRoutes(app, { tenantsService: tenantsService as never });

    const response = await app.inject({ method: "GET", url: "/api/tenants" });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);

    await app.close();
  });

  it("creates tenant when slug contains non-latin symbols", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.adminId = "admin-1";
    });
    app.decorate("verifyCsrf", async () => undefined);

    await registerTenantsRoutes(app, { tenantsService: tenantsService as never });

    const response = await app.inject({
      method: "POST",
      url: "/api/tenants",
      payload: {
        name: "Clinic",
        slug: "Мой клиент",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(tenantsService.create).toHaveBeenCalled();

    await app.close();
  });
});
