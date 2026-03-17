import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeServices } from "../../server.js";
import { actionResultSchema, clickInputSchema } from "../../schemas/act.js";
import { createActionFailureResponse, createActionSuccessResult } from "./shared.js";

export function registerClickTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "act.click",
    {
      title: "Click Element",
      description: "Click an element using a CSS selector.",
      inputSchema: clickInputSchema,
      outputSchema: actionResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (input: z.infer<typeof clickInputSchema>) => {
      try {
        const action = await services.history.startAction("act.click", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.click(input.session_id, input.page_id, {
          selector: input.selector,
          button: input.button,
          clickCount: input.click_count,
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
          targetSelectorKnown: true
        });
      } catch (error) {
        return createActionFailureResponse({
          services,
          error,
          sessionId: input.session_id,
          pageId: input.page_id,
          appliedMode: "semantic",
          targetSelectorKnown: true
        });
      }
    }
  );
}
