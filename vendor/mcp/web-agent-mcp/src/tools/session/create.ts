import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeServices } from "../../server.js";
import { createFailureResult } from "../../core/errors.js";
import { createToolSuccess } from "../../schemas/common.js";
import { createSessionInputSchema, sessionOutputSchema } from "../../schemas/session.js";

export function registerCreateSessionTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "session.create",
    {
      title: "Create Session",
      description: "Launch a browser session and create the initial page.",
      inputSchema: createSessionInputSchema,
      outputSchema: sessionOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (input: z.infer<typeof createSessionInputSchema>) => {
      try {
        const action = await services.history.startAction("session.create", input);
        const profileMode = input.profile_mode ?? (services.env.chromeUserDataDir ? "persistent" : "ephemeral");
        const session = await services.sessions.createSession({
          profileMode,
          locale: input.locale,
          timezoneId: input.timezone_id,
          userDataDir: input.user_data_dir,
          profileDirectory: input.profile_directory,
          humanize: input.humanize,
          launchArgs: input.launch_args,
          viewport: input.viewport
        });
        const data = {
          session_id: session.sessionId,
          context_id: session.contextId,
          page_id: session.primaryPageId,
          status: session.status,
          profile_mode: session.profileMode,
          locale: session.locale,
          timezone_id: session.timezoneId,
          user_data_dir: session.userDataDir,
          profile_directory: session.profileDirectory,
          humanize: session.humanize,
          launch_args: session.launchArgs,
          viewport: session.viewport,
          created_at: session.createdAt,
          health: {
            consecutive_errors: session.consecutiveErrors,
            last_error_at: session.lastErrorAt,
            restart_recommended: false
          },
          capabilities: {
            observe: true,
            screenshot: true,
            evaluate: true
          }
        };
        services.sessions.recordSuccess(session.sessionId);
        await services.history.finishAction(action, "succeeded", data);
        return createToolSuccess({ ok: true, code: "OK", action_id: action.action_id, session_id: session.sessionId, page_id: session.primaryPageId, data });
      } catch (error) {
        return createFailureResult(error);
      }
    }
  );
}
