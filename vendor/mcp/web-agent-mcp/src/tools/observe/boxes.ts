import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeServices } from "../../server.js";
import { createFailureResult } from "../../core/errors.js";
import { createToolSuccess } from "../../schemas/common.js";
import { boxesInputSchema, observeBoxesOutputSchema } from "../../schemas/observe.js";

export function registerObserveBoxesTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "observe.boxes",
    {
      title: "Observe Element Boxes",
      description: "Resolve bounding boxes for one or more CSS selectors on the current page.",
      inputSchema: boxesInputSchema,
      outputSchema: observeBoxesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (input: z.infer<typeof boxesInputSchema>) => {
      try {
        const action = await services.history.startAction("observe.boxes", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.observeBoxes(
          input.session_id,
          input.page_id,
          input.selectors
        );
        const artifact = await services.artifacts.writeText("boxes", JSON.stringify(result, null, 2), {
          session_id: session.sessionId,
          page_id: page.pageId,
          action_id: action.action_id,
          url: page.url,
          title: page.title,
          meta: {
            selector_count: input.selectors.length
          }
        });
        const data = {
          element_map_id: artifact.artifact_id,
          elements: result
        };
        await services.history.finishAction(action, "succeeded", {
          element_map_id: artifact.artifact_id,
          element_count: result.length
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
