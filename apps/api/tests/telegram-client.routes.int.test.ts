import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerTelegramClientRoutes } from "@/telegram-client/telegram-client.routes.js";

const telegramClientService = {
  getState: vi.fn(async () => ({ tenantId: "tenant-1", agent: {} })),
  getReport: vi.fn(async () => ({
    tenantId: "tenant-1",
    summary: { total: 1 },
    calls: [],
  })),
  updatePrompt: vi.fn(async () => ({ ok: true })),
  updateVoice: vi.fn(async () => ({ ok: true })),
  startCampaign: vi.fn(async () => ({ ok: true })),
  downloadRecording: vi.fn(async () => ({
    statusCode: 206,
    headers: {
      "content-type": "audio/mpeg",
      "content-range": "bytes 0-3/4",
    },
    body: Buffer.from("test"),
  })),
};

describe("Telegram client routes", () => {
  it("proxies recording downloads with token and range", async () => {
    const app = Fastify();

    await registerTelegramClientRoutes(app, {
      telegramClientService: telegramClientService as never,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/telegram/client/calls/call-1/recording?token=token-1",
      headers: {
        range: "bytes=0-3",
      },
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers["content-type"]).toBe("audio/mpeg");
    expect(response.headers["content-range"]).toBe("bytes 0-3/4");
    expect(response.body).toBe("test");
    expect(telegramClientService.downloadRecording).toHaveBeenCalledWith(
      "call-1",
      "token-1",
      "bytes=0-3",
    );

    await app.close();
  });
});
