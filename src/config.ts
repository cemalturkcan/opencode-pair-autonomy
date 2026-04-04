import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parse, type ParseError } from "jsonc-parser";
import { z } from "zod";
import type { HarnessConfig } from "./types";
import { deepMerge, isObject } from "./utils";

const HarnessConfigSchema = z.object({
  default_mode: z.enum(["coordinator"]).optional(),
  set_default_agent: z.boolean().optional(),
  commands: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
  credentials: z
    .object({
      jina_api_key: z.string().optional(),
      figma_access_token: z.string().optional(),
    })
    .optional(),
  figma_console: z
    .object({
      ssh_host: z.string().optional(),
    })
    .optional(),
  hooks: z
    .object({
      profile: z.enum(["minimal", "standard", "strict"]).optional(),
      comment_guard: z.boolean().optional(),
      session_start: z.boolean().optional(),
      pre_tool_use: z.boolean().optional(),
      post_tool_use: z.boolean().optional(),
      pre_compact: z.boolean().optional(),
      stop: z.boolean().optional(),
      session_end: z.boolean().optional(),
      file_edited: z.boolean().optional(),
      prompt_refiner: z.boolean().optional(),
    })
    .optional(),
  memory: z
    .object({
      enabled: z.boolean().optional(),
      directory: z.string().optional(),
      lookback_days: z.number().int().positive().optional(),
      max_injected_chars: z.number().int().positive().optional(),
    })
    .optional(),
  learning: z
    .object({
      enabled: z.boolean().optional(),
      directory: z.string().optional(),
      min_observations: z.number().int().positive().optional(),
      auto_promote: z.boolean().optional(),
      max_patterns: z.number().int().positive().optional(),
      max_injected_patterns: z.number().int().positive().optional(),
    })
    .optional(),
  mcps: z
    .object({
      context7: z.boolean().optional(),
      grep_app: z.boolean().optional(),
      websearch: z.boolean().optional(),
      web_agent_mcp: z.boolean().optional(),
      pg_mcp: z.boolean().optional(),
      ssh_mcp: z.boolean().optional(),
      sudo_mcp: z.boolean().optional(),
      jina: z.boolean().optional(),
      figma_console: z.boolean().optional(),
      mariadb: z.boolean().optional(),
    })
    .optional(),
  agents: z
    .record(
      z.string(),
      z.object({
        model: z.string().optional(),
        variant: z.string().optional(),
        description: z.string().optional(),
        prompt_append: z.string().optional(),
      }),
    )
    .optional(),
});

const DEFAULTS: HarnessConfig = {
  default_mode: "coordinator",
  set_default_agent: true,
  commands: {
    enabled: true,
  },
  hooks: {
    profile: "standard",
    comment_guard: true,
    session_start: true,
    pre_tool_use: true,
    post_tool_use: true,
    pre_compact: true,
    stop: true,
    session_end: true,
    file_edited: true,
    prompt_refiner: false,
  },
  memory: {
    enabled: true,
    lookback_days: 7,
    max_injected_chars: 3500,
  },
  learning: {
    enabled: true,
    min_observations: 6,
    auto_promote: true,
    max_patterns: 24,
    max_injected_patterns: 5,
  },
  mcps: {
    context7: true,
    grep_app: true,
    websearch: true,
    web_agent_mcp: true,
    pg_mcp: true,
    ssh_mcp: true,
    sudo_mcp: false,
    jina: true,
    figma_console: true,
    mariadb: true,
  },
  agents: {},
};

const ConfigSectionSchemas = {
  default_mode: HarnessConfigSchema.shape.default_mode,
  set_default_agent: HarnessConfigSchema.shape.set_default_agent,
  commands: HarnessConfigSchema.shape.commands,
  credentials: HarnessConfigSchema.shape.credentials,
  hooks: HarnessConfigSchema.shape.hooks,
  memory: HarnessConfigSchema.shape.memory,
  learning: HarnessConfigSchema.shape.learning,
  figma_console: HarnessConfigSchema.shape.figma_console,
  mcps: HarnessConfigSchema.shape.mcps,
  agents: HarnessConfigSchema.shape.agents,
} satisfies Record<keyof HarnessConfig, z.ZodTypeAny>;

function formatParseErrors(errors: ParseError[]): string {
  return errors
    .map((error) => `offset ${error.offset}: code ${error.error}`)
    .join(", ");
}

function logConfigWarning(filePath: string, message: string): void {
  console.warn(`[opencode-pair-autonomy] ${message} (${filePath})`);
}

function parseConfigPartially(
  parsed: unknown,
  filePath: string,
): HarnessConfig {
  if (!isObject(parsed)) {
    logConfigWarning(filePath, "Ignoring config because it is not an object");
    return {};
  }

  const partial: Partial<HarnessConfig> = {};
  const invalidSections: string[] = [];

  for (const [key, schema] of Object.entries(ConfigSectionSchemas) as Array<
    [keyof HarnessConfig, z.ZodTypeAny]
  >) {
    if (!(key in parsed)) {
      continue;
    }

    const result = schema.safeParse(parsed[key]);
    if (result.success) {
      (partial as Record<string, unknown>)[key] = result.data;
      continue;
    }

    invalidSections.push(
      `${key}: ${result.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }

  if (invalidSections.length > 0) {
    logConfigWarning(
      filePath,
      `Partially loaded config. Ignored invalid sections:\n- ${invalidSections.join("\n- ")}`,
    );
  }

  return partial;
}

function readConfigFile(filePath: string): HarnessConfig {
  if (!existsSync(filePath)) {
    return {};
  }

  const raw = readFileSync(filePath, "utf8");
  const errors: ParseError[] = [];
  const parsed = parse(raw, errors);
  if (errors.length > 0) {
    logConfigWarning(
      filePath,
      `Ignoring unreadable JSONC config with parse errors: ${formatParseErrors(errors)}`,
    );
    return {};
  }

  const result = HarnessConfigSchema.safeParse(parsed);
  if (result.success) {
    return result.data;
  }

  return parseConfigPartially(parsed, filePath);
}

export function loadHarnessConfig(projectDirectory: string): HarnessConfig {
  const userPath = join(
    homedir(),
    ".config",
    "opencode",
    "opencode-pair-autonomy.jsonc",
  );
  const projectPath = join(
    projectDirectory,
    ".opencode",
    "opencode-pair-autonomy.jsonc",
  );

  return deepMerge(
    deepMerge(DEFAULTS, readConfigFile(userPath)),
    readConfigFile(projectPath),
  );
}

export const SAMPLE_PROJECT_CONFIG = `{
  // Project-level overrides for opencode-pair-autonomy
  "default_mode": "coordinator",
  "credentials": {
    "jina_api_key": "",
    "figma_access_token": ""
  },
  "figma_console": {
    "ssh_host": ""
  },
  "hooks": {
    "profile": "standard",
    "comment_guard": true,
    "session_start": true,
    "pre_tool_use": true,
    "post_tool_use": true,
    "pre_compact": true,
    "stop": true,
    "session_end": true,
    "file_edited": true,
    "prompt_refiner": false
  },
  "memory": {
    "enabled": true,
    "lookback_days": 7,
    "max_injected_chars": 3500
  },
  "learning": {
    "enabled": true,
    "min_observations": 6,
    "auto_promote": true,
    "max_patterns": 24,
    "max_injected_patterns": 5
  },
  "mcps": {
    "context7": true,
    "grep_app": true,
    "websearch": true,
    "web_agent_mcp": true,
    "pg_mcp": true,
    "ssh_mcp": true,
    "sudo_mcp": false,
    "jina": true,
    "figma_console": true,
    "mariadb": true
  },
  "agents": {}
}`;
