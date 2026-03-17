import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeServices } from "../../server.js";
import { actionResultSchema, waitForInputSchema } from "../../schemas/act.js";
import { createActionFailureResponse, createActionSuccessResult } from "./shared.js";

export function registerWaitForTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "act.wait_for",
    {
      title: "Wait For Condition",
      description: "Wait for a selector or text to appear on the current page.",
      inputSchema: waitForInputSchema,
      outputSchema: actionResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (input: z.infer<typeof waitForInputSchema>) => {
      try {
        const action = await services.history.startAction("act.wait_for", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.waitFor(input.session_id, input.page_id, {
          selector: input.selector,
          text: input.text,
          timeoutMs: input.timeout_ms
        });
        const data = { verificationHint: result.verificationHint };
        services.sessions.recordSuccess(session.sessionId);
        await services.history.finishAction(action, "succeeded", data);
        return createActionSuccessResult({
          actionId: action.action_id,
          sessionId: session.sessionId,
          pageId: page.pageId,
          appliedMode: "semantic",
          verificationHint: result.verificationHint,
          targetSelectorKnown: Boolean(input.selector)
        });
      } catch (error) {
        return createActionFailureResponse({
          services,
          error,
          sessionId: input.session_id,
          pageId: input.page_id,
          appliedMode: "semantic",
          targetSelectorKnown: Boolean(input.selector)
        });
      }
    }
  );
}
