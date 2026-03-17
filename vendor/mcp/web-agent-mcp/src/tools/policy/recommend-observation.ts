import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { recommendObservation } from "../../core/policy-engine.js";
import { toPolicyEnvelope } from "../../core/observation-flow.js";
import { createFailureResult } from "../../core/errors.js";
import { createToolSuccess } from "../../schemas/common.js";
import {
  recommendObservationInputSchema,
  recommendObservationOutputSchema
} from "../../schemas/policy.js";

export function registerRecommendObservationTool(server: McpServer) {
  server.registerTool(
    "policy.recommend_observation",
    {
      title: "Recommend Observation",
      description: "Recommend the cheapest next observation tool before an interaction or verification step.",
      inputSchema: recommendObservationInputSchema,
      outputSchema: recommendObservationOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input: z.infer<typeof recommendObservationInputSchema>) => {
      try {
        const result = recommendObservation(input);
        return createToolSuccess({
          ok: true,
          code: "OK",
          data: toPolicyEnvelope(result)
        });
      } catch (error) {
        return createFailureResult(error);
      }
    }
  );
}
