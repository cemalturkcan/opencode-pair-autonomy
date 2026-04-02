import type { AgentLike, HarnessConfig } from "./types";
import { deepMerge } from "./utils";
import {
  buildCoordinatorPrompt,
  buildCoordinatorPromptExp,
} from "./prompts/coordinator";
import {
  buildWorkerPrompt,
  buildResearcherPrompt,
  buildReviewerPrompt,
  buildYetAnotherReviewerPrompt,
  buildVerifierPrompt,
  buildRepairPrompt,
  buildUiDeveloperPrompt,
  buildRepoScoutPrompt,
} from "./prompts/workers";

function withOverride(
  base: AgentLike,
  override?: Record<string, unknown>,
): AgentLike {
  if (!override) return base;
  return deepMerge(base, override);
}

function taskPermissions(...allowedPatterns: string[]) {
  const permissions: Record<string, string> = { "*": "deny" };
  for (const pattern of allowedPatterns) {
    permissions[pattern] = "allow";
  }
  return permissions;
}

const COORDINATOR_TASK_PERMISSIONS = taskPermissions(
  "thorfinn",
  "ginko",
  "kaiki",
  "odokawa",
  "ozen",
  "skull-knight",
  "paprika",
  "rajdhani",
);

// Only the expensive MCPs are disabled on the coordinator (~30k token savings).
// Lighter MCPs stay open so the coordinator can use them directly.
const COORDINATOR_DISABLED_TOOLS: Record<string, boolean> = {
  "jina_*": false,
  "web-agent-mcp_*": false,
  "figma-console_*": false,
};

// Per-worker MCP restrictions: disable MCPs they don't need.
function workerDisabledMcps(
  ...disabledPrefixes: string[]
): Record<string, boolean> {
  const tools: Record<string, boolean> = {};
  for (const prefix of disabledPrefixes) {
    tools[`${prefix}_*`] = false;
  }
  return tools;
}

export function createHarnessAgents(
  config: HarnessConfig,
): Record<string, AgentLike> {
  const overrides = config.agents ?? {};

  return {
    // ── Coordinator (primary agent) ──────────────────────────────
    yang: withOverride(
      {
        mode: "primary",
        description:
          "Yang Wenli — Senior technical lead. Plans, argues, delegates, synthesizes.",
        model: "anthropic/claude-opus-4-6",
        variant: "max",
        prompt: buildCoordinatorPrompt(overrides.yang?.prompt_append),
        tools: COORDINATOR_DISABLED_TOOLS,
        permission: { task: COORDINATOR_TASK_PERMISSIONS },
      },
      overrides.yang,
    ),

    "yang-exp": withOverride(
      {
        mode: "primary",
        description:
          "Yang Wenli (Experimental) — Judgment-based delegation coordinator.",
        model: "anthropic/claude-opus-4-6",
        variant: "max",
        prompt: buildCoordinatorPromptExp(overrides["yang-exp"]?.prompt_append),
        tools: COORDINATOR_DISABLED_TOOLS,
        permission: { task: COORDINATOR_TASK_PERMISSIONS },
      },
      overrides["yang-exp"],
    ),

    // ── Workers (subagents) ──────────────────────────────────────
    thorfinn: withOverride(
      {
        mode: "subagent",
        hidden: true,
        description: "Thorfinn — General purpose implementation worker.",
        model: "anthropic/claude-sonnet-4-6",
        variant: "max",
        prompt: buildWorkerPrompt(overrides.thorfinn?.prompt_append),
        tools: workerDisabledMcps("jina", "web-agent-mcp", "figma-console"),
      },
      overrides.thorfinn,
    ),

    ginko: withOverride(
      {
        mode: "subagent",
        hidden: true,
        description: "Ginko — Web and doc researcher.",
        model: "anthropic/claude-sonnet-4-6",
        variant: "none",
        prompt: buildResearcherPrompt(overrides.ginko?.prompt_append),
        tools: workerDisabledMcps(
          "web-agent-mcp",
          "figma-console",
          "pg-mcp",
          "ssh-mcp",
          "mariadb",
        ),
      },
      overrides.ginko,
    ),

    kaiki: withOverride(
      {
        mode: "subagent",
        hidden: true,
        description:
          "Kaiki — Senior code reviewer. Finds subtle bugs and security issues.",
        model: "anthropic/claude-opus-4-6",
        variant: "max",
        prompt: buildReviewerPrompt(overrides.kaiki?.prompt_append),
        tools: {
          ...workerDisabledMcps(
            "jina",
            "websearch",
            "web-agent-mcp",
            "figma-console",
            "pg-mcp",
            "ssh-mcp",
            "mariadb",
          ),
          bash: false,
          edit: false,
          write: false,
          patch: false,
        },
      },
      overrides.kaiki,
    ),

    odokawa: withOverride(
      {
        mode: "subagent",
        hidden: true,
        description:
          "Odokawa — Cross-model independent reviewer for review diversity.",
        model: "openai/gpt-5.4",
        variant: "xhigh",
        prompt: buildYetAnotherReviewerPrompt(overrides.odokawa?.prompt_append),
        tools: {
          ...workerDisabledMcps(
            "jina",
            "websearch",
            "web-agent-mcp",
            "figma-console",
            "pg-mcp",
            "ssh-mcp",
            "mariadb",
          ),
          bash: false,
          edit: false,
          write: false,
          patch: false,
        },
      },
      overrides.odokawa,
    ),

    ozen: withOverride(
      {
        mode: "subagent",
        hidden: true,
        description: "Ozen — Build, test, lint verifier.",
        model: "anthropic/claude-sonnet-4-6",
        variant: "none",
        prompt: buildVerifierPrompt(overrides.ozen?.prompt_append),
        tools: workerDisabledMcps(
          "context7",
          "jina",
          "websearch",
          "grep_app",
          "web-agent-mcp",
          "figma-console",
          "pg-mcp",
          "ssh-mcp",
          "mariadb",
        ),
      },
      overrides.ozen,
    ),

    "skull-knight": withOverride(
      {
        mode: "subagent",
        hidden: true,
        description: "Skull Knight — Scoped failure repair agent.",
        model: "anthropic/claude-sonnet-4-6",
        variant: "max",
        prompt: buildRepairPrompt(overrides["skull-knight"]?.prompt_append),
        tools: workerDisabledMcps(
          "jina",
          "websearch",
          "grep_app",
          "web-agent-mcp",
          "figma-console",
        ),
      },
      overrides["skull-knight"],
    ),

    paprika: withOverride(
      {
        mode: "subagent",
        hidden: true,
        description:
          "Paprika — Frontend specialist with Figma and browser automation.",
        model: "anthropic/claude-sonnet-4-6",
        variant: "max",
        prompt: buildUiDeveloperPrompt(overrides.paprika?.prompt_append),
        tools: workerDisabledMcps("pg-mcp", "ssh-mcp", "mariadb"),
      },
      overrides.paprika,
    ),

    "rajdhani": withOverride(
      {
        mode: "subagent",
        hidden: true,
        description: "Rajdhani — Fast codebase explorer.",
        model: "anthropic/claude-sonnet-4-6",
        variant: "none",
        prompt: buildRepoScoutPrompt(overrides["rajdhani"]?.prompt_append),
        tools: workerDisabledMcps(
          "context7",
          "jina",
          "websearch",
          "grep_app",
          "web-agent-mcp",
          "figma-console",
          "pg-mcp",
          "ssh-mcp",
          "mariadb",
        ),
      },
      overrides["rajdhani"],
    ),

    // ── Disable OpenCode built-in agents ─────────────────────────
    build: { disable: true },
    plan: { disable: true },
  };
}
