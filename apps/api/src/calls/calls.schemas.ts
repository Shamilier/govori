import { z } from "zod";

export const callsQuerySchema = z.object({
  status: z.string().optional(),
  phone: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const startOutboundCallSchema = z.object({
  to: z.string().min(3),
  from: z.string().optional(),
  assistantId: z.string().optional(),
  ruleId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export type CallsQuery = z.infer<typeof callsQuerySchema>;
export type StartOutboundCallInput = z.infer<typeof startOutboundCallSchema>;
