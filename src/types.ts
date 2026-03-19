export type HarnessMode = "pair" | "pair-plan" | "autonomous";

export type HookProfile = "minimal" | "standard" | "strict";

export type McpToggles = {
  context7?: boolean;
  grep_app?: boolean;
  websearch?: boolean;
  fff?: boolean;
  web_agent_mcp?: boolean;
  pg_mcp?: boolean;
  ssh_mcp?: boolean;
  sudo_mcp?: boolean;
  jina?: boolean;
  figma?: boolean;
};

export type AgentOverride = {
  model?: string;
  variant?: string;
  description?: string;
  prompt_append?: string;
};

export type HarnessConfig = {
  default_mode?: HarnessMode;
  set_default_agent?: boolean;
  commands?: {
    enabled?: boolean;
  };
  credentials?: {
    jina_api_key?: string;
    figma_api_key?: string;
  };
  hooks?: {
    profile?: HookProfile;
    intent_gate?: boolean;
    todo_continuation?: boolean;
    comment_guard?: boolean;
    session_start?: boolean;
    pre_tool_use?: boolean;
    post_tool_use?: boolean;
    pre_compact?: boolean;
    stop?: boolean;
    session_end?: boolean;
    file_edited?: boolean;
    flush_queued_prompts?: boolean;
    todo_continuation_cooldown_ms?: number;
    prompt_refiner?: boolean;
    claude_token_sync?: boolean;
  };
  memory?: {
    enabled?: boolean;
    directory?: string;
    lookback_days?: number;
    max_injected_chars?: number;
  };
  learning?: {
    enabled?: boolean;
    directory?: string;
    min_observations?: number;
    auto_promote?: boolean;
    max_patterns?: number;
    max_injected_patterns?: number;
  };
  mcps?: McpToggles;
  agents?: Record<string, AgentOverride>;
};

export type AgentLike = Record<string, unknown>;
