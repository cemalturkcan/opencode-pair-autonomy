import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildFollowUpByGoal } from "../../core/observation-flow.js";
import { createFailureResult } from "../../core/errors.js";
import {
  observePageStateOutputSchema,
  pageStateInputSchema
} from "../../schemas/observe.js";
import { createToolSuccess } from "../../schemas/common.js";
import type { RuntimeServices } from "../../server.js";

export function registerObservePageStateTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "observe.page_state",
    {
      title: "Observe Page State",
      description: "Return a composite page snapshot with text, frames, controls, and recent network activity.",
      inputSchema: pageStateInputSchema,
      outputSchema: observePageStateOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (input: z.infer<typeof pageStateInputSchema>) => {
      try {
        const action = await services.history.startAction("observe.page_state", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.observePageState(
          input.session_id,
          input.page_id,
          input.recent_network_limit
        );

        const followUpByGoal = buildFollowUpByGoal({
          pageStateKnown: true,
          targetSelectorKnown: result.inputs.length > 0 || result.buttons.length > 0,
          recentFailure: "none"
        });

        const artifact = await services.artifacts.writeText("dom", JSON.stringify(result, null, 2), {
          session_id: session.sessionId,
          page_id: page.pageId,
          action_id: action.action_id,
          url: result.url,
          title: result.title,
          meta: {
            frame_count: result.frames.length,
            input_count: result.inputs.length,
            button_count: result.buttons.length,
            recent_network_count: result.recentNetwork.length
          }
        });

        const data = {
          snapshot_id: artifact.artifact_id,
          url: result.url,
          title: result.title,
          text: result.text,
          truncated: result.truncated,
          dom_summary: result.dom,
          inputs: result.inputs,
          buttons: result.buttons,
          frames: result.frames,
          recent_network: result.recentNetwork,
          follow_up_by_goal: followUpByGoal
        };

        await services.history.finishAction(action, "succeeded", {
          snapshot_id: artifact.artifact_id,
          frame_count: result.frames.length,
          recent_network_count: result.recentNetwork.length
        });

        return createToolSuccess({
          ok: true,
          code: "OK",
          action_id: action.action_id,
          session_id: session.sessionId,
          page_id: page.pageId,
          artifact_ids: [artifact.artifact_id],
          data
        });
      } catch (error) {
        return createFailureResult(error);
      }
    }
  );
}
