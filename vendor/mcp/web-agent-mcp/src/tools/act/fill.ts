import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeServices } from "../../server.js";
import { actionResultSchema, fillInputSchema } from "../../schemas/act.js";
import { createActionFailureResponse, createActionSuccessResult } from "./shared.js";

export function registerFillTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "act.fill",
    {
      title: "Fill Input",
      description: "Fill a form input using a CSS selector.",
      inputSchema: fillInputSchema,
      outputSchema: actionResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (input: z.infer<typeof fillInputSchema>) => {
      try {
        const action = await services.history.startAction("act.fill", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.fill(input.session_id, input.page_id, {
          selector: input.selector,
          value: input.value,
          clearFirst: input.clear_first,
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
