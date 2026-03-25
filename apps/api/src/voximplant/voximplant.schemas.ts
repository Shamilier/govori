import { z } from "zod";

export const voximplantExecuteFunctionSchema = z.object({
  function_id: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional().default({}),
  call_data: z
    .object({
      call_id: z.string().optional(),
      chat_id: z.string().optional(),
      assistant_id: z.string().optional(),
      caller_number: z.string().optional(),
    })
    .optional()
    .default({}),
});

export const voximplantLogSchema = z.object({
  assistant_id: z.string().optional(),
  chat_id: z.string().optional(),
  call_id: z.string(),
  caller_number: z.string().optional(),
  type: z.string().default("conversation"),
  data: z
    .object({
      user_message: z.string().optional(),
      assistant_message: z.string().optional(),
      function_result: z.unknown().optional(),
    })
    .optional()
    .default({}),
});

export type VoximplantExecuteFunctionInput = z.infer<
  typeof voximplantExecuteFunctionSchema
>;
export type VoximplantLogInput = z.infer<typeof voximplantLogSchema>;
