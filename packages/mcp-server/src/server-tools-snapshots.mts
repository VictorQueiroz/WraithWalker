import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  buildScenarioSnapshotSourceTrace,
  diffScenarios,
  listScenarioSnapshots,
  readScenarioSnapshot,
  renderDiffMarkdown,
  saveScenario
} from "@wraithwalker/core/scenarios";
import { renderJson } from "./server-responses.mjs";
import type { createServerRootRuntime } from "./root-runtime.mjs";

export function registerSnapshotTools(
  server: McpServer,
  rootPath: string,
  {
    runtime
  }: {
    runtime: ReturnType<typeof createServerRootRuntime>;
  }
): void {
  server.tool(
    "list-snapshots",
    "List all saved fixture scenarios",
    {},
    async () => {
      const snapshots = await listScenarioSnapshots(rootPath);
      return renderJson({
        scenarios: snapshots.map((snapshot) => snapshot.name),
        snapshots
      });
    }
  );

  server.tool(
    "save-trace-as-snapshot",
    "Save the current fixture workspace as a named scenario snapshot and attach trace provenance",
    {
      traceId: z
        .string()
        .describe("Trace ID returned by start-trace or list-traces"),
      name: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Optional snapshot name. Defaults to the trace ID when omitted."
        ),
      description: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Optional human-facing description stored in the snapshot metadata"
        )
    },
    async ({ traceId, name, description }) => {
      const trace = await runtime.readTrace(traceId);
      if (!trace) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Trace "${traceId}" not found.`
            }
          ],
          isError: true
        };
      }

      const sentinel = await runtime.ensureReady();
      const snapshotName = name?.trim() || trace.traceId;
      const snapshotDescription =
        description?.trim() ||
        trace.goal ||
        (trace.name ? `Saved from trace "${trace.name}".` : undefined);

      const saved = await saveScenario({
        path: rootPath,
        expectedRootId: sentinel.rootId,
        name: snapshotName,
        ...(snapshotDescription ? { description: snapshotDescription } : {}),
        sourceTrace: buildScenarioSnapshotSourceTrace(trace)
      });

      return renderJson({
        ok: true,
        name: saved.name,
        snapshot: await readScenarioSnapshot(rootPath, saved.name)
      });
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
          ? (await listScenarioSnapshots(rootPath)).map(
              (snapshot) => snapshot.name
            )
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
