import type { WebAgentError } from "./errors.js";

export type RetryPolicyDecision = {
  retryable: boolean;
  maxAttempts: number;
  retryHint?: string;
};

export function getRetryPolicy(error: WebAgentError): RetryPolicyDecision {
  switch (error.code) {
    case "STATE_ELEMENT_NOT_FOUND":
      return {
        retryable: true,
        maxAttempts: 2,
        retryHint:
          "Refresh observation first, then retry with observe.boxes or an element screenshot.",
      };
    case "STATE_TARGET_NOT_INTERACTABLE":
      return {
        retryable: true,
        maxAttempts: 2,
        retryHint: "Re-check layout and visibility before retrying the action.",
      };
    case "NETWORK_TIMEOUT":
      return {
        retryable: true,
        maxAttempts: 2,
        retryHint: "Retry once if the page is still loading or unstable.",
      };
    case "BROWSER_DISCONNECTED":
      return {
        retryable: true,
        maxAttempts: 1,
        retryHint: "Restart the session before retrying.",
      };
    default:
      return {
        retryable: false,
        maxAttempts: 0,
      };
  }
}
