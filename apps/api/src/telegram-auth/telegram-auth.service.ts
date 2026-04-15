import crypto from "node:crypto";
import type { Admin, Prisma, PrismaClient } from "@prisma/client";

const DEFAULT_AUTH_LINK_PATH = "/telegram/connect";
const ACCESS_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type TelegramBindingResult = {
  tenantId: string;
  telegramUserId: number;
  boundAgentId: string | null;
};

export type CreateAuthLinkInput = {
  telegramUserId: number;
  chatId: number;
};

export type CreateAuthLinkResult = {
  url: string;
  expiresAt: Date;
};

export type ConsumeAuthTokenInput = {
  token: string;
  adminId: string;
};

export type BindByAccessCodeInput = {
  telegramUserId: number;
  accessCode: string;
};

export type CreateTenantAccessCodeInput = {
  label?: string;
  agentId?: string;
  accessCode?: string;
  expiresAt?: Date;
  maxUses?: number;
};

export type CreateTenantAccessCodeResult = {
  id: string;
  tenantId: string;
  agentId: string | null;
  label: string | null;
  accessCode: string;
  isActive: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  createdAt: Date;
};

export type TenantAccessCodeItem = {
  id: string;
  tenantId: string;
  agentId: string | null;
  label: string | null;
  isActive: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TenantAgentAccessItem = {
  id: string;
  name: string;
  isActive: boolean;
  ttsVoiceId: string;
  updatedAt: Date;
};

export type TelegramAuthErrorCode =
  | "ADMIN_NOT_FOUND"
  | "ADMIN_TENANT_REQUIRED"
  | "TOKEN_NOT_FOUND"
  | "TOKEN_EXPIRED"
  | "TOKEN_ALREADY_USED"
  | "TELEGRAM_ID_OUT_OF_RANGE"
  | "ACCESS_CODE_INVALID"
  | "ACCESS_CODE_INACTIVE"
  | "ACCESS_CODE_EXPIRED"
  | "ACCESS_CODE_LIMIT_REACHED"
  | "ACCESS_CODE_AGENT_NOT_FOUND"
  | "ACCESS_CODE_ALREADY_EXISTS"
  | "ACCESS_CODE_NOT_FOUND";

export class TelegramAuthError extends Error {
  constructor(
    readonly code: TelegramAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TelegramAuthError";
  }
}

export class TelegramAuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly webOrigin: string,
    private readonly tokenTtlMin: number,
  ) {}

  async createAuthLink(
    input: CreateAuthLinkInput,
  ): Promise<CreateAuthLinkResult> {
    const token = this.generateOneTimeToken();
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + this.tokenTtlMin * 60_000);

    await this.prisma.telegramAuthToken.create({
      data: {
        tokenHash,
        telegramUserId: BigInt(input.telegramUserId),
        chatId: BigInt(input.chatId),
        expiresAt,
      },
    });

    const connectPath = `${DEFAULT_AUTH_LINK_PATH}?token=${encodeURIComponent(token)}`;
    const url = `${this.webOrigin.replace(/\/+$/, "")}${connectPath}`;

    return {
      url,
      expiresAt,
    };
  }

  async resolveBinding(
    telegramUserId: number,
  ): Promise<TelegramBindingResult | null> {
    const binding = await this.prisma.telegramBinding.findUnique({
      where: {
        telegramUserId: BigInt(telegramUserId),
      },
    });

    if (!binding) {
      return null;
    }

    return {
      tenantId: binding.tenantId,
      telegramUserId: this.toSafeNumber(binding.telegramUserId),
      boundAgentId: binding.boundAgentId,
    };
  }

  async consumeAuthToken(
    input: ConsumeAuthTokenInput,
  ): Promise<TelegramBindingResult> {
    const tokenHash = this.hashToken(input.token);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const authToken = await tx.telegramAuthToken.findUnique({
        where: { tokenHash },
      });

      if (!authToken) {
        throw new TelegramAuthError("TOKEN_NOT_FOUND", "Token not found");
      }

      if (authToken.usedAt) {
        throw new TelegramAuthError("TOKEN_ALREADY_USED", "Token already used");
      }

      if (authToken.expiresAt.getTime() <= now.getTime()) {
        throw new TelegramAuthError("TOKEN_EXPIRED", "Token expired");
      }

      const admin = await tx.admin.findUnique({ where: { id: input.adminId } });
      if (!admin) {
        throw new TelegramAuthError("ADMIN_NOT_FOUND", "Admin not found");
      }

      const tenantId = await this.resolveTenantIdForAdmin(tx, admin);

      const binding = await tx.telegramBinding.upsert({
        where: {
          telegramUserId: authToken.telegramUserId,
        },
        update: {
          tenantId,
          linkedByAdminId: admin.id,
          boundAgentId: null,
        },
        create: {
          tenantId,
          telegramUserId: authToken.telegramUserId,
          linkedByAdminId: admin.id,
          boundAgentId: null,
        },
      });

      await tx.telegramAuthToken.update({
        where: { id: authToken.id },
        data: {
          usedAt: now,
          consumedByAdminId: admin.id,
        },
      });

      return {
        tenantId: binding.tenantId,
        telegramUserId: this.toSafeNumber(binding.telegramUserId),
        boundAgentId: binding.boundAgentId,
      };
    });
  }

  async bindByAccessCode(
    input: BindByAccessCodeInput,
  ): Promise<TelegramBindingResult> {
    const normalizedCode = this.normalizeAccessCode(input.accessCode);
    const codeHash = this.hashAccessCode(normalizedCode);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const accessCode = await tx.tenantAccessCode.findUnique({
        where: { codeHash },
      });

      if (!accessCode) {
        throw new TelegramAuthError(
          "ACCESS_CODE_INVALID",
          "Access code is invalid",
        );
      }

      if (!accessCode.isActive) {
        throw new TelegramAuthError(
          "ACCESS_CODE_INACTIVE",
          "Access code is inactive",
        );
      }

      if (
        accessCode.expiresAt &&
        accessCode.expiresAt.getTime() <= now.getTime()
      ) {
        throw new TelegramAuthError(
          "ACCESS_CODE_EXPIRED",
          "Access code expired",
        );
      }

      if (
        typeof accessCode.maxUses === "number" &&
        accessCode.usedCount >= accessCode.maxUses
      ) {
        throw new TelegramAuthError(
          "ACCESS_CODE_LIMIT_REACHED",
          "Access code usage limit reached",
        );
      }

      if (accessCode.agentId) {
        const boundAgent = await tx.agent.findFirst({
          where: {
            id: accessCode.agentId,
            tenantId: accessCode.tenantId,
          },
          select: { id: true },
        });

        if (!boundAgent) {
          throw new TelegramAuthError(
            "ACCESS_CODE_AGENT_NOT_FOUND",
            "Bound agent not found",
          );
        }
      }

      const telegramUserIdBigInt = BigInt(input.telegramUserId);
      const binding = await tx.telegramBinding.upsert({
        where: {
          telegramUserId: telegramUserIdBigInt,
        },
        update: {
          tenantId: accessCode.tenantId,
          linkedByAdminId: accessCode.createdByAdminId ?? null,
          boundAgentId: accessCode.agentId ?? null,
        },
        create: {
          tenantId: accessCode.tenantId,
          telegramUserId: telegramUserIdBigInt,
          linkedByAdminId: accessCode.createdByAdminId ?? null,
          boundAgentId: accessCode.agentId ?? null,
        },
      });

      const nextUsedCount = accessCode.usedCount + 1;
      const deactivate =
        typeof accessCode.maxUses === "number" &&
        nextUsedCount >= accessCode.maxUses;

      await tx.tenantAccessCode.update({
        where: { id: accessCode.id },
        data: {
          usedCount: nextUsedCount,
          lastUsedAt: now,
          isActive: deactivate ? false : accessCode.isActive,
        },
      });

      return {
        tenantId: binding.tenantId,
        telegramUserId: this.toSafeNumber(binding.telegramUserId),
        boundAgentId: binding.boundAgentId,
      };
    });
  }

  async createTenantAccessCode(
    adminId: string,
    input: CreateTenantAccessCodeInput,
  ): Promise<CreateTenantAccessCodeResult> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, tenantId: true },
    });

    if (!admin) {
      throw new TelegramAuthError("ADMIN_NOT_FOUND", "Admin not found");
    }

    const tenantId = this.requireAdminTenant(admin.tenantId);
    const accessCode = input.accessCode
      ? this.normalizeAccessCode(input.accessCode)
      : this.generateAccessCode();

    if (input.agentId) {
      const agent = await this.prisma.agent.findFirst({
        where: {
          id: input.agentId,
          tenantId,
        },
        select: { id: true },
      });

      if (!agent) {
        throw new TelegramAuthError(
          "ACCESS_CODE_AGENT_NOT_FOUND",
          "Bound agent not found",
        );
      }
    }

    try {
      const created = await this.prisma.tenantAccessCode.create({
        data: {
          tenantId,
          agentId: input.agentId ?? null,
          label: input.label?.trim() || null,
          codeHash: this.hashAccessCode(accessCode),
          isActive: true,
          expiresAt: input.expiresAt ?? null,
          maxUses: input.maxUses ?? null,
          createdByAdminId: admin.id,
        },
      });

      return {
        id: created.id,
        tenantId: created.tenantId,
        agentId: created.agentId,
        label: created.label,
        accessCode,
        isActive: created.isActive,
        expiresAt: created.expiresAt,
        maxUses: created.maxUses,
        usedCount: created.usedCount,
        createdAt: created.createdAt,
      };
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        throw new TelegramAuthError(
          "ACCESS_CODE_ALREADY_EXISTS",
          "Access code already exists",
        );
      }
      throw error;
    }
  }

  async listTenantAccessCodes(
    adminId: string,
  ): Promise<TenantAccessCodeItem[]> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { tenantId: true },
    });

    if (!admin) {
      throw new TelegramAuthError("ADMIN_NOT_FOUND", "Admin not found");
    }

    const tenantId = this.requireAdminTenant(admin.tenantId);
    const codes = await this.prisma.tenantAccessCode.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });

    return codes.map((item) => ({
      id: item.id,
      tenantId: item.tenantId,
      agentId: item.agentId,
      label: item.label,
      isActive: item.isActive,
      expiresAt: item.expiresAt,
      maxUses: item.maxUses,
      usedCount: item.usedCount,
      lastUsedAt: item.lastUsedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }

  async listTenantAgents(adminId: string): Promise<TenantAgentAccessItem[]> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { tenantId: true },
    });

    if (!admin) {
      throw new TelegramAuthError("ADMIN_NOT_FOUND", "Admin not found");
    }

    const tenantId = this.requireAdminTenant(admin.tenantId);
    const agents = await this.prisma.agent.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        isActive: true,
        ttsVoiceId: true,
        updatedAt: true,
      },
    });

    return agents;
  }

  async revokeTenantAccessCode(adminId: string, codeId: string): Promise<void> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { tenantId: true },
    });

    if (!admin) {
      throw new TelegramAuthError("ADMIN_NOT_FOUND", "Admin not found");
    }

    const tenantId = this.requireAdminTenant(admin.tenantId);
    const existing = await this.prisma.tenantAccessCode.findUnique({
      where: { id: codeId },
      select: { id: true, tenantId: true },
    });

    if (!existing || existing.tenantId !== tenantId) {
      throw new TelegramAuthError(
        "ACCESS_CODE_NOT_FOUND",
        "Access code not found",
      );
    }

    await this.prisma.tenantAccessCode.update({
      where: { id: codeId },
      data: { isActive: false },
    });
  }

  private async resolveTenantIdForAdmin(
    tx: Prisma.TransactionClient,
    admin: Admin,
  ): Promise<string> {
    if (!admin.tenantId) {
      throw new TelegramAuthError(
        "ADMIN_TENANT_REQUIRED",
        "Admin tenant is required for Telegram binding",
      );
    }

    const tenant = await tx.tenant.findUnique({
      where: { id: admin.tenantId },
      select: { id: true },
    });

    if (!tenant) {
      throw new TelegramAuthError(
        "ADMIN_TENANT_REQUIRED",
        "Admin tenant is required for Telegram binding",
      );
    }

    return tenant.id;
  }

  private generateOneTimeToken(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private normalizeAccessCode(accessCode: string): string {
    return accessCode
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "");
  }

  private hashAccessCode(accessCode: string): string {
    return crypto.createHash("sha256").update(accessCode).digest("hex");
  }

  private generateAccessCode(): string {
    const bytes = crypto.randomBytes(12);
    let code = "";
    for (let i = 0; i < bytes.length; i++) {
      code += ACCESS_CODE_CHARS.charAt(bytes[i] % ACCESS_CODE_CHARS.length);
    }
    return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
  }

  private requireAdminTenant(tenantId: string | null): string {
    if (!tenantId) {
      throw new TelegramAuthError(
        "ADMIN_TENANT_REQUIRED",
        "Admin tenant is required for Telegram binding",
      );
    }
    return tenantId;
  }

  private toSafeNumber(value: bigint): number {
    const num = Number(value);

    if (!Number.isSafeInteger(num)) {
      throw new TelegramAuthError(
        "TELEGRAM_ID_OUT_OF_RANGE",
        "Telegram identifier is out of JavaScript safe integer range",
      );
    }

    return num;
  }
}
