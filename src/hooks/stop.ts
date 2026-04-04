import type { PluginInput } from "@opencode-ai/plugin";
import type { HookRuntime } from "./runtime";
import { unwrapData } from "./sdk";
import { resolveSessionOrEntityID } from "./runtime";

function extractTextParts(parts: Array<{ type?: string; text?: string }>): string {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

type Todo = {
  content?: string;
  status?: string;
};

type Message = {
  info?: {
    role?: string;
  };
  parts?: Array<{ type?: string; text?: string }>;
};

function extractText(message: Message | undefined): string {
  return extractTextParts(message?.parts ?? []);
}

export function createStopHook(ctx: PluginInput, runtime: HookRuntime) {
  return {
    "session.idle": async (input?: unknown): Promise<void> => {
      // session.idle input IS the session object, so bare .id is safe
      const sessionID = resolveSessionOrEntityID(input);
      if (!sessionID) {
        return;
      }

      const messagesResponse = await ctx.client.session
        .messages({
          path: { id: sessionID },
          query: { directory: ctx.directory, limit: 40 },
        })
        .catch(() => null);
      const todosResponse = await ctx.client.session
        .todo({
          path: { id: sessionID },
          query: { directory: ctx.directory },
        })
        .catch(() => null);

      const messages = unwrapData<Message[]>(messagesResponse, []);
      const todos = unwrapData<Todo[]>(todosResponse, []);
      const lastUser = [...messages]
        .reverse()
        .find((message) => message.info?.role === "user");
      const lastAssistant = [...messages]
        .reverse()
        .find((message) => message.info?.role === "assistant");
      const incompleteTodos = todos
        .filter(
          (todo) =>
            todo.status &&
            !["completed", "cancelled", "blocked", "deleted"].includes(
              todo.status,
            ),
        )
        .map((todo) => todo.content ?? "")
        .filter(Boolean);

      const facts = runtime.detectProjectFacts();
      const summary = {
        sessionID,
        savedAt: new Date().toISOString(),
        packageManager: facts.packageManager,
        languages: facts.languages,
        frameworks: facts.frameworks,
        changedFiles: runtime.getEditedFiles(sessionID),
        incompleteTodos,
        lastUserMessage: extractText(lastUser),
        lastAssistantMessage: extractText(lastAssistant),
        approxTokens: runtime.estimateTokens([
          extractText(lastUser),
          extractText(lastAssistant),
          ...incompleteTodos,
        ]),
      };
      runtime.saveSessionSummary(summary);
      const promotedPatterns = runtime.promoteLearning(summary);

      runtime.appendObservation({
        timestamp: new Date().toISOString(),
        phase: "idle",
        sessionID,
        agent: runtime.getSessionAgent(sessionID),
        note: `idle_summary_saved:${incompleteTodos.length}:${promotedPatterns.length}`,
      });
    },
  };
}
