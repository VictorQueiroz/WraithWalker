import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { buildTraceStatusView, type createExtensionSessionTracker } from "./extension-session.mjs";
import { optionalStringArraySchema, renderJson } from "./server-responses.mjs";

function filterConsoleEntries(
  entries: ReadonlyArray<{
    tabId: number;
    source: string;
    level: string;
    text: string;
  }>,
  {
    tabId,
    search,
    sources,
    levels,
    limit
  }: {
    tabId?: number;
    search?: string;
    sources?: string[];
    levels?: string[];
    limit?: number;
  }
) {
  const normalizedSearch = search?.toLowerCase();
  const normalizedSources = sources?.length
    ? new Set(sources.map((value) => value.toLowerCase()))
    : null;
  const normalizedLevels = levels?.length
    ? new Set(levels.map((value) => value.toLowerCase()))
    : null;
  const filtered = entries.filter((entry) => {
    if (typeof tabId === "number" && entry.tabId !== tabId) {
      return false;
    }

    if (normalizedSearch && !entry.text.toLowerCase().includes(normalizedSearch)) {
      return false;
    }

    if (normalizedSources && !normalizedSources.has(entry.source.toLowerCase())) {
      return false;
    }

    if (normalizedLevels && !normalizedLevels.has(entry.level.toLowerCase())) {
      return false;
    }

    return true;
  });

  return filtered.slice(-(limit ?? 50));
}

export function registerBrowserTools(
  server: McpServer,
  {
    extensionSessions
  }: {
    extensionSessions: ReturnType<typeof createExtensionSessionTracker>;
  }
): void {
  server.tool(
    "browser-status",
    "Report whether the browser extension is connected to this local server and ready to capture",
    {},
    async () => renderJson(await extensionSessions.getStatus())
  );

  server.tool(
    "read-console",
    "Read recent browser console and log entries observed by the connected extension",
    {
      limit: z.number().int().positive().max(200).optional().describe("Maximum number of recent entries to return"),
      tabId: z.number().int().nonnegative().optional().describe("Optional exact tab ID filter"),
      search: z.string().trim().min(1).optional().describe("Optional case-insensitive substring filter on the entry text"),
      sources: optionalStringArraySchema.describe("Optional exact log sources to include"),
      levels: optionalStringArraySchema.describe("Optional exact log levels to include")
    },
    async ({ limit, tabId, search, sources, levels }) => {
      const status = await extensionSessions.getStatus();
      const entries = filterConsoleEntries(status.recentConsoleEntries, {
        limit,
        tabId,
        search,
        sources,
        levels
      });

      return renderJson({
        connected: status.connected,
        captureReady: status.captureReady,
        lastHeartbeatAt: status.lastHeartbeatAt,
        totalEntries: status.recentConsoleEntries.length,
        returnedEntries: entries.length,
        entries
      });
    }
  );

  server.tool(
    "trace-status",
    "Report guided trace readiness plus an agent-friendly summary of the active trace, if one exists",
    {},
    async () => renderJson(buildTraceStatusView(await extensionSessions.getStatus()))
  );
}
