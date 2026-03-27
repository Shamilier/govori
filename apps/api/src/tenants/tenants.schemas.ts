import { z } from "zod";

const optionalSlugSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}, z.string().max(120).optional());

export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: optionalSlugSchema,
  isActive: z.boolean().optional().default(true),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
