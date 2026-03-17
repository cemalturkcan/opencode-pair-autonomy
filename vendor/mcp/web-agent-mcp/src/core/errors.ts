import type { ErrorType, ToolEnvelope } from "../schemas/common.js";
import { createToolFailure } from "../schemas/common.js";

export type WebAgentErrorCode =
  | "INPUT_INVALID_URL"
  | "INPUT_MISSING_SESSION"
  | "STATE_PAGE_NOT_FOUND"
  | "STATE_NAVIGATION_NOT_OBSERVED"
  | "STATE_ELEMENT_NOT_FOUND"
  | "STATE_TARGET_NOT_INTERACTABLE"
  | "BROWSER_LAUNCH_FAILED"
  | "BROWSER_DISCONNECTED"
  | "NETWORK_TIMEOUT"
  | "STORAGE_WRITE_FAILED"
  | "INTERNAL_NOT_IMPLEMENTED"
  | "INTERNAL_UNREACHABLE";

const errorTypeByCode: Record<WebAgentErrorCode, ErrorType> = {
  INPUT_INVALID_URL: "INPUT",
  INPUT_MISSING_SESSION: "INPUT",
  STATE_PAGE_NOT_FOUND: "STATE",
  STATE_NAVIGATION_NOT_OBSERVED: "STATE",
  STATE_ELEMENT_NOT_FOUND: "STATE",
  STATE_TARGET_NOT_INTERACTABLE: "STATE",
  BROWSER_LAUNCH_FAILED: "BROWSER",
  BROWSER_DISCONNECTED: "BROWSER",
  NETWORK_TIMEOUT: "NETWORK",
  STORAGE_WRITE_FAILED: "STORAGE",
  INTERNAL_NOT_IMPLEMENTED: "INTERNAL",
  INTERNAL_UNREACHABLE: "INTERNAL",
};

export class WebAgentError extends Error {
  readonly code: WebAgentErrorCode;
  readonly type: ErrorType;
  readonly details?: Record<string, unknown>;

  constructor(
    code: WebAgentErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WebAgentError";
    this.code = code;
    this.type = errorTypeByCode[code];
    this.details = details;
  }
}

export function asWebAgentError(error: unknown) {
  if (error instanceof WebAgentError) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : "Unexpected internal error.";

  if (
    message.includes("locator(") ||
    message.includes("waitForSelector") ||
    message.includes("bounding box")
  ) {
    if (message.toLowerCase().includes("timeout")) {
      return new WebAgentError("STATE_ELEMENT_NOT_FOUND", message);
    }

    if (
      message.toLowerCase().includes("not visible") ||
      message.toLowerCase().includes("not enabled")
    ) {
      return new WebAgentError("STATE_TARGET_NOT_INTERACTABLE", message);
    }

    return new WebAgentError("STATE_ELEMENT_NOT_FOUND", message);
  }

  if (
    message
      .toLowerCase()
      .includes("target page, context or browser has been closed")
  ) {
    return new WebAgentError("BROWSER_DISCONNECTED", message);
  }

  if (message.toLowerCase().includes("timeout")) {
    return new WebAgentError("NETWORK_TIMEOUT", message);
  }

  return new WebAgentError("INTERNAL_UNREACHABLE", message);
}

export function createFailureResult(
  error: unknown,
  envelope: Partial<ToolEnvelope> = {},
) {
  const mapped = asWebAgentError(error);
  return createToolFailure({
    ok: false,
    code: mapped.code,
    message: mapped.message,
    ...envelope,
    error: {
      type: mapped.type,
      details: mapped.details,
    },
  });
}
