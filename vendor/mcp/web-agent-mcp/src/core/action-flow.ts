import { asWebAgentError } from "./errors.js";
import { buildFollowUpByGoal, toPolicyEnvelope } from "./observation-flow.js";
import { recommendObservation } from "./policy-engine.js";
import { getRetryPolicy } from "./retry-policy.js";
import { shouldRecommendSessionRestart } from "./session-restart-policy.js";

export function buildActionSuccessPayload(input: {
  actionId: string;
  appliedMode: "semantic" | "physical";
  verificationHint?: string;
  targetSelectorKnown: boolean;
}) {
  return {
    action_id: input.actionId,
    applied_mode: input.appliedMode,
    verification_hint: input.verificationHint,
    follow_up_by_goal: buildFollowUpByGoal({
      pageStateKnown: true,
      targetSelectorKnown: input.targetSelectorKnown,
      recentFailure: "none",
    }),
  };
}

export function buildActionFailurePayload(input: {
  error: unknown;
  actionId?: string;
  appliedMode: "semantic" | "physical";
  targetSelectorKnown: boolean;
  sessionHealth?: {
    consecutiveErrors: number;
    maxConsecutiveErrors: number;
    cooldownMs: number;
    lastRestartAt?: string;
    now: string;
  };
}) {
  const mapped = asWebAgentError(input.error);
  const recentFailure =
    mapped.code === "STATE_ELEMENT_NOT_FOUND"
      ? "semantic_not_found"
      : mapped.code === "STATE_TARGET_NOT_INTERACTABLE"
        ? "semantic_failed"
        : mapped.type === "BROWSER"
          ? "runtime_error"
          : "layout_uncertain";

  const fallback = toPolicyEnvelope(
    recommendObservation({
      goal: input.appliedMode === "physical" ? "visual_verify" : "interact",
      page_state_known: true,
      target_selector_known: input.targetSelectorKnown,
      needs_precise_coordinates: input.appliedMode === "physical",
      needs_full_page_context: false,
      recent_failure: recentFailure,
    }),
  );
  const retryPolicy = getRetryPolicy(mapped);
  const sessionRestart = input.sessionHealth
    ? shouldRecommendSessionRestart({
        consecutiveErrors: input.sessionHealth.consecutiveErrors,
        maxConsecutiveErrors: input.sessionHealth.maxConsecutiveErrors,
        cooldownMs: input.sessionHealth.cooldownMs,
        lastRestartAt: input.sessionHealth.lastRestartAt,
        now: input.sessionHealth.now,
        browserError: mapped.type === "BROWSER",
      })
    : { recommended: false as const };

  return {
    action_id: input.actionId,
    applied_mode: input.appliedMode,
    retry_hint: retryPolicy.retryHint,
    fallback_observation: fallback,
    follow_up_by_goal: buildFollowUpByGoal({
      pageStateKnown: true,
      targetSelectorKnown: input.targetSelectorKnown,
      recentFailure,
    }),
    session_restart: sessionRestart,
  };
}
