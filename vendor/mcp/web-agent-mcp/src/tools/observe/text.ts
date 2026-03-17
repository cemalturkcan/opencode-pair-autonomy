import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildFollowUpByGoal } from "../../core/observation-flow.js";
import type { RuntimeServices } from "../../server.js";
import { createFailureResult } from "../../core/errors.js";
import { createToolSuccess } from "../../schemas/common.js";
import { observeSessionInputSchema, observeTextOutputSchema } from "../../schemas/observe.js";

const observeTextInputSchema = observeSessionInputSchema.extend({
  format: z.enum(["text", "markdown"]).default("text")
});

export function registerObserveTextTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "observe.text",
    {
      title: "Observe Text",
      description: "Return extracted page text as a cheap observation artifact.",
      inputSchema: observeTextInputSchema,
      outputSchema: observeTextOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (input: z.infer<typeof observeTextInputSchema>) => {
      try {
        const action = await services.history.startAction("observe.text", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.observeText(
          input.session_id,
          input.page_id,
          input.format
        );
        const artifact = await services.artifacts.writeText(input.format, result.content, {
          session_id: session.sessionId,
          page_id: page.pageId,
          action_id: action.action_id,
          url: result.url,
          title: result.title,
          meta: { requested_format: input.format, truncated: result.truncated }
        });
        const data = {
          artifact_id: artifact.artifact_id,
          format: input.format,
          content: result.content,
          truncated: result.truncated,
          url: result.url,
          title: result.title,
          follow_up_by_goal: buildFollowUpByGoal({
            pageStateKnown: true,
            targetSelectorKnown: false,
            recentFailure: "none"
          })
        };
        await services.history.finishAction(action, "succeeded", {
          artifact_id: artifact.artifact_id,
          truncated: result.truncated
        });
        return createToolSuccess({ ok: true, code: "OK", action_id: action.action_id, session_id: session.sessionId, page_id: page.pageId, artifact_ids: [artifact.artifact_id], data });
      } catch (error) {
        return createFailureResult(error);
      }
    }
  );
}
