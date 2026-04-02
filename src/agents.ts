import type { AgentLike, HarnessConfig } from "./types";
import { deepMerge } from "./utils";
import { buildCoordinatorPrompt } from "./prompts/coordinator";
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
  "worker",
  "researcher",
  "reviewer",
  "yet-another-reviewer",
  "verifier",
  "repair",
  "ui-developer",
  "repo-scout",
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
    coordinator: withOverride(
      {
        mode: "primary",
        description:
          "Senior technical lead. Plans, argues, delegates, synthesizes.",
        model: "anthropic/claude-opus-4-6",
        variant: "max",
        prompt: buildCoordinatorPrompt(overrides.coordinator?.prompt_append),
        tools: COORDINATOR_DISABLED_TOOLS,
        permission: { task: COORDINATOR_TASK_PERMISSIONS },
      },
      overrides.coordinator,
    ),

    // ── Workers (subagents) ──────────────────────────────────────
    worker: withOverride(
      {
        mode: "subagent",
        hidden: true,
        description: "General purpose implementation worker.",
        model: "anthropic/claude-sonnet-4-6",
        variant: "max",
        prompt: buildWorkerPrompt(overrides.worker?.prompt_append),
        tools: workerDisabledMcps("jina", "web-agent-mcp", "figma-console"),
      },
      overrides.worker,
    ),

    researcher: withOverride(
      {
        mode: "subagent",
        hidden: true,
        description: "Web and doc researcher.",
        model: "anthropic/claude-sonnet-4-6",
        variant: "none",
        prompt: buildResearcherPrompt(overrides.researcher?.prompt_append),
        tools: workerDisabledMcps(
          "web-agent-mcp",
          "figma-console",
          "pg-mcp",
          "ssh-mcp",
          "mariadb",
        ),
      },
      overrides.researcher,
    ),

    reviewer: withOverride(
      {
        mode: "subagent",
        hidden: true,
        description:
          "Senior code reviewer. Finds subtle bugs and security issues.",
        model: "anthropic/claude-opus-4-6",
        variant: "max",
        prompt: buildReviewerPrompt(overrides.reviewer?.prompt_append),
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
      overrides.reviewer,
    ),

    "yet-another-reviewer": withOverride(
      {
        mode: "subagent",
        hidden: true,
        description: "Cross-model independent reviewer for review diversity.",
        model: "openai/gpt-5.4",
        variant: "xhigh",
        prompt: buildYetAnotherReviewerPrompt(
          overrides["yet-another-reviewer"]?.prompt_append,
        ),
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
      overrides["yet-another-reviewer"],
    ),

    verifier: withOverride(
      {
        mode: "subagent",
        hidden: true,
        description: "Build, test, lint verifier.",
        model: "anthropic/claude-sonnet-4-6",
        variant: "none",
        prompt: buildVerifierPrompt(overrides.verifier?.prompt_append),
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
      overrides.verifier,
    ),

    repair: withOverride(
      {
        mode: "subagent",
        hidden: true,
        description: "Scoped failure repair agent.",
        model: "anthropic/claude-sonnet-4-6",
        variant: "max",
        prompt: buildRepairPrompt(overrides.repair?.prompt_append),
        tools: workerDisabledMcps(
          "jina",
          "websearch",
          "grep_app",
          "web-agent-mcp",
          "figma-console",
        ),
      },
      overrides.repair,
    ),

    "ui-developer": withOverride(
      {
        mode: "subagent",
        hidden: true,
        description: "Frontend specialist with Figma and browser automation.",
        model: "anthropic/claude-sonnet-4-6",
        variant: "max",
        prompt: buildUiDeveloperPrompt(
          overrides["ui-developer"]?.prompt_append,
        ),
        tools: workerDisabledMcps("pg-mcp", "ssh-mcp", "mariadb"),
      },
      overrides["ui-developer"],
    ),

    "repo-scout": withOverride(
      {
        mode: "subagent",
        hidden: true,
        description: "Fast codebase explorer.",
        model: "anthropic/claude-sonnet-4-6",
        variant: "none",
        prompt: buildRepoScoutPrompt(overrides["repo-scout"]?.prompt_append),
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
      overrides["repo-scout"],
    ),

    // ── Disable OpenCode built-in agents ─────────────────────────
    build: { disable: true },
    plan: { disable: true },
  };
}
