import type { RecommendObservationInput } from "../schemas/policy.js";

export type ObservationRecommendation = {
  recommendedTool: "observe.a11y" | "observe.dom" | "observe.text" | "observe.boxes" | "observe.screenshot";
  screenshotMode: "none" | "element" | "viewport" | "full";
  rationale: string[];
  escalationOrder: string[];
};

export function recommendObservation(input: RecommendObservationInput): ObservationRecommendation {
  const rationale: string[] = [];
  const escalationOrder = [
    "observe.a11y",
    "observe.dom",
    "observe.text",
    "observe.boxes",
    "observe.screenshot"
  ];

  if (input.goal === "read") {
    rationale.push("Reading tasks should prefer cheap textual context before any visual artifact.");
    return {
      recommendedTool: "observe.text",
      screenshotMode: "none",
      rationale,
      escalationOrder
    };
  }

  if (input.goal === "debug") {
    rationale.push("Debug flows usually need structural context before expensive screenshots.");
    rationale.push(
      input.recent_failure === "runtime_error"
        ? "Runtime errors often benefit from DOM plus later console/network review."
        : "A screenshot is useful only after structural context is insufficient."
    );
    return {
      recommendedTool: input.page_state_known ? "observe.dom" : "observe.a11y",
      screenshotMode: "none",
      rationale,
      escalationOrder
    };
  }

  if (input.goal === "visual_verify") {
    rationale.push("Visual verification explicitly needs pixels, so screenshot escalation is justified.");
    if (input.needs_full_page_context) {
      rationale.push("Full-page context was requested, so prefer a full-page screenshot.");
      return {
        recommendedTool: "observe.screenshot",
        screenshotMode: "full",
        rationale,
        escalationOrder
      };
    }

    return {
      recommendedTool: "observe.screenshot",
      screenshotMode: input.target_selector_known ? "element" : "viewport",
      rationale,
      escalationOrder
    };
  }

  if (input.goal === "gesture" || input.needs_precise_coordinates) {
    rationale.push("Gesture execution needs precise spatial data before acting.");
    rationale.push("Bounding boxes are cheaper than screenshots and usually sufficient for coordinates.");
    return {
      recommendedTool: "observe.boxes",
      screenshotMode: "none",
      rationale,
      escalationOrder
    };
  }

  if (input.recent_failure === "semantic_not_found" || input.recent_failure === "semantic_failed") {
    rationale.push("A semantic failure suggests spatial fallback is needed.");
    return {
      recommendedTool: "observe.boxes",
      screenshotMode: "none",
      rationale,
      escalationOrder
    };
  }

  if (input.goal === "interact") {
    rationale.push("Interaction tasks should start with structured page state, not screenshots.");
    if (input.page_state_known && input.target_selector_known) {
      rationale.push("Known page state plus known target favors a lightweight DOM check.");
      return {
        recommendedTool: "observe.dom",
        screenshotMode: "none",
        rationale,
        escalationOrder
      };
    }

    return {
      recommendedTool: "observe.a11y",
      screenshotMode: "none",
      rationale,
      escalationOrder
    };
  }

  rationale.push("Default to structured accessibility context as the cheapest general-purpose observation.");
  return {
    recommendedTool: "observe.a11y",
    screenshotMode: "none",
    rationale,
    escalationOrder
  };
}
