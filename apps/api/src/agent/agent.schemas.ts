import { z } from "zod";

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(100),
  systemPrompt: z.string().min(10).max(8000),
  greetingText: z.string().min(1).max(1000),
  fallbackText: z.string().min(1).max(1000),
  goodbyeText: z.string().min(1).max(1000),
  language: z.string().min(2).max(20),
  isActive: z.boolean(),
  interruptionEnabled: z.boolean(),
  silenceTimeoutMs: z.number().int().min(1000).max(60000),
  maxCallDurationSec: z.number().int().min(30).max(7200),
  maxTurns: z.number().int().min(1).max(100),
  responseTemperature: z.number().min(0).max(2),
  responseMaxTokens: z.number().int().min(32).max(2048),
  ttsProvider: z.string().min(1),
  ttsVoiceId: z.string().min(1),
  ttsSpeed: z.number().min(0.5).max(2),
  ttsSampleRate: z.number().int().min(8000).max(48000),
  sttProvider: z.string().min(1),
  llmProvider: z.string().min(1),
  recordCalls: z.boolean(),
  ttsTestPhrase: z.string().min(1).max(1000),
});

export const testTtsSchema = z.object({
  text: z.string().min(1).max(1000).optional(),
});

export const testPromptSchema = z.object({
  text: z.string().min(1).max(4000),
});

export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
