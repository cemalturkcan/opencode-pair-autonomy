export type SessionRestartDecision = {
  recommended: boolean;
  reason?: string;
};

export function shouldRecommendSessionRestart(input: {
  consecutiveErrors: number;
  maxConsecutiveErrors: number;
  cooldownMs: number;
  lastRestartAt?: string;
  now: string;
  browserError: boolean;
}) {
  if (!input.browserError && input.consecutiveErrors < input.maxConsecutiveErrors) {
    return { recommended: false } satisfies SessionRestartDecision;
  }

  if (input.lastRestartAt) {
    const elapsed = Date.parse(input.now) - Date.parse(input.lastRestartAt);
    if (elapsed < input.cooldownMs) {
      return {
        recommended: false,
        reason: "Restart cooldown is still active."
      } satisfies SessionRestartDecision;
    }
  }

  return {
    recommended: true,
    reason: input.browserError
      ? "Browser/runtime failure suggests a session restart."
      : "Consecutive errors crossed the restart threshold."
  } satisfies SessionRestartDecision;
}
