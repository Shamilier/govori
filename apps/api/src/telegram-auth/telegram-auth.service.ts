import crypto from "node:crypto";
import type { Admin, Prisma, PrismaClient } from "@prisma/client";

const DEFAULT_AUTH_LINK_PATH = "/telegram/connect";

export type TelegramBindingResult = {
  tenantId: string;
  telegramUserId: number;
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

export type TelegramAuthErrorCode =
  | "ADMIN_NOT_FOUND"
  | "TOKEN_NOT_FOUND"
  | "TOKEN_EXPIRED"
  | "TOKEN_ALREADY_USED"
  | "TELEGRAM_ID_OUT_OF_RANGE";

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

  async createAuthLink(input: CreateAuthLinkInput): Promise<CreateAuthLinkResult> {
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
        },
        create: {
          tenantId,
          telegramUserId: authToken.telegramUserId,
          linkedByAdminId: admin.id,
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
      };
    });
  }

  private async resolveTenantIdForAdmin(
    tx: Prisma.TransactionClient,
    admin: Admin,
  ): Promise<string> {
    if (admin.tenantId) {
      return admin.tenantId;
    }

    const existingTenant = await tx.tenant.findFirst({
      orderBy: { createdAt: "asc" },
    });

    const tenant =
      existingTenant ??
      (await tx.tenant.upsert({
        where: { name: "Default Tenant" },
        update: {},
        create: {
          name: "Default Tenant",
        },
      }));

    await tx.admin.update({
      where: { id: admin.id },
      data: { tenantId: tenant.id },
    });

    return tenant.id;
  }

  private generateOneTimeToken(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
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
