import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildFollowUpByGoal } from "../../core/observation-flow.js";
import type { RuntimeServices } from "../../server.js";
import { createFailureResult } from "../../core/errors.js";
import { createToolSuccess } from "../../schemas/common.js";
import { observeDomOutputSchema, observeSessionInputSchema } from "../../schemas/observe.js";

export function registerObserveDomTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "observe.dom",
    {
      title: "Observe DOM Summary",
      description: "Return a lightweight DOM summary for the current page.",
      inputSchema: observeSessionInputSchema,
      outputSchema: observeDomOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (input: z.infer<typeof observeSessionInputSchema>) => {
      try {
        const action = await services.history.startAction("observe.dom", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.observeDom(
          input.session_id,
          input.page_id
        );
        const artifact = await services.artifacts.writeText("dom", JSON.stringify(result, null, 2), {
          session_id: session.sessionId,
          page_id: page.pageId,
          action_id: action.action_id,
          url: result.url,
          title: result.title
        });
        const data = {
          snapshot_id: artifact.artifact_id,
          format: "dom",
          url: result.url,
          title: result.title,
          dom_summary: result.summary,
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
