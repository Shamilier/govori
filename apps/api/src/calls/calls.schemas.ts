import { z } from "zod";

export const callsQuerySchema = z.object({
  status: z.string().optional(),
  phone: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CallsQuery = z.infer<typeof callsQuerySchema>;
