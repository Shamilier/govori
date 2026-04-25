import type { Prisma, PrismaClient, TenantCrmIntegration } from "@prisma/client";
import type { AuditService } from "@/audit/audit.service.js";
import type { TenantCrmUpdateInput } from "@/crm/crm.schemas.js";
import { CRM_TEMPLATES } from "@/crm/crm.templates.js";

export class CrmService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  listTemplates(): Record<string, unknown> {
    return { items: CRM_TEMPLATES };
  }

  async getForTenant(tenantId: string): Promise<Record<string, unknown>> {
    await this.ensureTenant(tenantId);

    const integration = await this.prisma.tenantCrmIntegration.findUnique({
      where: { tenantId },
    });

    return {
      tenantId,
      integration: integration ? this.toDto(integration) : null,
      templates: CRM_TEMPLATES,
    };
  }

  async upsertForTenant(
    adminId: string,
    tenantId: string,
    input: TenantCrmUpdateInput,
  ): Promise<Record<string, unknown>> {
    await this.ensureTenant(tenantId);

    const template = CRM_TEMPLATES.find(
      (candidate) => candidate.provider === input.provider,
    );
    if (!template) {
      throw new Error("CRM_TEMPLATE_NOT_FOUND");
    }

    const integration = await this.prisma.tenantCrmIntegration.upsert({
      where: { tenantId },
      create: {
        tenantId,
        provider: input.provider,
        name: input.name?.trim() || template.name,
        isActive: input.isActive,
        configJson: input.config as Prisma.InputJsonValue,
        mappingJson:
          Object.keys(input.mapping).length > 0
            ? (input.mapping as Prisma.InputJsonValue)
            : (template.defaultMapping as Prisma.InputJsonValue),
      },
      update: {
        provider: input.provider,
        name: input.name?.trim() || template.name,
        isActive: input.isActive,
        configJson: input.config as Prisma.InputJsonValue,
        mappingJson:
          Object.keys(input.mapping).length > 0
            ? (input.mapping as Prisma.InputJsonValue)
            : (template.defaultMapping as Prisma.InputJsonValue),
      },
    });

    await this.auditService.log({
      adminId,
      action: "TENANT_CRM_UPDATED",
      entityType: "tenant_crm_integration",
      entityId: integration.id,
      payload: {
        tenantId,
        provider: input.provider,
        isActive: input.isActive,
      },
    });

    return this.toDto(integration);
  }

  private async ensureTenant(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      throw new Error("TENANT_NOT_FOUND");
    }
  }

  private toDto(integration: TenantCrmIntegration): Record<string, unknown> {
    return {
      id: integration.id,
      tenantId: integration.tenantId,
      provider: integration.provider,
      name: integration.name,
      isActive: integration.isActive,
      config: integration.configJson,
      mapping: integration.mappingJson,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    };
  }
}
