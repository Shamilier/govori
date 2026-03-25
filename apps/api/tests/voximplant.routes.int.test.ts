import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

const voximplantService = {
  getAssistantConfig: vi.fn(async () => ({
    assistant_name: "Agent",
    model: "gpt-4.1-mini",
  })),
  executeFunction: vi.fn(async () => ({ success: true })),
  ingestLog: vi.fn(async () => ({ ok: true, callId: "call-1" })),
};

describe("Voximplant routes", () => {
  it("returns config", async () => {
    process.env.DATABASE_URL ??=
      "postgresql://postgres:postgres@localhost:5432/govori";
    process.env.JWT_SECRET ??= "test-secret-test-secret";
    process.env.ENCRYPTION_KEY ??= "test-encryption-key-123456";

    const { registerVoximplantRoutes } =
      await import("@/voximplant/voximplant.routes.js");

    const app = Fastify();
    await registerVoximplantRoutes(app, {
      voximplantService: voximplantService as never,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/voximplant/assistants/config/assistant-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ assistant_name: "Agent" });

    await app.close();
  });
});
