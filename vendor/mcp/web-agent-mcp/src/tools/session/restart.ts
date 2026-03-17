import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeServices } from "../../server.js";
import { createFailureResult } from "../../core/errors.js";
import { createToolSuccess } from "../../schemas/common.js";
import {
  restartSessionInputSchema,
  sessionRestartOutputSchema
} from "../../schemas/session.js";

export function registerRestartSessionTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "session.restart",
    {
      title: "Restart Session",
      description: "Restart a browser session while preserving its launch profile settings.",
      inputSchema: restartSessionInputSchema,
      outputSchema: sessionRestartOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (input: z.infer<typeof restartSessionInputSchema>) => {
      try {
        const action = await services.history.startAction("session.restart", input, {
          session_id: input.session_id
        });
        const session = await services.sessions.restartSession(input.session_id);
        const health = services.sessions.getSessionHealth(session.sessionId);
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
            consecutive_errors: health.consecutiveErrors,
            last_error_at: health.lastErrorAt,
            restart_recommended: health.restartRecommended
          },
          capabilities: {
            observe: true,
            screenshot: true,
            evaluate: true
          }
        };
        await services.history.finishAction(action, "succeeded", data);
        return createToolSuccess({
          ok: true,
          code: "OK",
          action_id: action.action_id,
          session_id: session.sessionId,
          page_id: session.primaryPageId,
          data
        });
      } catch (error) {
        return createFailureResult(error);
      }
    }
  );
}
