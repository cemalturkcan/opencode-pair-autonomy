import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeServices } from "../../server.js";
import { createFailureResult } from "../../core/errors.js";
import { createToolSuccess } from "../../schemas/common.js";
import { logsInputSchema, observeLogsOutputSchema } from "../../schemas/observe.js";

export function registerObserveNetworkTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "observe.network",
    {
      title: "Observe Network Logs",
      description: "Return recent network events captured for the current page.",
      inputSchema: logsInputSchema,
      outputSchema: observeLogsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (input: z.infer<typeof logsInputSchema>) => {
      try {
        const action = await services.history.startAction("observe.network", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.observeNetwork(
          input.session_id,
          input.page_id,
          input.limit
        );
        const artifact = await services.artifacts.writeText("network", JSON.stringify(result, null, 2), {
          session_id: session.sessionId,
          page_id: page.pageId,
          action_id: action.action_id,
          url: page.url,
          title: page.title,
          meta: {
            limit: input.limit,
            entry_count: result.length
          }
        });
        const data = {
          artifact_id: artifact.artifact_id,
          entries: result
        };
        await services.history.finishAction(action, "succeeded", {
          artifact_id: artifact.artifact_id,
          entry_count: result.length
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
