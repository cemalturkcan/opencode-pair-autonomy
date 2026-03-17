import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeServices } from "../../server.js";
import { actionResultSchema, dragInputSchema } from "../../schemas/act.js";
import { createActionFailureResponse, createActionSuccessResult } from "./shared.js";

export function registerDragTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "act.drag",
    {
      title: "Drag Between Elements",
      description: "Drag from one selector to another using mouse input.",
      inputSchema: dragInputSchema,
      outputSchema: actionResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (input: z.infer<typeof dragInputSchema>) => {
      try {
        const action = await services.history.startAction("act.drag", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.drag(input.session_id, input.page_id, {
          fromSelector: input.from_selector,
          toSelector: input.to_selector,
          steps: input.steps,
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
          targetSelectorKnown: true
        });
      } catch (error) {
        return createActionFailureResponse({
          services,
          error,
          sessionId: input.session_id,
          pageId: input.page_id,
          appliedMode: "physical",
          targetSelectorKnown: true
        });
      }
    }
  );
}
