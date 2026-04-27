import { describe, expect, it, vi } from "vitest";
import { VoximplantService } from "@/voximplant/voximplant.service.js";

describe("VoximplantService", () => {
  it("stores recording URL from Voximplant logs", async () => {
    const agent = {
      id: "agent-1",
      tenantId: "tenant-1",
      name: "Main Agent",
      systemPrompt: "Ты голосовой агент.",
    };
    const prisma = {
      phoneNumber: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      tenant: {
        upsert: vi.fn().mockResolvedValue({ id: "tenant-1" }),
      },
      agent: {
        findFirst: vi.fn().mockResolvedValue(agent),
      },
      call: {
        upsert: vi.fn().mockResolvedValue({ id: "call-1" }),
      },
      callEvent: {
        create: vi.fn(),
      },
    };

    const service = new VoximplantService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.ingestLog({
      call_id: "vox-1",
      caller_number: "+79014172705",
      destination_number: "+79990001122",
      type: "recording_started",
      data: {
        direction: "outbound",
        recording_url: "https://records.example/vox-1.mp3",
      },
    });

    expect(prisma.call.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          recordingUrl: "https://records.example/vox-1.mp3",
        }),
        update: expect.objectContaining({
          recordingUrl: "https://records.example/vox-1.mp3",
        }),
      }),
    );
  });
});
