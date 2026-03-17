import { z } from "zod";

export const evaluateJsInputSchema = z.object({
  session_id: z.string().min(1),
  page_id: z.string().min(1).optional(),
  expression: z.string().min(1),
  await_promise: z.boolean().default(true)
});

export const evaluateJsOutputSchema = z.object({
  artifact_id: z.string(),
  value: z.unknown().optional(),
  preview: z.string().optional(),
  truncated: z.boolean(),
  url: z.string(),
  title: z.string().optional(),
  bytes: z.number().optional(),
  storage_path: z.string().optional()
});

export type EvaluateJsInput = z.infer<typeof evaluateJsInputSchema>;
