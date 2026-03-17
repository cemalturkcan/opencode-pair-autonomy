import { z } from "zod";

export const errorTypeSchema = z.enum([
  "INPUT",
  "STATE",
  "BROWSER",
  "NETWORK",
  "STORAGE",
  "INTERNAL"
]);

export const toolEnvelopeBaseSchema = z.object({
  ok: z.boolean(),
  code: z.string(),
  message: z.string().optional(),
  task_id: z.string().optional(),
  action_id: z.string().optional(),
  session_id: z.string().optional(),
  page_id: z.string().optional(),
  artifact_ids: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  error: z
    .object({
      type: errorTypeSchema,
      details: z.record(z.string(), z.unknown()).optional()
    })
    .optional()
});

export type ErrorType = z.infer<typeof errorTypeSchema>;

export type ToolEnvelope<TData = unknown> = z.infer<typeof toolEnvelopeBaseSchema> & {
  data?: TData;
};

export function createToolTextContent(value: unknown) {
  return [{ type: "text" as const, text: JSON.stringify(value, null, 2) }];
}

export function createToolSuccess<TData>(envelope: ToolEnvelope<TData>) {
  const structuredContent = envelope.data ?? envelope;

  return {
    content: createToolTextContent(structuredContent),
    structuredContent
  };
}

export function createToolFailure<TData>(envelope: ToolEnvelope<TData>) {
  const structuredContent = {
    ok: envelope.ok,
    code: envelope.code,
    message: envelope.message,
    task_id: envelope.task_id,
    action_id: envelope.action_id,
    session_id: envelope.session_id,
    page_id: envelope.page_id,
    artifact_ids: envelope.artifact_ids,
    warnings: envelope.warnings,
    error: envelope.error
  };

  return {
    content: createToolTextContent(envelope.error ?? envelope),
    structuredContent,
    isError: true
  };
}
