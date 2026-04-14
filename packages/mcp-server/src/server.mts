import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";

import * as trpcExpress from "@trpc/server/adapters/express";
import express from "express";
import { normalizeSiteInput } from "@wraithwalker/core/fixture-layout";
import { createRoot } from "@wraithwalker/core/root";
import {
  createConfiguredSiteConfig,
  isValidDumpAllowlistPattern,
  normalizeDumpAllowlistPatterns,
  normalizeSiteConfigs,
  type SiteConfig
} from "@wraithwalker/core/site-config";
import {
  summarizeScenarioTrace,
  summarizeScenarioTraceForRead
} from "@wraithwalker/core/scenario-traces";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  buildTraceStatusView,
  createExtensionSessionTracker
} from "./extension-session.mjs";

import { diffScenarios, renderDiffMarkdown } from "./fixture-diff.mjs";
import {
  listAssets,
  listApiEndpoints,
  listScenarios,
  matchSiteConfigsByOrigin,
  patchProjectionFile,
  readApiFixture,
  readFixtureBody,
  readFixtureSnippet,
  searchFixtureContent,
  flattenStaticResourceManifest,
  readOriginInfo,
  resolveFixturePath,
  restoreProjectionFile,
  writeProjectionFile
} from "./fixture-reader.mjs";
import { appendVaryHeader, buildLocalServerCorsHeaders } from "./local-server-cors.mjs";
import { createServerRootRuntime } from "./root-runtime.mjs";
import { createWraithwalkerRouter, HTTP_TRPC_PATH } from "./trpc.mjs";

const SERVER_NAME = "wraithwalker";
const SERVER_VERSION = "0.6.1";

export const HTTP_MCP_PATH = "/mcp";
export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 4319;
export const DEFAULT_HTTP_TRPC_MAX_BODY_SIZE_BYTES = 25 * 1024 * 1024;

export const MCP_TOOL_NAMES = [
  "browser-status",
  "read-console",
  "trace-status",
  "start-trace",
  "stop-trace",
  "list-traces",
  "read-trace",
  "list-configured-sites",
  "whitelist-site",
  "remove-site",
  "update-site-patterns",
  "prepare-site-for-capture",
  "list-sites",
  "list-files",
  "list-api-routes",
  "search-files",
  "read-api-response",
  "read-file",
  "read-file-snippet",
  "read-site-manifest",
  "write-file",
  "patch-file",
  "restore-file",
  "list-snapshots",
  "diff-snapshots"
] as const;

export interface StartServerOptions {
  transport?: Transport;
}

export interface StartHttpServerOptions {
  host?: string;
  port?: number;
}

export interface HttpServerHandle {
  rootPath: string;
  host: string;
  port: number;
  baseUrl: string;
  trpcUrl: string;
  url: string;
  tools: readonly string[];
  close(): Promise<void>;
}

interface HttpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

const optionalStringArraySchema = z.array(z.string()).optional();

function renderJson(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
  };
}

function renderErrorMessage(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    isError: true
  };
}

function sortSiteConfigs(siteConfigs: SiteConfig[]): SiteConfig[] {
  return [...siteConfigs].sort((left, right) => left.origin.localeCompare(right.origin));
}

function replaceSiteConfig(siteConfigs: SiteConfig[], nextSiteConfig: SiteConfig): SiteConfig[] {
  return normalizeSiteConfigs([
    ...siteConfigs.filter((siteConfig) => siteConfig.origin !== nextSiteConfig.origin),
    nextSiteConfig
  ]);
}

function renderInvalidPatternError(pattern: string) {
  return renderErrorMessage(`Invalid dump allowlist pattern: ${pattern}`);
}

function getPrepareGuidance({
  connected,
  sessionActive,
  originReady
}: {
  connected: boolean;
  sessionActive: boolean;
  originReady: boolean;
}): string {
  if (originReady) {
    return "Capture is ready for this origin.";
  }

  if (!connected) {
    return "The site is configured in the current root, but no browser extension is connected to this local server yet.";
  }

  if (!sessionActive) {
    return "The site is configured, but the browser session is inactive. Start the session in the extension, then poll browser-status or prepare-site-for-capture again.";
  }

  return "The site is configured, but the extension has not reported this origin as ready yet. Wait for the next heartbeat, then poll browser-status again.";
}

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

function createHostHeaderValidationMiddleware(
  allowedHostnames: readonly string[]
): express.RequestHandler {
  return (req, res, next) => {
    const hostHeader = req.headers.host;
    if (!hostHeader) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Missing Host header"
        },
        id: null
      });
      return;
    }

    let hostname: string;
    try {
      hostname = new URL(`http://${hostHeader}`).hostname;
    } catch {
      res.status(403).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: `Invalid Host header: ${hostHeader}`
        },
        id: null
      });
      return;
    }

    if (!allowedHostnames.includes(hostname)) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: `Invalid Host: ${hostname}`
        },
        id: null
      });
      return;
    }

    next();
  };
}

function createLoopbackHttpApp() {
  const app = express();
  app.use(createHostHeaderValidationMiddleware(["localhost", "127.0.0.1", "[::1]"]));
  return app;
}

function registerTools(
  server: McpServer,
  rootPath: string,
  {
    runtime,
    extensionSessions
  }: {
    runtime: ReturnType<typeof createServerRootRuntime>;
    extensionSessions: ReturnType<typeof createExtensionSessionTracker>;
  }
): void {
  async function resolveSiteConfig(origin: string) {
    const configs = await runtime.readEffectiveSiteConfigs();
    return {
      configs,
      config: configs.find((candidate) => candidate.origin === origin)
    };
  }

  async function resolveDiscoverySiteConfigs(origin: string) {
    const configs = await runtime.readEffectiveSiteConfigs();
    return {
      configs,
      matchedConfigs: matchSiteConfigsByOrigin(configs, origin)
    };
  }

  function renderOriginNotFound(origin: string, availableOrigins: string[]) {
    const available = availableOrigins.join(", ");
    return {
      content: [{
        type: "text" as const,
        text: `Origin "${origin}" not found.${available ? ` Available: ${available}` : ""}`
      }],
      isError: true
    };
  }

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
        return {
          content: [{
            type: "text" as const,
            text: "No connected extension is available for guided tracing."
          }],
          isError: true
        };
      }

      const activeTrace = await runtime.getActiveTrace();
      if (activeTrace) {
        return {
          content: [{
            type: "text" as const,
            text: `Trace "${activeTrace.traceId}" is already active. Stop it before starting another trace.`
          }],
          isError: true
        };
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
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true
        };
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
        return {
          content: [{ type: "text" as const, text: `Trace "${traceId}" not found.` }],
          isError: true
        };
      }

      return renderJson({
        trace,
        summary: summarizeScenarioTraceForRead(trace)
      });
    }
  );

  server.tool(
    "list-configured-sites",
    "List the explicit site config entries stored in the current WraithWalker root",
    {
      search: z.string().trim().min(1).optional().describe("Optional case-insensitive origin substring filter")
    },
    async ({ search }) => {
      const normalizedSearch = search?.toLowerCase();
      const siteConfigs = await runtime.readConfiguredSiteConfigs();

      return renderJson(
        siteConfigs.filter((siteConfig) => (
          !normalizedSearch
          || siteConfig.origin.toLowerCase().includes(normalizedSearch)
        ))
      );
    }
  );

  server.tool(
    "whitelist-site",
    "Ensure an origin is explicitly configured in the current root using the agent-friendly default capture patterns",
    {
      origin: z.string().describe("Origin to whitelist (for example https://app.example.com)")
    },
    async ({ origin }) => {
      let normalizedOrigin: string;
      try {
        normalizedOrigin = normalizeSiteInput(origin);
      } catch (error) {
        return renderErrorMessage(error instanceof Error ? error.message : String(error));
      }

      const siteConfigs = await runtime.readConfiguredSiteConfigs();
      const existing = siteConfigs.find((siteConfig) => siteConfig.origin === normalizedOrigin);
      if (existing) {
        return renderJson({
          changed: false,
          siteConfig: existing,
          configuredSites: sortSiteConfigs(siteConfigs)
        });
      }

      const nextSiteConfig = createConfiguredSiteConfig(normalizedOrigin);
      const nextSiteConfigs = replaceSiteConfig(siteConfigs, nextSiteConfig);
      await runtime.writeConfiguredSiteConfigs(nextSiteConfigs);

      return renderJson({
        changed: true,
        siteConfig: nextSiteConfig,
        configuredSites: nextSiteConfigs
      });
    }
  );

  server.tool(
    "remove-site",
    "Remove an explicit site config entry from the current WraithWalker root",
    {
      origin: z.string().describe("Origin to remove from the configured site list")
    },
    async ({ origin }) => {
      let normalizedOrigin: string;
      try {
        normalizedOrigin = normalizeSiteInput(origin);
      } catch (error) {
        return renderErrorMessage(error instanceof Error ? error.message : String(error));
      }

      const siteConfigs = await runtime.readConfiguredSiteConfigs();
      const existing = siteConfigs.find((siteConfig) => siteConfig.origin === normalizedOrigin);
      if (!existing) {
        return renderJson({
          changed: false,
          removedOrigin: normalizedOrigin,
          configuredSites: sortSiteConfigs(siteConfigs)
        });
      }

      const nextSiteConfigs = siteConfigs.filter((siteConfig) => siteConfig.origin !== normalizedOrigin);
      await runtime.writeConfiguredSiteConfigs(nextSiteConfigs);

      return renderJson({
        changed: true,
        removedOrigin: normalizedOrigin,
        configuredSites: nextSiteConfigs
      });
    }
  );

  server.tool(
    "update-site-patterns",
    "Replace, append, or reset dump allowlist patterns for an explicitly configured origin",
    {
      origin: z.string().describe("Configured origin to update"),
      mode: z.enum(["replace", "append", "reset"]).optional().describe("How to apply dumpPatterns; defaults to replace"),
      dumpPatterns: z.array(z.string()).optional().describe("Regex patterns used when mode is replace or append")
    },
    async ({ origin, mode = "replace", dumpPatterns }) => {
      let normalizedOrigin: string;
      try {
        normalizedOrigin = normalizeSiteInput(origin);
      } catch (error) {
        return renderErrorMessage(error instanceof Error ? error.message : String(error));
      }

      const siteConfigs = await runtime.readConfiguredSiteConfigs();
      const existing = siteConfigs.find((siteConfig) => siteConfig.origin === normalizedOrigin);
      if (!existing) {
        return renderErrorMessage(`Origin "${normalizedOrigin}" is not explicitly configured. Call whitelist-site first.`);
      }

      if (mode !== "reset" && (!dumpPatterns || dumpPatterns.length === 0)) {
        return renderErrorMessage("dumpPatterns is required when mode is replace or append.");
      }

      if (dumpPatterns) {
        for (const pattern of dumpPatterns) {
          if (typeof pattern !== "string" || !pattern.trim() || !isValidDumpAllowlistPattern(pattern)) {
            return renderInvalidPatternError(String(pattern));
          }
        }
      }

      const nextPatterns = mode === "reset"
        ? createConfiguredSiteConfig(normalizedOrigin).dumpAllowlistPatterns
        : mode === "append"
          ? [...new Set([
              ...existing.dumpAllowlistPatterns,
              ...(dumpPatterns ?? [])
            ])]
          : normalizeDumpAllowlistPatterns(dumpPatterns ?? []);

      const nextSiteConfig: SiteConfig = {
        ...existing,
        dumpAllowlistPatterns: nextPatterns
      };
      const nextSiteConfigs = replaceSiteConfig(siteConfigs, nextSiteConfig);
      await runtime.writeConfiguredSiteConfigs(nextSiteConfigs);

      return renderJson({
        changed: JSON.stringify(existing.dumpAllowlistPatterns) !== JSON.stringify(nextPatterns),
        siteConfig: nextSiteConfig,
        configuredSites: nextSiteConfigs
      });
    }
  );

  server.tool(
    "prepare-site-for-capture",
    "Ensure an origin is configured in the current root and report whether the connected extension is ready to capture it",
    {
      origin: z.string().describe("Origin to prepare for capture")
    },
    async ({ origin }) => {
      let normalizedOrigin: string;
      try {
        normalizedOrigin = normalizeSiteInput(origin);
      } catch (error) {
        return renderErrorMessage(error instanceof Error ? error.message : String(error));
      }

      const configuredSiteConfigs = await runtime.readConfiguredSiteConfigs();
      const existing = configuredSiteConfigs.find((siteConfig) => siteConfig.origin === normalizedOrigin);
      const nextConfiguredSite = existing ?? createConfiguredSiteConfig(normalizedOrigin);
      const changed = !existing;

      if (changed) {
        await runtime.writeConfiguredSiteConfigs(replaceSiteConfig(configuredSiteConfigs, nextConfiguredSite));
      }

      const status = await extensionSessions.getStatus();
      const originReady = status.connected
        && status.sessionActive
        && status.enabledOrigins.includes(normalizedOrigin);

      return renderJson({
        changed,
        origin: normalizedOrigin,
        siteConfig: nextConfiguredSite,
        connected: status.connected,
        sessionActive: status.sessionActive,
        captureReady: originReady,
        enabledOrigins: status.enabledOrigins,
        nextAction: originReady
          ? "ready"
          : !status.connected
            ? "connect_extension"
            : !status.sessionActive
              ? "start_extension_session"
              : "wait_for_extension_refresh",
        guidance: getPrepareGuidance({
          connected: status.connected,
          sessionActive: status.sessionActive,
          originReady
        })
      });
    }
  );

  server.tool(
    "list-sites",
    "List all captured origins and their fixture summary",
    {
      search: z.string().trim().min(1).optional().describe("Optional case-insensitive origin substring filter")
    },
    async ({ search }) => {
      const configs = await runtime.readEffectiveSiteConfigs();
      const normalizedSearch = search?.toLowerCase();
      const origins = [];

      for (const config of configs) {
        if (normalizedSearch && !config.origin.toLowerCase().includes(normalizedSearch)) {
          continue;
        }

        const info = await readOriginInfo(rootPath, config);
        origins.push({
          origin: info.origin,
          manifestPath: info.manifestPath,
          apiEndpoints: info.apiEndpoints.length,
          staticAssets: flattenStaticResourceManifest(info.manifest).length
        });
      }

      return renderJson(origins);
    }
  );

  server.tool(
    "list-files",
    "List captured static assets for an origin with optional filters, pagination, and body availability",
    {
      origin: z.string().describe("The origin to list assets for (e.g., https://app.example.com)"),
      resourceTypes: optionalStringArraySchema.describe("Optional static resource types to include"),
      mimeTypes: optionalStringArraySchema.describe("Optional MIME types to include"),
      pathnameContains: z.string().optional().describe("Optional case-insensitive pathname substring filter"),
      requestOrigin: z.string().optional().describe("Optional exact request origin filter"),
      limit: z.number().int().positive().max(200).optional().describe("Maximum number of assets to return"),
      cursor: z.string().optional().describe("Opaque pagination cursor returned by a previous list-files call")
    },
    async ({ origin, resourceTypes, mimeTypes, pathnameContains, requestOrigin, limit, cursor }) => {
      const { configs, matchedConfigs } = await resolveDiscoverySiteConfigs(origin);
      if (matchedConfigs.length === 0) {
        return renderOriginNotFound(origin, configs.map((candidate) => candidate.origin));
      }

      try {
        const assets = await listAssets(rootPath, matchedConfigs, {
          resourceTypes,
          mimeTypes,
          pathnameContains,
          requestOrigin,
          limit,
          cursor
        });

        return renderJson(assets);
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "list-api-routes",
    "List all captured API endpoints for an origin",
    { origin: z.string().describe("The origin to list endpoints for (e.g., https://app.example.com)") },
    async ({ origin }) => {
      const { configs, matchedConfigs } = await resolveDiscoverySiteConfigs(origin);
      if (matchedConfigs.length === 0) {
        return renderOriginNotFound(origin, configs.map((candidate) => candidate.origin));
      }

      const endpoints = await listApiEndpoints(rootPath, matchedConfigs);
      return renderJson(endpoints);
    }
  );

  server.tool(
    "search-files",
    "Search live fixture content across assets, endpoint bodies, and text-like files, with path fallback when body text is unavailable or misses",
    {
      query: z.string().trim().min(1).describe("Case-insensitive substring query to search for"),
      origin: z.string().optional().describe("Optional origin filter"),
      pathContains: z.string().optional().describe("Optional case-insensitive relative path substring filter"),
      mimeTypes: optionalStringArraySchema.describe("Optional MIME types to include"),
      resourceTypes: optionalStringArraySchema.describe("Optional resource types to include"),
      limit: z.number().int().positive().max(100).optional().describe("Maximum number of matches to return"),
      cursor: z.string().optional().describe("Opaque pagination cursor returned by a previous search-files call")
    },
    async ({ query, origin, pathContains, mimeTypes, resourceTypes, limit, cursor }) => {
      if (origin) {
        const { configs, matchedConfigs } = await resolveDiscoverySiteConfigs(origin);
        if (matchedConfigs.length === 0) {
          return renderOriginNotFound(origin, configs.map((candidate) => candidate.origin));
        }
      }

      try {
        const results = await searchFixtureContent(rootPath, {
          query,
          origin,
          pathContains,
          mimeTypes,
          resourceTypes,
          limit,
          cursor
        });

        return renderJson(results);
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "read-file",
    "Read a fixture response body by its file path relative to the fixture root",
    {
      path: z.string().describe("Relative path to the fixture file (e.g., cdn.example.com/assets/app.js)"),
      pretty: z.boolean().optional().describe("Format supported text-like fixtures for easier reading without changing stored bytes")
    },
    async ({ path: filePath, pretty }) => {
      if (!resolveFixturePath(rootPath, filePath)) {
        return {
          content: [{ type: "text" as const, text: `Invalid fixture path: ${filePath}. Paths must stay within the fixture root.` }],
          isError: true
        };
      }

      let content: string | null;
      try {
        content = await readFixtureBody(rootPath, filePath, { pretty });
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true
        };
      }
      if (content === null) {
        return {
          content: [{ type: "text" as const, text: `File not found: ${filePath}` }],
          isError: true
        };
      }

      return {
        content: [{ type: "text" as const, text: content }]
      };
    }
  );

  server.tool(
    "read-file-snippet",
    "Read a bounded text snippet from a fixture file relative to the fixture root",
    {
      path: z.string().describe("Relative path to the text fixture file"),
      pretty: z.boolean().optional().describe("Format supported text-like fixtures before slicing lines for easier inspection"),
      startLine: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional().describe("1-based line number to start reading from"),
      lineCount: z.number().int().positive().max(400).optional().describe("Maximum number of lines to return"),
      maxBytes: z.number().int().positive().max(64000).optional().describe("Maximum UTF-8 bytes to return")
    },
    async ({ path: filePath, pretty, startLine, lineCount, maxBytes }) => {
      try {
        const snippet = await readFixtureSnippet(rootPath, filePath, {
          pretty,
          startLine,
          lineCount,
          maxBytes
        });
        return renderJson(snippet);
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "read-api-response",
    "Read the response metadata and body for an API fixture returned by list-api-routes",
    {
      fixtureDir: z.string().describe("Fixture directory returned by list-api-routes"),
      pretty: z.boolean().optional().describe("Format supported text-like response bodies for easier reading without changing stored bytes")
    },
    async ({ fixtureDir, pretty }) => {
      if (!resolveFixturePath(rootPath, path.join(fixtureDir, "response.meta.json"))) {
        return {
          content: [{ type: "text" as const, text: `Invalid fixture directory: ${fixtureDir}. Paths must stay within the fixture root.` }],
          isError: true
        };
      }

      let fixture;
      try {
        fixture = await readApiFixture(rootPath, fixtureDir, { pretty });
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true
        };
      }
      if (!fixture) {
        return {
          content: [{ type: "text" as const, text: `Endpoint fixture not found: ${fixtureDir}` }],
          isError: true
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(fixture, null, 2) }]
      };
    }
  );

  server.tool(
    "read-site-manifest",
    "Read the RESOURCE_MANIFEST.json for an origin",
    { origin: z.string().describe("The origin to read the manifest for") },
    async ({ origin }) => {
      const { configs, config } = await resolveSiteConfig(origin);
      if (!config) {
        return renderOriginNotFound(origin, configs.map((candidate) => candidate.origin));
      }

      const info = await readOriginInfo(rootPath, config);
      if (!info.manifest) {
        return {
          content: [{ type: "text" as const, text: `No manifest found for "${origin}".` }],
          isError: true
        };
      }

      return renderJson(info.manifest);
    }
  );

  server.tool(
    "write-file",
    "Overwrite a human-facing captured projection file with UTF-8 text",
    {
      path: z.string().describe("Visible projection path returned by list-files or search-files"),
      content: z.string().describe("Replacement UTF-8 text to write into the projection")
    },
    async ({ path: filePath, content }) => {
      try {
        return renderJson(await writeProjectionFile(rootPath, filePath, content));
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "patch-file",
    "Patch a human-facing captured projection file by line range, with conflict detection",
    {
      path: z.string().describe("Visible projection path returned by list-files or search-files"),
      startLine: z.number().int().positive().describe("1-based line number where the replacement starts"),
      endLine: z.number().int().positive().describe("1-based line number where the replacement ends"),
      expectedText: z.string().describe("Current text expected in the selected line range"),
      replacement: z.string().describe("Replacement text for the selected line range")
    },
    async ({ path: filePath, startLine, endLine, expectedText, replacement }) => {
      try {
        return renderJson(await patchProjectionFile(rootPath, {
          path: filePath,
          startLine,
          endLine,
          expectedText,
          replacement
        }));
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "restore-file",
    "Restore a human-facing captured projection file from its canonical hidden snapshot",
    {
      path: z.string().describe("Visible projection path returned by list-files or search-files")
    },
    async ({ path: filePath }) => {
      try {
        return renderJson(await restoreProjectionFile(rootPath, filePath));
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true
        };
      }
    }
  );

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
          content: [{ type: "text" as const, text: `Error: ${message}${availableSuffix}` }],
          isError: true
        };
      }
    }
  );
}

function createConnectedServer(
  rootPath: string,
  {
    runtime,
    extensionSessions
  }: {
    runtime: ReturnType<typeof createServerRootRuntime>;
    extensionSessions: ReturnType<typeof createExtensionSessionTracker>;
  }
): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });
  registerTools(server, rootPath, { runtime, extensionSessions });
  return server;
}

function createJsonRpcError(code: number, message: string) {
  return {
    jsonrpc: "2.0" as const,
    error: { code, message },
    id: null
  };
}

function getSessionId(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) {
    return header[0];
  }

  return header;
}

function formatUrlHost(host: string): string {
  const normalized = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;

  return normalized.includes(":")
    ? `[${normalized}]`
    : normalized;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;

  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

async function closeHttpSession(session: HttpSession): Promise<void> {
  await Promise.allSettled([
    session.transport.close(),
    session.server.close()
  ]);
}

export async function startServer(
  rootPath: string,
  options: StartServerOptions = {}
): Promise<McpServer> {
  const sentinel = await createRoot(rootPath);
  const runtime = createServerRootRuntime({ rootPath, sentinel });
  const extensionSessions = createExtensionSessionTracker({
    getActiveTrace: () => runtime.getActiveTrace(),
    getEffectiveSiteConfigs: () => runtime.readEffectiveSiteConfigs()
  });
  const server = createConnectedServer(rootPath, { runtime, extensionSessions });
  const transport = options.transport ?? new StdioServerTransport();
  await server.connect(transport);
  return server;
}

export async function startHttpServer(
  rootPath: string,
  options: StartHttpServerOptions = {}
): Promise<HttpServerHandle> {
  const host = options.host ?? DEFAULT_HTTP_HOST;
  const port = options.port ?? DEFAULT_HTTP_PORT;
  if (!isLoopbackHost(host)) {
    throw new Error(`Refusing to start WraithWalker HTTP server on non-loopback host "${host}". Use 127.0.0.1, localhost, or ::1.`);
  }

  const sentinel = await createRoot(rootPath);
  const app = createLoopbackHttpApp();
  const sessions = new Map<string, HttpSession>();
  const urls = {
    baseUrl: "",
    mcpUrl: "",
    trpcUrl: ""
  };
  const runtime = createServerRootRuntime({ rootPath, sentinel });
  const extensionSessions = createExtensionSessionTracker({
    getActiveTrace: () => runtime.getActiveTrace(),
    getEffectiveSiteConfigs: () => runtime.readEffectiveSiteConfigs()
  });

  const trpcRouter = createWraithwalkerRouter({
    rootPath,
    sentinel,
    serverName: SERVER_NAME,
    serverVersion: SERVER_VERSION,
    runtime,
    extensionSessions,
    getSiteConfigs: () => runtime.readEffectiveSiteConfigs(),
    getServerUrls: () => ({
      baseUrl: urls.baseUrl,
      mcpUrl: urls.mcpUrl,
      trpcUrl: urls.trpcUrl
    })
  });

  app.use(HTTP_TRPC_PATH, (req, res, next) => {
    const origin = typeof req.headers.origin === "string"
      ? req.headers.origin
      : undefined;
    const requestedHeaders = typeof req.headers["access-control-request-headers"] === "string"
      ? req.headers["access-control-request-headers"]
      : undefined;
    const requestedPrivateNetwork = typeof req.headers["access-control-request-private-network"] === "string"
      ? req.headers["access-control-request-private-network"]
      : undefined;
    const corsHeaders = buildLocalServerCorsHeaders({
      origin,
      requestedHeaders,
      requestedPrivateNetwork
    });

    if (corsHeaders) {
      for (const [name, value] of Object.entries(corsHeaders)) {
        if (name.toLowerCase() === "vary") {
          res.setHeader("Vary", appendVaryHeader(res.getHeader("Vary"), value));
          continue;
        }

        res.setHeader(name, value);
      }
    }

    if (req.method === "OPTIONS") {
      res.status(corsHeaders ? 204 : 403).end();
      return;
    }

    next();
  });

  app.use(HTTP_TRPC_PATH, trpcExpress.createExpressMiddleware({
    router: trpcRouter,
    createContext: () => ({}),
    allowMethodOverride: true,
    maxBodySize: DEFAULT_HTTP_TRPC_MAX_BODY_SIZE_BYTES
  }));

  app.use(HTTP_MCP_PATH, express.json());

  app.all(HTTP_MCP_PATH, async (req, res) => {
    const sessionId = getSessionId(req.headers["mcp-session-id"]);
    let session = sessionId
      ? sessions.get(sessionId)
      : undefined;
    let createdSession = false;

    try {
      if (!session) {
        if (sessionId) {
          res.status(404).json(createJsonRpcError(-32000, `Session "${sessionId}" not found.`));
          return;
        }

        if (req.method !== "POST" || !isInitializeRequest(req.body)) {
          res.status(400).json(createJsonRpcError(-32000, "Bad Request: No valid session ID provided."));
          return;
        }

        const server = createConnectedServer(rootPath, { runtime, extensionSessions });
        let initializedSessionId: string | undefined;
        let transport: StreamableHTTPServerTransport;

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized(nextSessionId) {
            initializedSessionId = nextSessionId;
            sessions.set(nextSessionId, { server, transport });
          }
        });

        transport.onclose = () => {
          if (initializedSessionId) {
            sessions.delete(initializedSessionId);
          }
        };

        await server.connect(transport);
        session = { server, transport };
        createdSession = true;
      }

      await session.transport.handleRequest(req, res, req.body);

      if (req.method === "DELETE") {
        await session.server.close();
      }
    } catch (error) {
      if (createdSession && session) {
        await closeHttpSession(session);
      }

      if (!res.headersSent) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json(createJsonRpcError(-32603, `Internal server error: ${message}`));
      }
    }
  });

  const listener = await new Promise<HttpServer>((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.once("error", reject);
  });

  const address = listener.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve the HTTP listener address.");
  }

  const actualAddress = address as AddressInfo;
  urls.baseUrl = `http://${formatUrlHost(host)}:${actualAddress.port}`;
  urls.mcpUrl = `${urls.baseUrl}${HTTP_MCP_PATH}`;
  urls.trpcUrl = `${urls.baseUrl}${HTTP_TRPC_PATH}`;

  return {
    rootPath,
    host,
    port: actualAddress.port,
    baseUrl: urls.baseUrl,
    trpcUrl: urls.trpcUrl,
    url: urls.mcpUrl,
    tools: MCP_TOOL_NAMES,
    async close() {
      const activeSessions = Array.from(sessions.values());
      sessions.clear();

      await Promise.allSettled(activeSessions.map((session) => closeHttpSession(session)));
      await new Promise<void>((resolve, reject) => {
        listener.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}
