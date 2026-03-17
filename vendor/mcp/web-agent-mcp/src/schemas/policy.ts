import { z } from "zod";

export const observationRecommendationSchema = z.object({
  recommended_tool: z.enum([
    "observe.a11y",
    "observe.dom",
    "observe.text",
    "observe.boxes",
    "observe.screenshot"
  ]),
  screenshot_mode: z.enum(["none", "element", "viewport", "full"]).default("none"),
  rationale: z.array(z.string()),
  escalation_order: z.array(z.string())
});

export const followUpByGoalSchema = z.object({
  interact: observationRecommendationSchema,
  read: observationRecommendationSchema,
  visual_verify: observationRecommendationSchema,
  debug: observationRecommendationSchema,
  gesture: observationRecommendationSchema
});

export const sessionRestartRecommendationSchema = z.object({
  recommended: z.boolean(),
  reason: z.string().optional()
});

export const recommendObservationInputSchema = z.object({
  goal: z.enum(["interact", "read", "visual_verify", "debug", "gesture"]),
  page_state_known: z.boolean().default(false),
  target_selector_known: z.boolean().default(false),
  needs_precise_coordinates: z.boolean().default(false),
  needs_full_page_context: z.boolean().default(false),
  recent_failure: z
    .enum(["none", "semantic_not_found", "semantic_failed", "layout_uncertain", "runtime_error"])
    .default("none")
});

export const recommendObservationOutputSchema = observationRecommendationSchema;

export type RecommendObservationInput = z.infer<typeof recommendObservationInputSchema>;
