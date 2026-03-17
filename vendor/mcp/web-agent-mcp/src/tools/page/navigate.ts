import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildFollowUpByGoal } from "../../core/observation-flow.js";
import type { RuntimeServices } from "../../server.js";
import { createId } from "../../utils/ids.js";
import { createFailureResult } from "../../core/errors.js";
import { createToolSuccess } from "../../schemas/common.js";
import { navigatePageInputSchema, navigatePageOutputSchema } from "../../schemas/page.js";

export function registerNavigatePageTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "page.navigate",
    {
      title: "Navigate Page",
      description: "Navigate the active page to a URL and return lightweight metadata.",
      inputSchema: navigatePageInputSchema,
      outputSchema: navigatePageOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (input: z.infer<typeof navigatePageInputSchema>) => {
      try {
        const action = await services.history.startAction("page.navigate", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.navigate(
          input.session_id,
          input.page_id,
          input.url,
          input.wait_until
        );
        const response = {
          page_id: page.pageId,
          requested_url: result.requestedUrl,
          final_url: result.finalUrl,
          title: result.title,
          navigation_id: createId("action"),
          timings: {
            elapsed_ms: result.elapsedMs
          },
          follow_up_by_goal: buildFollowUpByGoal({
            pageStateKnown: false,
            targetSelectorKnown: false,
            recentFailure: "none"
          })
        };
        await services.history.finishAction(action, "succeeded", response);
        return createToolSuccess({ ok: true, code: "OK", action_id: action.action_id, session_id: session.sessionId, page_id: page.pageId, data: response });
      } catch (error) {
        return createFailureResult(error);
      }
    }
  );
}
