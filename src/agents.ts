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
const COORDINATOR_DISABLED_TOOLS: Record<string, string> = {
  "jina_*": "deny",
  "web-agent-mcp_*": "deny",
  "figma-console_*": "deny",
};

// Per-worker MCP restrictions: disable MCPs they don't need.
function mcpDenyRules(...disabledPrefixes: string[]): Record<string, string> {
  const tools: Record<string, string> = {};
  for (const prefix of disabledPrefixes) {
    tools[`${prefix}_*`] = "deny";
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
        color: "#4A90D9",
        tools: COORDINATOR_DISABLED_TOOLS,
        permission: { task: COORDINATOR_TASK_PERMISSIONS },
      },
      overrides.yang,
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
        temperature: 0.2,
        color: "#2ECC71",
        tools: mcpDenyRules("jina", "web-agent-mcp", "figma-console"),
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
        temperature: 0.3,
        color: "#F39C12",
        tools: mcpDenyRules(
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
        temperature: 0.1,
        color: "#E74C3C",
        tools: mcpDenyRules(
          "jina",
          "websearch",
          "web-agent-mcp",
          "figma-console",
          "pg-mcp",
          "ssh-mcp",
          "mariadb",
        ),
        permission: {
          edit: "deny",
          bash: { "*": "deny" },
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
        temperature: 0.4,
        color: "#9B59B6",
        tools: mcpDenyRules(
          "jina",
          "websearch",
          "web-agent-mcp",
          "figma-console",
          "pg-mcp",
          "ssh-mcp",
          "mariadb",
        ),
        permission: {
          edit: "deny",
          bash: { "*": "deny" },
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
        temperature: 0.0,
        color: "#95A5A6",
        tools: mcpDenyRules(
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
        temperature: 0.1,
        color: "#E67E22",
        tools: mcpDenyRules(
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
        temperature: 0.5,
        color: "#FF69B4",
        tools: mcpDenyRules("pg-mcp", "ssh-mcp", "mariadb"),
      },
      overrides.paprika,
    ),

    rajdhani: withOverride(
      {
        mode: "subagent",
        hidden: true,
        description: "Rajdhani — Fast codebase explorer.",
        model: "anthropic/claude-sonnet-4-6",
        variant: "none",
        prompt: buildRepoScoutPrompt(overrides["rajdhani"]?.prompt_append),
        temperature: 0.1,
        color: "#1ABC9C",
        tools: mcpDenyRules(
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
