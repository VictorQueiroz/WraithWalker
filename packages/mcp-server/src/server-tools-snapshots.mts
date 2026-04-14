import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { diffScenarios, renderDiffMarkdown } from "./fixture-diff.mjs";
import { listScenarios } from "./fixture-reader.mjs";
import { renderJson } from "./server-responses.mjs";

export function registerSnapshotTools(
  server: McpServer,
  rootPath: string
): void {
  server.tool(
    "list-snapshots",
    "List all saved fixture scenarios",
    {},
    async () => {
      const scenarios = await listScenarios(rootPath);
      return renderJson({ scenarios });
    }
  );

  server.tool(
    "diff-snapshots",
    "Compare two scenario snapshots and report differences in API endpoints",
    {
      scenarioA: z.string().describe("Name of the first scenario"),
      scenarioB: z.string().describe("Name of the second scenario")
    },
    async ({ scenarioA, scenarioB }) => {
      try {
        const diff = await diffScenarios(rootPath, scenarioA, scenarioB);
        return {
          content: [{ type: "text" as const, text: renderDiffMarkdown(diff) }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const scenarios = message.includes("does not exist.")
          ? await listScenarios(rootPath)
          : null;
        const availableSuffix = scenarios
          ? scenarios.length > 0
            ? ` Available scenarios: ${scenarios.join(", ")}`
            : " No saved scenarios are available."
          : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${message}${availableSuffix}`
            }
          ],
          isError: true
        };
      }
    }
  );
}
