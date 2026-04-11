import { z } from "zod";

export const integrationsUpdateSchema = z.object({
  telephonyProvider: z.string().min(1),
  phoneNumberE164: z.string().trim().optional().nullable(),
  voximplantApplicationId: z.string().optional(),
  voximplantAccountId: z.string().optional(),
  voximplantApiKey: z.string().optional(),
  voximplantApiSecret: z.string().optional(),
  geminiApiKey: z.string().optional(),
  geminiLlmModel: z.string().optional(),
  geminiTtsModel: z.string().optional(),
  geminiTtsVoice: z.string().optional(),
  geminiSttModel: z.string().optional(),
  // Legacy fields kept for compatibility with old frontend payloads.
  cartesiaApiKey: z.string().optional(),
  cartesiaVoiceId: z.string().optional(),
  cartesiaModelId: z.string().optional(),
  llmApiKey: z.string().optional(),
  llmModel: z.string().optional(),
  sttApiKey: z.string().optional(),
});

export const integrationsHealthSchema = z.object({
  includeProviders: z
    .array(z.enum(["telephony", "tts", "llm", "stt"]))
    .optional(),
});

export type IntegrationsUpdateInput = z.infer<typeof integrationsUpdateSchema>;
