import { recommendObservation } from "./policy-engine.js";

type Goal = "interact" | "read" | "visual_verify" | "debug" | "gesture";

export function buildFollowUpByGoal(input: {
  pageStateKnown: boolean;
  targetSelectorKnown: boolean;
  needsPreciseCoordinates?: boolean;
  needsFullPageContext?: boolean;
  recentFailure?: "none" | "semantic_not_found" | "semantic_failed" | "layout_uncertain" | "runtime_error";
}) {
  const goals: Goal[] = ["interact", "read", "visual_verify", "debug", "gesture"];

  return Object.fromEntries(
    goals.map((goal) => [
      goal,
      toPolicyEnvelope(
        recommendObservation({
          goal,
          page_state_known: input.pageStateKnown,
          target_selector_known: input.targetSelectorKnown,
          needs_precise_coordinates: goal === "gesture" ? true : Boolean(input.needsPreciseCoordinates),
          needs_full_page_context: goal === "visual_verify" ? Boolean(input.needsFullPageContext) : false,
          recent_failure: input.recentFailure ?? "none"
        })
      )
    ])
  ) as Record<Goal, ReturnType<typeof toPolicyEnvelope>>;
}

export function toPolicyEnvelope(result: ReturnType<typeof recommendObservation>) {
  return {
    recommended_tool: result.recommendedTool,
    screenshot_mode: result.screenshotMode,
    rationale: result.rationale,
    escalation_order: result.escalationOrder
  };
}
