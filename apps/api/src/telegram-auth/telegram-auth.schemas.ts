import { z } from "zod";

const safeTelegramIdSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

const safeChatIdSchema = z.coerce
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

export const createTelegramAuthLinkSchema = z.object({
  telegramUserId: safeTelegramIdSchema,
  chatId: safeChatIdSchema,
});

export const resolveTelegramBindingQuerySchema = z.object({
  telegram_user_id: safeTelegramIdSchema,
});

export const consumeTelegramAuthTokenSchema = z.object({
  token: z.string().min(16).max(512),
});

const accessCodeSchema = z
  .string()
  .trim()
  .min(6)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const bindTelegramByAccessCodeSchema = z.object({
  telegramUserId: safeTelegramIdSchema,
  accessCode: accessCodeSchema,
});

export const createTenantAccessCodeSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  agentId: z.string().trim().min(1).max(64).optional(),
  accessCode: accessCodeSchema.optional(),
  expiresAt: z.coerce.date().optional(),
  maxUses: z.coerce.number().int().positive().max(100000).optional(),
});

export const revokeTenantAccessCodeParamsSchema = z.object({
  id: z.string().trim().min(1).max(64),
});

export type CreateTelegramAuthLinkInput = z.infer<
  typeof createTelegramAuthLinkSchema
>;

export type ResolveTelegramBindingQuery = z.infer<
  typeof resolveTelegramBindingQuerySchema
>;

export type ConsumeTelegramAuthTokenInput = z.infer<
  typeof consumeTelegramAuthTokenSchema
>;

export type BindTelegramByAccessCodeInput = z.infer<
  typeof bindTelegramByAccessCodeSchema
>;

export type CreateTenantAccessCodeInput = z.infer<
  typeof createTenantAccessCodeSchema
>;

export type RevokeTenantAccessCodeParams = z.infer<
  typeof revokeTenantAccessCodeParamsSchema
>;
