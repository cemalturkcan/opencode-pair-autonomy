import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeServices } from "../../server.js";
import { actionResultSchema, wheelInputSchema } from "../../schemas/act.js";
import { createActionFailureResponse, createActionSuccessResult } from "./shared.js";

export function registerWheelTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "act.wheel",
    {
      title: "Wheel Scroll",
      description: "Scroll the viewport or a target element using wheel input.",
      inputSchema: wheelInputSchema,
      outputSchema: actionResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (input: z.infer<typeof wheelInputSchema>) => {
      try {
        const action = await services.history.startAction("act.wheel", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.wheel(input.session_id, input.page_id, {
          selector: input.selector,
          deltaX: input.delta_x,
          deltaY: input.delta_y,
          steps: input.steps,
          stepDelayMs: input.step_delay_ms,
          timeoutMs: input.timeout_ms
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
