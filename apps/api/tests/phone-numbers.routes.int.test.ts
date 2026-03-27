import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerPhoneNumbersRoutes } from "@/phone-numbers/phone-numbers.routes.js";

const phoneNumbersService = {
  list: vi.fn(async () => ({
    items: [
      {
        id: "num-1",
        e164: "+79990001122",
        label: "Main",
        provider: "voximplant",
        isActive: true,
      },
    ],
  })),
  create: vi.fn(async () => ({
    id: "num-1",
    e164: "+79990001122",
    label: "Main",
    provider: "voximplant",
    isActive: true,
  })),
  update: vi.fn(async () => ({
    id: "num-1",
    e164: "+79990001122",
    label: "Main",
    provider: "voximplant",
    isActive: false,
  })),
};

describe("Phone numbers routes", () => {
  it("returns numbers list", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request) => {
      request.adminId = "admin-1";
    });
    app.decorate("verifyCsrf", async () => undefined);

    await registerPhoneNumbersRoutes(app, {
      phoneNumbersService: phoneNumbersService as never,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/phone-numbers",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);

    await app.close();
  });
});
