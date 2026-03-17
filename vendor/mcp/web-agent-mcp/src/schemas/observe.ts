import { z } from "zod";

export const observeSessionInputSchema = z.object({
  session_id: z.string().min(1),
  page_id: z.string().min(1).optional()
});

export const screenshotInputSchema = observeSessionInputSchema.extend({
  mode: z.enum(["viewport", "full", "element"]).default("viewport"),
  selector: z.string().min(1).optional(),
  format: z.enum(["png", "jpeg"]).default("jpeg"),
  quality: z.number().int().min(1).max(100).optional()
}).superRefine((value, ctx) => {
  if (value.mode === "element" && !value.selector) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "selector is required when screenshot mode is element",
      path: ["selector"]
    });
  }
});

export const boxesInputSchema = observeSessionInputSchema.extend({
  selectors: z.array(z.string().min(1)).min(1).max(50)
});

export const logsInputSchema = observeSessionInputSchema.extend({
  limit: z.number().int().positive().max(500).default(50)
});

export const pageStateInputSchema = observeSessionInputSchema.extend({
  recent_network_limit: z.number().int().positive().max(100).default(10)
});

export const authStateInputSchema = observeSessionInputSchema.extend({
  recent_network_limit: z.number().int().positive().max(100).default(20)
});

export const waitForNetworkInputSchema = observeSessionInputSchema.extend({
  url_pattern: z.string().min(1),
  use_regex: z.boolean().default(false),
  status: z.number().int().min(100).max(599).optional(),
  outcome: z.enum(["response", "failed"]).optional(),
  timeout_ms: z.number().int().positive().max(60000).default(5000),
  poll_interval_ms: z.number().int().positive().max(1000).default(100)
});

export const artifactMetadataSchema = z.object({
  artifact_id: z.string(),
  kind: z.enum(["a11y", "dom", "text", "markdown", "boxes", "screenshot", "console", "network", "eval"]),
  created_at: z.string(),
  url: z.string().optional(),
  title: z.string().optional(),
  storage_path: z.string().optional(),
  bytes: z.number().optional()
});

export const followUpByGoalSchemaLazy = z.object({
  interact: z.any(),
  read: z.any(),
  visual_verify: z.any(),
  debug: z.any(),
  gesture: z.any()
});

const networkEntrySchema = z.object({
  url: z.string(),
  method: z.string(),
  status: z.number().optional(),
  resourceType: z.string(),
  outcome: z.enum(["response", "failed"]),
  failureText: z.string().optional(),
  timestamp: z.string()
});

const interactiveElementSchema = z.object({
  tag: z.string(),
  type: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  placeholder: z.string().optional(),
  text: z.string().optional(),
  autocomplete: z.string().optional(),
  visible: z.boolean()
});

const frameSummarySchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string().optional(),
  url: z.string(),
  title: z.string().optional(),
  text_preview: z.string(),
  truncated: z.boolean(),
  input_count: z.number().int().nonnegative(),
  button_count: z.number().int().nonnegative()
});

export const observeA11yOutputSchema = z.object({
  snapshot_id: z.string(),
  format: z.literal("a11y"),
  url: z.string(),
  title: z.string().optional(),
  tree: z.unknown(),
  follow_up_by_goal: followUpByGoalSchemaLazy
});

export const observeDomOutputSchema = z.object({
  snapshot_id: z.string(),
  format: z.literal("dom"),
  url: z.string(),
  title: z.string().optional(),
  dom_summary: z.object({
    headings: z.array(z.string()),
    links: z.number(),
    buttons: z.number(),
    forms: z.number(),
    inputs: z.number()
  }),
  follow_up_by_goal: followUpByGoalSchemaLazy
});

export const observeTextOutputSchema = z.object({
  artifact_id: z.string(),
  format: z.enum(["text", "markdown"]),
  content: z.string(),
  truncated: z.boolean(),
  url: z.string(),
  title: z.string().optional(),
  follow_up_by_goal: followUpByGoalSchemaLazy
});

export const observeBoxesOutputSchema = z.object({
  element_map_id: z.string(),
  elements: z.array(
    z.object({
      selector: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      visible: z.boolean()
    })
  )
});

export const observeLogsOutputSchema = z.object({
  artifact_id: z.string(),
  entries: z.array(z.unknown())
});

export const observeScreenshotOutputSchema = z.object({
  screenshot_id: z.string(),
  mode: z.enum(["viewport", "full", "element"]),
  width: z.number().optional(),
  height: z.number().optional(),
  bytes: z.number().optional(),
  mime_type: z.string(),
  storage_path: z.string().optional(),
  follow_up_by_goal: followUpByGoalSchemaLazy
});

export const observePageStateOutputSchema = z.object({
  snapshot_id: z.string(),
  url: z.string(),
  title: z.string().optional(),
  text: z.string(),
  truncated: z.boolean(),
  dom_summary: z.object({
    headings: z.array(z.string()),
    links: z.number(),
    buttons: z.number(),
    forms: z.number(),
    inputs: z.number()
  }),
  inputs: z.array(interactiveElementSchema),
  buttons: z.array(interactiveElementSchema),
  frames: z.array(frameSummarySchema),
  recent_network: z.array(networkEntrySchema),
  follow_up_by_goal: followUpByGoalSchemaLazy
});

export const observeAuthStateOutputSchema = z.object({
  snapshot_id: z.string(),
  url: z.string(),
  title: z.string().optional(),
  state: z.enum([
    "email_prompt",
    "password_prompt",
    "phone_selection",
    "verification_code",
    "trust_prompt",
    "authenticated",
    "unknown"
  ]),
  confidence: z.enum(["high", "medium", "low"]),
  summary: z.string(),
  evidence: z.array(z.string()),
  suggested_selectors: z.array(z.string()),
  candidate_frames: z.array(frameSummarySchema),
  recent_network: z.array(networkEntrySchema),
  follow_up_by_goal: followUpByGoalSchemaLazy
});

export const waitForNetworkOutputSchema = z.object({
  entry: networkEntrySchema,
  elapsed_ms: z.number().int().nonnegative()
});

export type ScreenshotInput = z.infer<typeof screenshotInputSchema>;
export type BoxesInput = z.infer<typeof boxesInputSchema>;
export type LogsInput = z.infer<typeof logsInputSchema>;
export type PageStateInput = z.infer<typeof pageStateInputSchema>;
export type AuthStateInput = z.infer<typeof authStateInputSchema>;
export type WaitForNetworkInput = z.infer<typeof waitForNetworkInputSchema>;
