import { z } from "zod";
import { crmProviderSchema } from "@/crm/crm.schemas.js";

const e164Schema = z.string().trim().regex(/^\+[1-9]\d{6,14}$/);

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}, z.string().optional());

export const provisionClientSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: optionalTrimmedString,
  phoneNumberE164: e164Schema,
  phoneLabel: optionalTrimmedString,
  agentName: z.string().trim().min(1).max(120).default("Main Voice Agent"),
  systemPrompt: z.string().trim().min(10).max(20000),
  greetingText: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .default("Здравствуйте! Чем могу помочь?"),
  fallbackText: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .default("Извините, повторите, пожалуйста."),
  goodbyeText: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .default("Спасибо за звонок. До свидания!"),
  language: z.string().trim().min(2).max(20).default("ru-RU"),
  ttsVoiceId: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .default("JBFqnCBsd6RMkjVDRZzb"),
  voximplant: z
    .object({
      applicationId: optionalTrimmedString,
      accountId: optionalTrimmedString,
      apiKey: optionalTrimmedString,
      apiSecret: optionalTrimmedString,
      outboundRuleId: optionalTrimmedString,
    })
    .optional()
    .default({}),
  gemini: z
    .object({
      apiKey: optionalTrimmedString,
      llmModel: optionalTrimmedString,
      ttsModel: optionalTrimmedString,
      ttsVoice: optionalTrimmedString,
      sttModel: optionalTrimmedString,
    })
    .optional()
    .default({}),
  crm: z
    .object({
      provider: crmProviderSchema,
      name: optionalTrimmedString,
      isActive: z.boolean().optional().default(false),
      config: z.record(z.string(), z.unknown()).optional().default({}),
      mapping: z.record(z.string(), z.unknown()).optional().default({}),
    })
    .optional(),
  telegramAccess: z
    .object({
      enabled: z.boolean().optional().default(true),
      label: optionalTrimmedString,
      accessCode: optionalTrimmedString,
      maxUses: z.number().int().positive().max(100000).optional().default(1),
      expiresAt: z.coerce.date().optional(),
    })
    .optional()
    .default({}),
});

export type ProvisionClientInput = z.infer<typeof provisionClientSchema>;
