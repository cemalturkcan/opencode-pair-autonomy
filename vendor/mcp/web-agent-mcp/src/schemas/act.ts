import { z } from "zod";
import {
  followUpByGoalSchema,
  observationRecommendationSchema,
  sessionRestartRecommendationSchema
} from "./policy.js";

export const actionResultSchema = z.object({
  action_id: z.string(),
  applied_mode: z.enum(["semantic", "physical"]),
  verification_hint: z.string().optional(),
  retry_hint: z.string().optional(),
  fallback_observation: observationRecommendationSchema.optional(),
  follow_up_by_goal: followUpByGoalSchema,
  session_restart: sessionRestartRecommendationSchema.optional()
});

export const clickInputSchema = z.object({
  session_id: z.string().min(1),
  page_id: z.string().min(1).optional(),
  selector: z.string().min(1),
  button: z.enum(["left", "right", "middle"]).default("left"),
  click_count: z.number().int().min(1).max(3).default(1),
  timeout_ms: z.number().int().positive().max(60000).optional()
});

export const fillInputSchema = z.object({
  session_id: z.string().min(1),
  page_id: z.string().min(1).optional(),
  selector: z.string().min(1),
  value: z.string(),
  clear_first: z.boolean().default(true),
  timeout_ms: z.number().int().positive().max(60000).optional()
});

export const pressInputSchema = z.object({
  session_id: z.string().min(1),
  page_id: z.string().min(1).optional(),
  key: z.string().min(1),
  selector: z.string().min(1).optional(),
  timeout_ms: z.number().int().positive().max(60000).optional()
});

export const enterCodeInputSchema = z.object({
  session_id: z.string().min(1),
  page_id: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  code: z.string().min(1),
  submit: z.boolean().default(false),
  timeout_ms: z.number().int().positive().max(60000).optional()
});

export const waitForInputSchema = z
  .object({
    session_id: z.string().min(1),
    page_id: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    timeout_ms: z.number().int().positive().max(60000).default(5000)
  })
  .refine((value) => Boolean(value.selector || value.text), {
    message: "Provide either selector or text for wait_for."
  });

export const wheelInputSchema = z
  .object({
    session_id: z.string().min(1),
    page_id: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
    delta_x: z.number().default(0),
    delta_y: z.number().default(0),
    steps: z.number().int().min(1).max(100).default(1),
    step_delay_ms: z.number().int().min(0).max(1000).default(0),
    timeout_ms: z.number().int().positive().max(60000).optional()
  })
  .refine((value) => value.delta_x !== 0 || value.delta_y !== 0, {
    message: "delta_x or delta_y must be non-zero for wheel."
  });

export const dragInputSchema = z.object({
  session_id: z.string().min(1),
  page_id: z.string().min(1).optional(),
  from_selector: z.string().min(1),
  to_selector: z.string().min(1),
  steps: z.number().int().min(1).max(200).default(20),
  timeout_ms: z.number().int().positive().max(60000).optional()
});

export const swipeInputSchema = z
  .object({
    session_id: z.string().min(1),
    page_id: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
    start_x: z.number().optional(),
    start_y: z.number().optional(),
    delta_x: z.number().default(0),
    delta_y: z.number().default(0),
    speed: z.number().positive().max(5000).default(800)
  })
  .refine((value) => value.delta_x !== 0 || value.delta_y !== 0, {
    message: "delta_x or delta_y must be non-zero for swipe."
  })
  .refine((value) => Boolean(value.selector) || (value.start_x !== undefined && value.start_y !== undefined), {
    message: "Provide a selector or both start_x and start_y for swipe."
  });

export const pinchInputSchema = z
  .object({
    session_id: z.string().min(1),
    page_id: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
    center_x: z.number().optional(),
    center_y: z.number().optional(),
    scale_factor: z.number().positive(),
    speed: z.number().positive().max(5000).default(800)
  })
  .refine((value) => Boolean(value.selector) || (value.center_x !== undefined && value.center_y !== undefined), {
    message: "Provide a selector or both center_x and center_y for pinch."
  });

export type ClickInput = z.infer<typeof clickInputSchema>;
export type FillInput = z.infer<typeof fillInputSchema>;
export type PressInput = z.infer<typeof pressInputSchema>;
export type EnterCodeInput = z.infer<typeof enterCodeInputSchema>;
export type WaitForInput = z.infer<typeof waitForInputSchema>;
export type WheelInput = z.infer<typeof wheelInputSchema>;
export type DragInput = z.infer<typeof dragInputSchema>;
export type SwipeInput = z.infer<typeof swipeInputSchema>;
export type PinchInput = z.infer<typeof pinchInputSchema>;
