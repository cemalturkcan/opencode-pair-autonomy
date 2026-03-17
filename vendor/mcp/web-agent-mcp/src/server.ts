import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { loadEnv } from "./config/env.js";
import { createCloakBrowserAdapter } from "./adapters/cloakbrowser/launcher.js";
import { ArtifactStore } from "./core/artifact-store.js";
import { SessionManager } from "./core/session-manager.js";
import { TaskHistoryStore } from "./core/task-history.js";
import { registerTools } from "./tools/register-tools.js";

export type RuntimeServices = {
  env: ReturnType<typeof loadEnv>;
  artifacts: ArtifactStore;
  history: TaskHistoryStore;
  sessions: SessionManager;
};

export function createRuntimeServices() {
  const env = loadEnv();
  const artifacts = new ArtifactStore(env);
  const history = new TaskHistoryStore(env);
  const adapter = createCloakBrowserAdapter(env);
  const sessions = new SessionManager({ env, adapter });

  return { env, artifacts, history, sessions } satisfies RuntimeServices;
}

export function createServer(services = createRuntimeServices()) {
  const server = new McpServer(
    {
      name: services.env.serverName,
      version: services.env.serverVersion,
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  registerTools(server, services);
  return server;
}

export async function startStdioServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("web-agent-mcp running on stdio");
}

async function main() {
  await startStdioServer();
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  const argv1Url = pathToFileURL(process.argv[1]).href;
  if (import.meta.url === argv1Url) return true;
  try {
    return (
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
  });
}
