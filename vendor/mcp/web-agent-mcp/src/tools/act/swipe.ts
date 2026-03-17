import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeServices } from "../../server.js";
import { actionResultSchema, swipeInputSchema } from "../../schemas/act.js";
import { createActionFailureResponse, createActionSuccessResult } from "./shared.js";

export function registerSwipeTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "act.swipe",
    {
      title: "Swipe Gesture",
      description: "Perform a touch-style swipe from a selector center or explicit coordinates.",
      inputSchema: swipeInputSchema,
      outputSchema: actionResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (input: z.infer<typeof swipeInputSchema>) => {
      try {
        const action = await services.history.startAction("act.swipe", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.swipe(input.session_id, input.page_id, {
          selector: input.selector,
          startX: input.start_x,
          startY: input.start_y,
          deltaX: input.delta_x,
          deltaY: input.delta_y,
          speed: input.speed
        });
        const data = { verificationHint: result.verificationHint };
        services.sessions.recordSuccess(session.sessionId);
        await services.history.finishAction(action, "succeeded", data);
        return createActionSuccessResult({
          actionId: action.action_id,
          sessionId: session.sessionId,
          pageId: page.pageId,
          appliedMode: "physical",
          verificationHint: result.verificationHint,
          targetSelectorKnown: Boolean(input.selector)
        });
      } catch (error) {
        return createActionFailureResponse({
          services,
          error,
          sessionId: input.session_id,
          pageId: input.page_id,
          appliedMode: "physical",
          targetSelectorKnown: Boolean(input.selector)
        });
      }
    }
  );
}
