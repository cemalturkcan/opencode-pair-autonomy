import type { HarnessConfig } from "./types";

export function createHarnessCommands(
  config: HarnessConfig,
): Record<string, Record<string, unknown>> {
  if (config.commands?.enabled === false) {
    return {};
  }

  return {
    go: {
      template:
        "Switch to execution mode. Begin executing the current plan. $ARGUMENTS",
      description: "Exit plan mode and start execution.",
      agent: "yang",
    },
    plan: {
      template:
        "Switch to planning mode. Pause execution and return to planning. $ARGUMENTS",
      description: "Return to plan mode.",
      agent: "yang",
    },
    "create-skill": {
      template:
        "Analyze the current session learnings and create a reusable skill from them. Save to ~/.config/opencode/skills/. $ARGUMENTS",
      description: "Create a skill from session learnings.",
      agent: "yang",
    },
  };
}
