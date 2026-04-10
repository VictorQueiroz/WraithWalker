import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  summarizeScenarioTrace,
  summarizeScenarioTraceForRead
} from "@wraithwalker/core/scenario-traces";

import { buildTraceStatusView, type createExtensionSessionTracker } from "./extension-session.mjs";
import type { createServerRootRuntime } from "./root-runtime.mjs";
import { renderJson, renderUnknownError, renderErrorMessage } from "./server-responses.mjs";

export function registerTraceTools(
  server: McpServer,
  {
    runtime,
    extensionSessions
  }: {
    runtime: ReturnType<typeof createServerRootRuntime>;
    extensionSessions: ReturnType<typeof createExtensionSessionTracker>;
  }
): void {
  server.tool(
    "start-trace",
    "Start a guided click-trace that the extension will record into the current WraithWalker root",
    {
      name: z.string().trim().min(1).optional().describe("Optional human-friendly name for the trace"),
      goal: z.string().trim().min(1).optional().describe("Optional agent-facing goal for what the trace should capture")
    },
    async ({ name, goal }) => {
      const status = await extensionSessions.getStatus();
      if (!status.connected) {
        return renderErrorMessage("No connected extension is available for guided tracing.");
      }

      const activeTrace = await runtime.getActiveTrace();
      if (activeTrace) {
        return renderErrorMessage(`Trace "${activeTrace.traceId}" is already active. Stop it before starting another trace.`);
      }

      const trace = await runtime.startTrace({
        traceId: crypto.randomUUID(),
        name,
        goal,
        selectedOrigins: status.enabledOrigins,
        extensionClientId: status.clientId
      });

      const nextStatus = await extensionSessions.getStatus();

      return renderJson({
        trace,
        summary: summarizeScenarioTrace(trace),
        guidance: buildTraceStatusView(nextStatus).guidance
      });
    }
  );

  server.tool(
    "stop-trace",
    "Stop a guided click-trace and keep it as a completed scenario trace on disk",
    {
      traceId: z.string().describe("Trace ID returned by start-trace")
    },
    async ({ traceId }) => {
      try {
        const trace = await runtime.stopTrace(traceId);
        return renderJson({
          trace,
          summary: summarizeScenarioTrace(trace)
        });
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.tool(
    "list-traces",
    "List guided scenario traces stored in the current WraithWalker root",
    {},
    async () => renderJson(await runtime.listTraces())
  );

  server.tool(
    "read-trace",
    "Read a stored guided scenario trace by ID",
    {
      traceId: z.string().describe("Trace ID returned by start-trace or list-traces")
    },
    async ({ traceId }) => {
      const trace = await runtime.readTrace(traceId);
      if (!trace) {
        return renderErrorMessage(`Trace "${traceId}" not found.`);
      }

      return renderJson({
        trace,
        summary: summarizeScenarioTraceForRead(trace)
      });
    }
  );
}
