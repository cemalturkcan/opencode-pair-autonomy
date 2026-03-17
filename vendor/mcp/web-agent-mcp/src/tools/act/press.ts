import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeServices } from "../../server.js";
import { actionResultSchema, pressInputSchema } from "../../schemas/act.js";
import { createActionFailureResponse, createActionSuccessResult } from "./shared.js";

export function registerPressTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "act.press",
    {
      title: "Press Key",
      description: "Press a keyboard key on the page or a targeted selector.",
      inputSchema: pressInputSchema,
      outputSchema: actionResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (input: z.infer<typeof pressInputSchema>) => {
      try {
        const action = await services.history.startAction("act.press", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.press(input.session_id, input.page_id, {
          key: input.key,
          selector: input.selector,
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
