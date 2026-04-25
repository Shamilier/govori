import { z } from "zod";

export const crmProviderSchema = z.enum([
  "custom_webhook",
  "amocrm",
  "bitrix24",
  "hubspot",
]);

export const tenantCrmUpdateSchema = z.object({
  provider: crmProviderSchema,
  name: z.string().trim().min(1).max(120).optional(),
  isActive: z.boolean().optional().default(false),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  mapping: z.record(z.string(), z.unknown()).optional().default({}),
});

export type TenantCrmUpdateInput = z.infer<typeof tenantCrmUpdateSchema>;
