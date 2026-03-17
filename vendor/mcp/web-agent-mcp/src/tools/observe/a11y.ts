import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildFollowUpByGoal } from "../../core/observation-flow.js";
import type { RuntimeServices } from "../../server.js";
import { createFailureResult } from "../../core/errors.js";
import { createToolSuccess } from "../../schemas/common.js";
import { observeA11yOutputSchema, observeSessionInputSchema } from "../../schemas/observe.js";

export function registerObserveA11yTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "observe.a11y",
    {
      title: "Observe Accessibility Tree",
      description: "Capture a structured accessibility snapshot for the current page.",
      inputSchema: observeSessionInputSchema,
      outputSchema: observeA11yOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (input: z.infer<typeof observeSessionInputSchema>) => {
      try {
        const action = await services.history.startAction("observe.a11y", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.observeA11y(
          input.session_id,
          input.page_id
        );
        const artifact = await services.artifacts.writeText("a11y", JSON.stringify(result, null, 2), {
          session_id: session.sessionId,
          page_id: page.pageId,
          action_id: action.action_id,
          url: result.url,
          title: result.title
        });
        const data = {
          snapshot_id: artifact.artifact_id,
          format: "a11y",
          url: result.url,
          title: result.title,
          tree: result,
          follow_up_by_goal: buildFollowUpByGoal({
            pageStateKnown: true,
            targetSelectorKnown: false,
            recentFailure: "none"
          })
        };
        await services.history.finishAction(action, "succeeded", { snapshot_id: artifact.artifact_id });
        return createToolSuccess({ ok: true, code: "OK", action_id: action.action_id, session_id: session.sessionId, page_id: page.pageId, artifact_ids: [artifact.artifact_id], data });
      } catch (error) {
        return createFailureResult(error);
      }
    }
  );
}
