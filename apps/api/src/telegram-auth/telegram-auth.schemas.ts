import { z } from "zod";

const safeTelegramIdSchema = z
  .coerce
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

const safeChatIdSchema = z
  .coerce
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

export type CreateTelegramAuthLinkInput = z.infer<
  typeof createTelegramAuthLinkSchema
>;

export type ResolveTelegramBindingQuery = z.infer<
  typeof resolveTelegramBindingQuerySchema
>;

export type ConsumeTelegramAuthTokenInput = z.infer<
  typeof consumeTelegramAuthTokenSchema
>;
