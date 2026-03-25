import type { Prisma, PrismaClient } from "@prisma/client";

export type AuditLogInput = {
  adminId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  payload?: Record<string, unknown>;
};

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async log(input: AuditLogInput): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminId: input.adminId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        payloadJson: input.payload as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
