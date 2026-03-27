import type { PrismaClient } from "@prisma/client";
import type { AuditService } from "@/audit/audit.service.js";
import type { CreateTenantInput } from "@/tenants/tenants.schemas.js";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export class TenantsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  async list(): Promise<Record<string, unknown>> {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: {
          select: {
            agents: true,
            phoneNumbers: true,
          },
        },
      },
    });

    return {
      items: tenants.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        isActive: tenant.isActive,
        agentsCount: tenant._count.agents,
        numbersCount: tenant._count.phoneNumbers,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      })),
    };
  }

  async ensureDefaultTenant(): Promise<{ id: string; name: string }> {
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

    return { id: tenant.id, name: tenant.name };
  }

  async create(
    adminId: string,
    input: CreateTenantInput,
  ): Promise<Record<string, unknown>> {
    const slugSource =
      input.slug && input.slug.trim().length > 0 ? input.slug : input.name;
    const baseSlug = slugify(slugSource) || "tenant";
    let slug = baseSlug;

    for (let i = 1; i <= 99; i += 1) {
      const exists = await this.prisma.tenant.findUnique({ where: { slug } });
      if (!exists) {
        break;
      }
      slug = `${baseSlug}-${i}`;
    }

    const tenant = await this.prisma.tenant.create({
      data: {
        name: input.name.trim(),
        slug,
        isActive: input.isActive,
      },
    });

    await this.auditService.log({
      adminId,
      action: "TENANT_CREATED",
      entityType: "tenant",
      entityId: tenant.id,
      payload: {
        slug: tenant.slug,
      },
    });

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      isActive: tenant.isActive,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    };
  }
}
