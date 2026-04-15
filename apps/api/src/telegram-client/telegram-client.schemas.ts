import { z } from "zod";

const safeTelegramIdSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

const e164Schema = z.string().regex(/^\+[1-9]\d{7,14}$/);

export const telegramClientStateQuerySchema = z.object({
  telegram_user_id: safeTelegramIdSchema,
});

export const telegramClientUpdatePromptSchema = z.object({
  telegramUserId: safeTelegramIdSchema,
  prompt: z.string().trim().min(10).max(20000),
});

export const telegramClientUpdateVoiceSchema = z.object({
  telegramUserId: safeTelegramIdSchema,
  voiceId: z.string().trim().min(1).max(120),
});

export const telegramClientStartCampaignSchema = z.object({
  telegramUserId: safeTelegramIdSchema,
  numbers: z.array(e164Schema).min(1).max(200),
  from: e164Schema.optional(),
  ruleId: z.string().trim().min(1).max(64).optional(),
});

export type TelegramClientStateQuery = z.infer<
  typeof telegramClientStateQuerySchema
>;
export type TelegramClientUpdatePromptInput = z.infer<
  typeof telegramClientUpdatePromptSchema
>;
export type TelegramClientUpdateVoiceInput = z.infer<
  typeof telegramClientUpdateVoiceSchema
>;
export type TelegramClientStartCampaignInput = z.infer<
  typeof telegramClientStartCampaignSchema
>;
