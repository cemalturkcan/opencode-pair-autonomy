import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildFollowUpByGoal } from "../../core/observation-flow.js";
import type { RuntimeServices } from "../../server.js";
import { createFailureResult } from "../../core/errors.js";
import { createToolSuccess } from "../../schemas/common.js";
import { observeScreenshotOutputSchema, screenshotInputSchema } from "../../schemas/observe.js";

export function registerObserveScreenshotTool(server: McpServer, services: RuntimeServices) {
  server.registerTool(
    "observe.screenshot",
    {
      title: "Observe Screenshot",
      description: "Capture a viewport, full-page, or element screenshot and persist it as an artifact.",
      inputSchema: screenshotInputSchema,
      outputSchema: observeScreenshotOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (input: z.infer<typeof screenshotInputSchema>) => {
      try {
        const action = await services.history.startAction("observe.screenshot", input, {
          session_id: input.session_id,
          page_id: input.page_id
        });
        const { session, page, result } = await services.sessions.takeScreenshot(
          input.session_id,
          input.page_id,
          input.mode,
          input.format,
          input.quality,
          input.selector
        );
        const artifact = await services.artifacts.writeBinary("screenshot", result.bytes, input.format, {
          session_id: session.sessionId,
          page_id: page.pageId,
          action_id: action.action_id,
          url: result.url,
          title: result.title,
          meta: {
            mode: input.mode,
            selector: input.selector,
            format: input.format,
            quality: input.quality
          }
        });
        const data = {
          screenshot_id: artifact.artifact_id,
          mode: input.mode,
          width: result.width,
          height: result.height,
          bytes: artifact.bytes,
          mime_type: result.mimeType,
          storage_path: artifact.storage_path,
          follow_up_by_goal: buildFollowUpByGoal({
            pageStateKnown: true,
            targetSelectorKnown: Boolean(input.selector),
            needsFullPageContext: input.mode === "full",
            recentFailure: input.mode === "viewport" ? "layout_uncertain" : "none"
          })
        };
        await services.history.finishAction(action, "succeeded", { screenshot_id: artifact.artifact_id });
        return createToolSuccess({ ok: true, code: "OK", action_id: action.action_id, session_id: session.sessionId, page_id: page.pageId, artifact_ids: [artifact.artifact_id], data });
      } catch (error) {
        return createFailureResult(error);
      }
    }
  );
}
