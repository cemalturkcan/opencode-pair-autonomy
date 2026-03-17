import { z } from "zod";
import { followUpByGoalSchema } from "./policy.js";

export const navigatePageInputSchema = z.object({
  session_id: z.string().min(1),
  page_id: z.string().min(1).optional(),
  url: z.string().url(),
  wait_until: z.enum(["domcontentloaded", "load", "networkidle"]).default("domcontentloaded")
});

export const navigatePageOutputSchema = z.object({
  page_id: z.string(),
  requested_url: z.string(),
  final_url: z.string(),
  title: z.string().optional(),
  navigation_id: z.string(),
  timings: z.object({
    elapsed_ms: z.number().nonnegative()
  }),
  follow_up_by_goal: followUpByGoalSchema
});
