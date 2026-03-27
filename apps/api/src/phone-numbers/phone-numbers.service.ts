import type { PrismaClient } from "@prisma/client";
import type { AuditService } from "@/audit/audit.service.js";
import type {
  CreatePhoneNumberInput,
  UpdatePhoneNumberInput,
} from "@/phone-numbers/phone-numbers.schemas.js";

function normalizeE164(value: string): string {
  return value.replace(/[^\d+]/g, "").trim();
}

export class PhoneNumbersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  private async ensureDefaultTenantId(): Promise<string> {
    const tenant = await this.prisma.tenant.upsert({
      where: { slug: "default" },
      update: { isActive: true },
      create: {
        id: "tenant_default",
        slug: "default",
        name: "Default Tenant",
        isActive: true,
      },
    });

    return tenant.id;
  }

  private async resolveAgentId(params: {
    tenantId: string;
    agentId?: string | null;
  }): Promise<string | null> {
    const requestedAgentId =
      typeof params.agentId === "string" ? params.agentId.trim() : params.agentId;

    if (requestedAgentId === null) {
      return null;
    }

    if (requestedAgentId) {
      const assignedAgent = await this.prisma.agent.findFirst({
        where: {
          id: requestedAgentId,
          tenantId: params.tenantId,
        },
      });
      if (!assignedAgent) {
        throw new Error("AGENT_NOT_FOUND_IN_TENANT");
      }
      return assignedAgent.id;
    }

    const defaultAgent = await this.prisma.agent.findFirst({
      where: {
        tenantId: params.tenantId,
        isActive: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return defaultAgent?.id ?? null;
  }

  async list(): Promise<Record<string, unknown>> {
    const items = await this.prisma.phoneNumber.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        tenant: true,
        agent: {
          select: {
            id: true,
            name: true,
            isActive: true,
          },
        },
      },
    });

    return {
      items: items.map((item) => ({
        id: item.id,
        e164: item.e164,
        label: item.label,
        provider: item.provider,
        isActive: item.isActive,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        tenant: {
          id: item.tenant.id,
          name: item.tenant.name,
          slug: item.tenant.slug,
        },
        agent: item.agent,
      })),
    };
  }

  async create(
    adminId: string,
    input: CreatePhoneNumberInput,
  ): Promise<Record<string, unknown>> {
    const tenantId = input.tenantId ?? (await this.ensureDefaultTenantId());
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new Error("TENANT_NOT_FOUND");
    }

    const e164 = normalizeE164(input.e164);
    const agentId = await this.resolveAgentId({
      tenantId,
      agentId: input.agentId,
    });

    const created = await this.prisma.phoneNumber.create({
      data: {
        tenantId,
        agentId,
        e164,
        label: input.label?.trim() || null,
        provider: input.provider?.trim() || "voximplant",
        isActive: input.isActive,
      },
      include: {
        tenant: true,
        agent: {
          select: {
            id: true,
            name: true,
            isActive: true,
          },
        },
      },
    });

    await this.auditService.log({
      adminId,
      action: "PHONE_NUMBER_CREATED",
      entityType: "phone_number",
      entityId: created.id,
      payload: {
        e164: created.e164,
        tenantId,
      },
    });

    return {
      id: created.id,
      e164: created.e164,
      label: created.label,
      provider: created.provider,
      isActive: created.isActive,
      tenant: {
        id: created.tenant.id,
        name: created.tenant.name,
        slug: created.tenant.slug,
      },
      agent: created.agent,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  async update(
    adminId: string,
    id: string,
    input: UpdatePhoneNumberInput,
  ): Promise<Record<string, unknown> | null> {
    const existing = await this.prisma.phoneNumber.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    const tenantId = input.tenantId ?? existing.tenantId;
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new Error("TENANT_NOT_FOUND");
    }

    const agentId = await this.resolveAgentId({
      tenantId,
      agentId:
        typeof input.agentId === "undefined" ? existing.agentId : input.agentId,
    });

    const updated = await this.prisma.phoneNumber.update({
      where: { id },
      data: {
        tenantId,
        agentId,
        e164: input.e164 ? normalizeE164(input.e164) : existing.e164,
        label:
          typeof input.label === "undefined"
            ? existing.label
            : (input.label?.trim() ?? null),
        provider:
          typeof input.provider === "undefined"
            ? existing.provider
            : input.provider.trim(),
        isActive:
          typeof input.isActive === "boolean"
            ? input.isActive
            : existing.isActive,
      },
      include: {
        tenant: true,
        agent: {
          select: {
            id: true,
            name: true,
            isActive: true,
          },
        },
      },
    });

    await this.auditService.log({
      adminId,
      action: "PHONE_NUMBER_UPDATED",
      entityType: "phone_number",
      entityId: updated.id,
      payload: {
        tenantId,
        e164: updated.e164,
      },
    });

    return {
      id: updated.id,
      e164: updated.e164,
      label: updated.label,
      provider: updated.provider,
      isActive: updated.isActive,
      tenant: {
        id: updated.tenant.id,
        name: updated.tenant.name,
        slug: updated.tenant.slug,
      },
      agent: updated.agent,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }
}
