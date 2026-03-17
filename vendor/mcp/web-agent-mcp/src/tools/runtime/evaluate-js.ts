import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeServices } from "../../server.js";
import { createFailureResult } from "../../core/errors.js";
import { createToolSuccess } from "../../schemas/common.js";
import { evaluateJsInputSchema, evaluateJsOutputSchema } from "../../schemas/runtime.js";

const INLINE_LIMIT = 8000;

export function registerEvaluateJsTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "runtime.evaluate_js",
    {
      title: "Evaluate Runtime JavaScript",
      description: "Evaluate a JavaScript expression in the current page context and persist the result as an artifact.",
      inputSchema: evaluateJsInputSchema,
      outputSchema: evaluateJsOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (input: z.infer<typeof evaluateJsInputSchema>) => {
      try {
        const action = await services.history.startAction("runtime.evaluate_js", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.evaluateJs(
          input.session_id,
          input.page_id,
          {
            expression: input.expression,
            awaitPromise: input.await_promise
          }
        );

        const serialized = JSON.stringify(result.value, null, 2);
        const artifact = await services.artifacts.writeText("eval", serialized, {
          session_id: session.sessionId,
          page_id: page.pageId,
          action_id: action.action_id,
          url: result.url,
          title: result.title,
          meta: {
            await_promise: input.await_promise,
            inline: serialized.length <= INLINE_LIMIT
          }
        });

        const data = {
          artifact_id: artifact.artifact_id,
          value: serialized.length <= INLINE_LIMIT ? result.value : undefined,
          preview: serialized.length <= INLINE_LIMIT ? undefined : `${serialized.slice(0, INLINE_LIMIT)}...`,
          truncated: serialized.length > INLINE_LIMIT,
          url: result.url,
          title: result.title,
          bytes: artifact.bytes,
          storage_path: artifact.storage_path
        };

        await services.history.finishAction(action, "succeeded", {
          artifact_id: artifact.artifact_id,
          truncated: data.truncated
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
