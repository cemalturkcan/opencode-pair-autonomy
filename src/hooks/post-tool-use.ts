import { spawn } from "node:child_process";
import type { PluginInput } from "@opencode-ai/plugin";
import type { HarnessConfig, HookProfile } from "../types";
import type { HookRuntime } from "./runtime";
import { profileMatches, resolveFilePathFromArgs, resolveSessionID, resolveToolArgs, resolveToolName, stringifyToolOutput } from "./runtime";

function runCommand(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CI: "true",
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", () => resolve(""));
    child.on("close", () => resolve((stdout || stderr).trim()));
  });
}

export function createPostToolUseHook(
  ctx: PluginInput,
  config: HarnessConfig,
  runtime: HookRuntime,
  profile: HookProfile,
) {
  return {
    "tool.execute.after": async (input: unknown, output: unknown): Promise<void> => {
      const sessionID = resolveSessionID(input);
      const tool = resolveToolName(input);
      const args = resolveToolArgs(input);
      const filePath = resolveFilePathFromArgs(args);

      if (sessionID && filePath && ["write", "edit"].includes(tool ?? "")) {
        runtime.rememberEditedFile(sessionID, filePath);
      }

      if (filePath && profileMatches(profile, ["standard", "strict"]) && /\.(ts|tsx|js|jsx)$/i.test(filePath)) {
        const source = runtime.readText(filePath) ?? "";
        if (source.includes("console.log")) {
          runtime.appendObservation({
            timestamp: new Date().toISOString(),
            phase: "post",
            sessionID,
            agent: sessionID ? runtime.getSessionAgent(sessionID) : undefined,
            tool,
            note: "console_log_found",
          });
        }
      }

      if (
        filePath
        && tool === "edit"
        && profileMatches(profile, ["standard", "strict"])
        && /\.(ts|tsx|js|jsx|json|md)$/i.test(filePath)
        && !/[/\\](node_modules|dist|build)[/\\]/.test(filePath)
      ) {
        await runCommand("bun", ["x", "prettier", "--write", filePath], ctx.directory).catch(() => undefined);
      }

      if (tool === "bash" && profileMatches(profile, ["standard", "strict"])) {
        const command = typeof args.command === "string" ? args.command : "";
        const text = stringifyToolOutput(output).toLowerCase();
        if (/\b(build|test|lint)\b/.test(command) && /(error|failed|failure)/.test(text)) {
          runtime.appendObservation({
            timestamp: new Date().toISOString(),
            phase: "post",
            sessionID,
            agent: sessionID ? runtime.getSessionAgent(sessionID) : undefined,
            tool,
            note: "build_or_test_failure_detected",
          });
        }
      }

      runtime.appendObservation({
        timestamp: new Date().toISOString(),
        phase: "post",
        sessionID,
        agent: sessionID ? runtime.getSessionAgent(sessionID) : undefined,
        tool,
      });
    },
  };
}
