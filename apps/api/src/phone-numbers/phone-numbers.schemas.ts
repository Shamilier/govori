import { z } from "zod";

const e164Regex = /^\+[1-9]\d{6,14}$/;

const nullableString = z.string().trim().min(1).nullable().optional();

export const createPhoneNumberSchema = z.object({
  tenantId: z.string().min(1).optional(),
  agentId: nullableString,
  e164: z.string().trim().regex(e164Regex),
  label: z.string().trim().max(120).optional(),
  provider: z.string().trim().min(1).max(50).optional(),
  isActive: z.boolean().optional().default(true),
});

export const updatePhoneNumberSchema = z.object({
  tenantId: z.string().min(1).optional(),
  agentId: nullableString,
  e164: z.string().trim().regex(e164Regex).optional(),
  label: z.string().trim().max(120).nullable().optional(),
  provider: z.string().trim().min(1).max(50).optional(),
  isActive: z.boolean().optional(),
});

export type CreatePhoneNumberInput = z.infer<typeof createPhoneNumberSchema>;
export type UpdatePhoneNumberInput = z.infer<typeof updatePhoneNumberSchema>;
