import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import type { HarnessConfig } from "./types";

type McpConfig = Record<string, unknown>;

function configRoot(): string {
  const envDir = process.env.OPENCODE_CONFIG_DIR?.trim();
  if (envDir) {
    return envDir;
  }
  return join(homedir(), ".config", "opencode");
}

function vendorRoot(): string {
  return join(configRoot(), "vendor");
}

function binRoot(): string {
  return join(configRoot(), "bin");
}

function ensureBearer(token: string): string {
  return token.trim().toLowerCase().startsWith("bearer ")
    ? token.trim()
    : `Bearer ${token.trim()}`;
}

function resolveVendorMcpPath(name: string): string {
  return join(vendorRoot(), "mcp", name);
}

function resolveMcpServerRoot(name: string): string {
  const vendorPath = resolveVendorMcpPath(name);
  if (existsSync(vendorPath)) {
    return vendorPath;
  }
  return join(configRoot(), "mcp", name);
}

function readExistingJinaBearer(): string | undefined {
  const root = configRoot();
  const candidates = [
    join(root, "opencode.json"),
    join(root, "opencode.jsonc"),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      const parsed = parse(readFileSync(filePath, "utf8")) as {
        mcp?: {
          jina?: {
            headers?: {
              Authorization?: string;
            };
          };
        };
      };
      const bearer = parsed?.mcp?.jina?.headers?.Authorization;
      if (typeof bearer === "string" && bearer.trim()) {
        return bearer;
      }
    } catch {}
  }

  return undefined;
}

function localCommand(scriptPath: string): string[] {
  return ["node", scriptPath];
}

function commandExistsInPath(command: string): boolean {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return false;
  }

  const executableNames =
    process.platform === "win32"
      ? [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`]
      : [command];

  return pathValue
    .split(process.platform === "win32" ? ";" : ":")
    .some((directory) =>
      executableNames.some((name) => existsSync(join(directory, name))),
    );
}

function resolveFffCommand(): string[] {
  const configured = process.env.FFF_MCP_PATH?.trim();
  if (configured) {
    return [configured];
  }

  const bundled = join(
    binRoot(),
    process.platform === "win32" ? "fff-mcp.exe" : "fff-mcp",
  );
  if (existsSync(bundled)) {
    return [bundled];
  }

  const fallback = process.platform === "win32" ? "fff-mcp.exe" : "fff-mcp";
  return commandExistsInPath(fallback) ? [fallback] : [];
}

export function createHarnessMcps(
  config: HarnessConfig,
): Record<string, McpConfig> {
  const toggles = config.mcps ?? {};
  const result: Record<string, McpConfig> = {};
  const root = configRoot();

  if (toggles.context7 !== false) {
    result.context7 = {
      type: "remote",
      url: "https://mcp.context7.com/mcp",
      enabled: true,
      headers: process.env.CONTEXT7_API_KEY
        ? { Authorization: `Bearer ${process.env.CONTEXT7_API_KEY}` }
        : undefined,
      oauth: false,
      timeout: 60000,
    };
  }

  if (toggles.grep_app !== false) {
    result.grep_app = {
      type: "remote",
      url: "https://mcp.grep.app",
      enabled: true,
      oauth: false,
      timeout: 60000,
    };
  }

  if (toggles.websearch !== false) {
    result.websearch = {
      type: "remote",
      url: process.env.EXA_API_KEY
        ? `https://mcp.exa.ai/mcp?tools=web_search_exa&exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}`
        : "https://mcp.exa.ai/mcp?tools=web_search_exa",
      enabled: true,
      ...(process.env.EXA_API_KEY
        ? { headers: { "x-api-key": process.env.EXA_API_KEY } }
        : {}),
      oauth: false,
      timeout: 60000,
    };
  }

  if (toggles.fff !== false) {
    const command = resolveFffCommand();
    if (command.length > 0) {
      result.fff = {
        type: "local",
        command,
        enabled: true,
        timeout: 60000,
      };
    }
  }

  if (toggles.web_agent_mcp !== false) {
    const serverRoot = resolveMcpServerRoot("web-agent-mcp");
    result["web-agent-mcp"] = {
      type: "local",
      command: localCommand(join(serverRoot, "dist", "src", "server.js")),
      enabled: true,
      timeout: 60000,
    };
  }

  if (toggles.pg_mcp !== false) {
    const serverRoot = resolveMcpServerRoot("pg-mcp");
    result["pg-mcp"] = {
      type: "local",
      command: localCommand(join(serverRoot, "src", "index.js")),
      environment: {
        PG_MCP_CONFIG_PATH: join(serverRoot, "config.json"),
      },
      enabled: true,
      timeout: 60000,
    };
  }

  if (toggles.ssh_mcp !== false) {
    const serverRoot = resolveMcpServerRoot("ssh-mcp");
    result["ssh-mcp"] = {
      type: "local",
      command: localCommand(join(serverRoot, "src", "index.js")),
      environment: {
        SSH_MCP_CONFIG_PATH: join(serverRoot, "config.json"),
      },
      enabled: true,
      timeout: 60000,
    };
  }

  if (toggles.sudo_mcp !== false) {
    const serverRoot = resolveMcpServerRoot("sudo-mcp");
    result["sudo-mcp"] = {
      type: "local",
      command: localCommand(join(serverRoot, "src", "index.js")),
      environment: {
        SUDO_MCP_CONFIG_PATH: join(serverRoot, "config.json"),
      },
      enabled: true,
      timeout: 60000,
    };
  }

  if (toggles.jina !== false) {
    const configuredToken = config.credentials?.jina_api_key?.trim();
    const bearer = configuredToken
      ? ensureBearer(configuredToken)
      : process.env.JINA_API_KEY
        ? ensureBearer(process.env.JINA_API_KEY)
        : readExistingJinaBearer();

    result.jina = {
      type: "remote",
      url: "https://mcp.jina.ai/v1",
      ...(bearer ? { headers: { Authorization: bearer } } : {}),
      enabled: true,
      oauth: false,
      timeout: 60000,
    };
  }

  return result;
}
