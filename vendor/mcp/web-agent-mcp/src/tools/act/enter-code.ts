import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeServices } from "../../server.js";
import { actionResultSchema, enterCodeInputSchema } from "../../schemas/act.js";
import { createActionFailureResponse, createActionSuccessResult } from "./shared.js";

export function registerEnterCodeTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "act.enter_code",
    {
      title: "Enter Verification Code",
      description: "Fill a one-time code into a focused, single, or segmented input flow.",
      inputSchema: enterCodeInputSchema,
      outputSchema: actionResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (input: z.infer<typeof enterCodeInputSchema>) => {
      const action = await services.history.startAction("act.enter_code", input, {
        session_id: input.session_id,
        page_id: input.page_id
      });

      try {
        const { session, page, result } = await services.sessions.enterCode(input.session_id, input.page_id, {
          code: input.code,
          selector: input.selector,
          submit: input.submit,
          timeoutMs: input.timeout_ms
        });

        services.sessions.recordSuccess(session.sessionId);
        await services.history.finishAction(action, "succeeded", {
          verificationHint: result.verificationHint
        });

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
          actionId: action.action_id,
          sessionId: input.session_id,
          pageId: input.page_id,
          appliedMode: "semantic",
          targetSelectorKnown: Boolean(input.selector)
        });
      }
    }
  );
}
