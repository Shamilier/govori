import crypto from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { AuditService } from "@/audit/audit.service.js";
import type { CrmService } from "@/crm/crm.service.js";
import type { IntegrationsService } from "@/integrations/integrations.service.js";
import type { ProvisionClientInput } from "@/onboarding/onboarding.schemas.js";

const ACCESS_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeAccessCode(accessCode: string): string {
  return accessCode
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
}

function hashAccessCode(accessCode: string): string {
  return crypto.createHash("sha256").update(accessCode).digest("hex");
}

function generateAccessCode(): string {
  const bytes = crypto.randomBytes(12);
  let code = "";
  for (const byte of bytes) {
    code += ACCESS_CODE_CHARS.charAt(byte % ACCESS_CODE_CHARS.length);
  }
  return code;
}

function formatAccessCode(accessCode: string): string {
  if (accessCode.length !== 12) {
    return accessCode;
  }
  return `${accessCode.slice(0, 4)}-${accessCode.slice(4, 8)}-${accessCode.slice(8, 12)}`;
}

export class OnboardingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly integrationsService: IntegrationsService,
    private readonly crmService: CrmService,
  ) {}

  async provisionClient(
    adminId: string,
    input: ProvisionClientInput,
  ): Promise<Record<string, unknown>> {
    const existingNumber = await this.prisma.phoneNumber.findUnique({
      where: { e164: input.phoneNumberE164 },
      select: { id: true },
    });
    if (existingNumber) {
      throw new Error("PHONE_NUMBER_ALREADY_EXISTS");
    }

    if (input.telegramAccess.accessCode) {
      const normalizedCode = normalizeAccessCode(input.telegramAccess.accessCode);
      const existingCode = await this.prisma.tenantAccessCode.findUnique({
        where: { codeHash: hashAccessCode(normalizedCode) },
        select: { id: true },
      });
      if (existingCode) {
        throw new Error("ACCESS_CODE_ALREADY_EXISTS");
      }
    }

    const baseSlug = slugify(input.slug || input.name) || "tenant";
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
        isActive: true,
      },
    });

    const agent = await this.prisma.agent.create({
      data: {
        tenantId: tenant.id,
        name: input.agentName,
        systemPrompt: input.systemPrompt,
        greetingText: input.greetingText,
        fallbackText: input.fallbackText,
        goodbyeText: input.goodbyeText,
        language: input.language,
        ttsVoiceId: input.ttsVoiceId,
        ttsProvider: "gemini",
        sttProvider: "gemini",
        llmProvider: "gemini",
      },
    });

    const phoneNumber = await this.prisma.phoneNumber.create({
      data: {
        tenantId: tenant.id,
        agentId: agent.id,
        e164: input.phoneNumberE164,
        label: input.phoneLabel ?? "Primary outbound number",
        provider: "voximplant",
        isActive: true,
      },
    });

    await this.integrationsService.updateTenant(adminId, tenant.id, {
      telephonyProvider: "voximplant",
      phoneNumberE164: input.phoneNumberE164,
      voximplantApplicationId: input.voximplant.applicationId,
      voximplantAccountId: input.voximplant.accountId,
      voximplantApiKey: input.voximplant.apiKey,
      voximplantApiSecret: input.voximplant.apiSecret,
      voximplantOutboundRuleId: input.voximplant.outboundRuleId,
      geminiApiKey: input.gemini.apiKey,
      geminiLlmModel: input.gemini.llmModel,
      geminiTtsModel: input.gemini.ttsModel,
      geminiTtsVoice: input.gemini.ttsVoice,
      geminiSttModel: input.gemini.sttModel,
    });

    const crm = input.crm
      ? await this.crmService.upsertForTenant(adminId, tenant.id, {
          provider: input.crm.provider,
          name: input.crm.name,
          isActive: input.crm.isActive,
          config: input.crm.config,
          mapping: input.crm.mapping,
        })
      : null;

    const telegramAccess =
      input.telegramAccess.enabled === false
        ? null
        : await this.createTelegramAccessCode(adminId, tenant.id, agent.id, input);

    await this.auditService.log({
      adminId,
      action: "CLIENT_PROVISIONED",
      entityType: "tenant",
      entityId: tenant.id,
      payload: {
        phoneNumberE164: phoneNumber.e164,
        agentId: agent.id,
        crmProvider: input.crm?.provider ?? null,
      },
    });

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
      agent: {
        id: agent.id,
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        ttsVoiceId: agent.ttsVoiceId,
      },
      phoneNumber: {
        id: phoneNumber.id,
        e164: phoneNumber.e164,
        assistantId: phoneNumber.e164,
        provider: phoneNumber.provider,
      },
      telegramAccess,
      crm,
      nextSteps: [
        "Assign this E.164 number to the Voximplant inbound scenario.",
        "Use the same outbound rule id in tenant integrations or global fallback.",
        "Send telegramAccess.accessCode to the client so they can bind /start in the bot.",
      ],
    };
  }

  private async createTelegramAccessCode(
    adminId: string,
    tenantId: string,
    agentId: string,
    input: ProvisionClientInput,
  ): Promise<Record<string, unknown>> {
    const normalizedCode = input.telegramAccess.accessCode
      ? normalizeAccessCode(input.telegramAccess.accessCode)
      : generateAccessCode();

    const created = await this.prisma.tenantAccessCode.create({
      data: {
        tenantId,
        agentId,
        label: input.telegramAccess.label ?? `Telegram access for ${input.name}`,
        codeHash: hashAccessCode(normalizedCode),
        isActive: true,
        expiresAt: input.telegramAccess.expiresAt ?? null,
        maxUses: input.telegramAccess.maxUses,
        createdByAdminId: adminId,
      },
    });

    return {
      id: created.id,
      tenantId: created.tenantId,
      agentId: created.agentId,
      label: created.label,
      accessCode: formatAccessCode(normalizedCode),
      isActive: created.isActive,
      expiresAt: created.expiresAt,
      maxUses: created.maxUses,
      usedCount: created.usedCount,
      createdAt: created.createdAt,
    };
  }

  isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    );
  }
}
