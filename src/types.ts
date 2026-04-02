export type HarnessMode = "coordinator";

export type PlanModeState = "planning" | "executing";

export type WorkerType =
  | "worker"
  | "researcher"
  | "reviewer"
  | "yet-another-reviewer"
  | "verifier"
  | "repair"
  | "ui-developer"
  | "repo-scout";

export type HookProfile = "minimal" | "standard" | "strict";

export type WslState = {
  enabled: boolean;
  winDrive: string;
  winProjectPath: string;
};

export type ResourceMap = {
  sshHosts: string[];
  dbConnections: { mariadb: string[]; postgres: string[] };
  projectDocs: string[];
  skills: string[];
};

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
  figma_console?: boolean;
  mariadb?: boolean;
};

export type FigmaConsoleConfig = {
  ssh_host?: string;
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
    figma_access_token?: string;
  };
  figma_console?: FigmaConsoleConfig;
  hooks?: {
    profile?: HookProfile;
    comment_guard?: boolean;
    session_start?: boolean;
    pre_tool_use?: boolean;
    post_tool_use?: boolean;
    pre_compact?: boolean;
    stop?: boolean;
    session_end?: boolean;
    file_edited?: boolean;
    prompt_refiner?: boolean;
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
