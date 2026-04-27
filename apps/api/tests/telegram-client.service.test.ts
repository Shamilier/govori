import { describe, expect, it, vi } from "vitest";
import { TelegramClientService } from "@/telegram-client/telegram-client.service.js";

describe("TelegramClientService", () => {
  it("returns recent calls with recording URL and transcript messages", async () => {
    const startedAt = new Date("2026-04-27T10:00:00.000Z");
    const messageCreatedAt = new Date("2026-04-27T10:00:10.000Z");
    const prisma = {
      telegramBinding: {
        findUnique: vi.fn().mockResolvedValue({
          tenantId: "tenant-1",
          boundAgentId: null,
        }),
      },
      agent: {
        findFirst: vi.fn().mockResolvedValue({
          id: "agent-1",
          name: "Main Agent",
          systemPrompt: "Ты голосовой агент.",
          ttsVoiceId: "Kore",
          language: "ru-RU",
          isActive: true,
          updatedAt: startedAt,
        }),
      },
      call: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "call-1",
            externalCallId: "vox-1",
            status: "COMPLETED",
            direction: "OUTBOUND",
            callerPhone: "+79014172705",
            calleePhone: "+79990001122",
            startedAt,
            endedAt: new Date("2026-04-27T10:02:00.000Z"),
            durationSec: 120,
            recordingUrl: "https://records.example/call-1.mp3",
            transcriptText: "USER: Алло\nASSISTANT: Добрый день",
            messages: [
              {
                id: "msg-1",
                role: "USER",
                text: "Алло",
                sequenceNo: 1,
                createdAt: messageCreatedAt,
              },
              {
                id: "msg-2",
                role: "ASSISTANT",
                text: "Добрый день",
                sequenceNo: 2,
                createdAt: messageCreatedAt,
              },
            ],
          },
        ]),
      },
    };

    const service = new TelegramClientService(
      prisma as never,
      {} as never,
      {} as never,
    );

    const result = await service.getState(1297355532);

    expect(prisma.call.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-1" },
        include: expect.objectContaining({
          messages: expect.objectContaining({
            orderBy: { sequenceNo: "asc" },
          }),
        }),
      }),
    );
    expect(result).toMatchObject({
      recentCalls: [
        {
          id: "call-1",
          recordingUrl: "https://records.example/call-1.mp3",
          durationSec: 120,
          messages: [
            { role: "USER", text: "Алло" },
            { role: "ASSISTANT", text: "Добрый день" },
          ],
        },
      ],
    });
  });
});
