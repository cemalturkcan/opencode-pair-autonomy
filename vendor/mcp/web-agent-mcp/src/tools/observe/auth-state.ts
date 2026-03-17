import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildFollowUpByGoal } from "../../core/observation-flow.js";
import { createFailureResult } from "../../core/errors.js";
import {
  authStateInputSchema,
  observeAuthStateOutputSchema
} from "../../schemas/observe.js";
import { createToolSuccess } from "../../schemas/common.js";
import type { RuntimeServices } from "../../server.js";

export function registerObserveAuthStateTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "observe.auth_state",
    {
      title: "Observe Auth State",
      description: "Classify login flows using page text, frames, and recent network activity.",
      inputSchema: authStateInputSchema,
      outputSchema: observeAuthStateOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (input: z.infer<typeof authStateInputSchema>) => {
      try {
        const action = await services.history.startAction("observe.auth_state", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.observeAuthState(
          input.session_id,
          input.page_id,
          input.recent_network_limit
        );

        const followUpByGoal = buildFollowUpByGoal({
          pageStateKnown: true,
          targetSelectorKnown: result.suggestedSelectors.length > 0,
          recentFailure: "none"
        });

        const artifact = await services.artifacts.writeText("dom", JSON.stringify(result, null, 2), {
          session_id: session.sessionId,
          page_id: page.pageId,
          action_id: action.action_id,
          url: result.url,
          title: result.title,
          meta: {
            state: result.state,
            confidence: result.confidence,
            suggested_selector_count: result.suggestedSelectors.length
          }
        });

        const data = {
          snapshot_id: artifact.artifact_id,
          url: result.url,
          title: result.title,
          state: result.state,
          confidence: result.confidence,
          summary: result.summary,
          evidence: result.evidence,
          suggested_selectors: result.suggestedSelectors,
          candidate_frames: result.frames,
          recent_network: result.recentNetwork,
          follow_up_by_goal: followUpByGoal
        };

        await services.history.finishAction(action, "succeeded", {
          snapshot_id: artifact.artifact_id,
          state: result.state,
          confidence: result.confidence
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
