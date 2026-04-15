import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { TelegramAuthService } from "@/telegram-auth/telegram-auth.service.js";

function hashCode(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

describe("TelegramAuthService access code", () => {
  it("creates new access code with normalized hash and dashed output", async () => {
    const createdAt = new Date("2026-04-16T00:00:00.000Z");
    const prisma = {
      admin: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "admin-1", tenantId: "tenant-1" }),
      },
      agent: {
        findFirst: vi.fn(),
      },
      tenantAccessCode: {
        create: vi.fn(async ({ data }: { data: { [key: string]: unknown } }) => ({
          id: "code-1",
          tenantId: "tenant-1",
          agentId: data.agentId ?? null,
          label: data.label ?? null,
          isActive: true,
          expiresAt: data.expiresAt ?? null,
          maxUses: data.maxUses ?? null,
          usedCount: 0,
          createdAt,
        })),
      },
    } as unknown as ConstructorParameters<typeof TelegramAuthService>[0];

    const service = new TelegramAuthService(prisma, "https://disciplaner.online", 10);

    const result = await service.createTenantAccessCode("admin-1", {
      label: "client-1",
    });

    expect(result.accessCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const normalized = result.accessCode.replace(/-/g, "");

    const createCall = (prisma as any).tenantAccessCode.create.mock.calls[0][0];
    expect(createCall.data.codeHash).toBe(hashCode(normalized));
  });

  it("binds by legacy code hash with dashes", async () => {
    const legacyCode = "S6SR-GG4Y-65LP";
    const legacyHash = hashCode(legacyCode);

    const tx = {
      tenantAccessCode: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: "code-1",
            tenantId: "tenant-1",
            agentId: null,
            createdByAdminId: "admin-1",
            isActive: true,
            expiresAt: null,
            maxUses: 1,
            usedCount: 0,
          }),
        update: vi.fn(),
      },
      agent: {
        findFirst: vi.fn(),
      },
      telegramBinding: {
        upsert: vi.fn().mockResolvedValue({
          tenantId: "tenant-1",
          telegramUserId: BigInt(1297355532),
          boundAgentId: null,
        }),
      },
    };

    const prisma = {
      $transaction: vi.fn(async (fn: (arg: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as ConstructorParameters<typeof TelegramAuthService>[0];

    const service = new TelegramAuthService(prisma, "https://disciplaner.online", 10);

    const result = await service.bindByAccessCode({
      telegramUserId: 1297355532,
      accessCode: legacyCode,
    });

    expect(result.tenantId).toBe("tenant-1");
    const findCalls = tx.tenantAccessCode.findUnique.mock.calls;
    expect(findCalls[1][0].where.codeHash).toBe(legacyHash);
    expect(tx.tenantAccessCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "code-1" },
        data: expect.objectContaining({ usedCount: 1, lastUsedAt: expect.any(Date) }),
      }),
    );
  });
});
