import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { diffScenarios, renderDiffMarkdown } from "./fixture-diff.mjs";
import {
  listAssets,
  listApiEndpoints,
  listScenarios,
  matchSiteConfigsByOrigin,
  readApiFixture,
  readFixtureBody,
  readFixtureSnippet,
  searchFixtureContent,
  flattenStaticResourceManifest,
  readOriginInfo,
  readSiteConfigs,
  resolveFixturePath
} from "./fixture-reader.mjs";

const SERVER_NAME = "wraithwalker";
const SERVER_VERSION = "0.1.0";

export const HTTP_MCP_PATH = "/mcp";
export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 4319;

export const MCP_TOOL_NAMES = [
  "list-origins",
  "list-assets",
  "list-endpoints",
  "search-content",
  "read-endpoint-fixture",
  "read-fixture",
  "read-fixture-snippet",
  "read-manifest",
  "list-scenarios",
  "diff-scenarios"
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

function registerTools(server: McpServer, rootPath: string): void {
  async function resolveSiteConfig(origin: string) {
    const configs = await readSiteConfigs(rootPath);
    return {
      configs,
      config: configs.find((candidate) => candidate.origin === origin)
    };
  }

  async function resolveDiscoverySiteConfigs(origin: string) {
    const configs = await readSiteConfigs(rootPath);
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
    "list-origins",
    "List all captured origins and their fixture summary",
    {
      search: z.string().trim().min(1).optional().describe("Optional case-insensitive origin substring filter")
    },
    async ({ search }) => {
      const configs = await readSiteConfigs(rootPath);
      const normalizedSearch = search?.toLowerCase();
      const origins = [];

      for (const config of configs) {
        if (normalizedSearch && !config.origin.toLowerCase().includes(normalizedSearch)) {
          continue;
        }

        const info = await readOriginInfo(rootPath, config);
        origins.push({
          origin: info.origin,
          mode: info.mode,
          manifestPath: info.manifestPath,
          apiEndpoints: info.apiEndpoints.length,
          staticAssets: flattenStaticResourceManifest(info.manifest).length
        });
      }

      return renderJson(origins);
    }
  );

  server.tool(
    "list-assets",
    "List captured static assets for an origin with optional filters, pagination, and body availability",
    {
      origin: z.string().describe("The origin to list assets for (e.g., https://app.example.com)"),
      resourceTypes: optionalStringArraySchema.describe("Optional static resource types to include"),
      mimeTypes: optionalStringArraySchema.describe("Optional MIME types to include"),
      pathnameContains: z.string().optional().describe("Optional case-insensitive pathname substring filter"),
      requestOrigin: z.string().optional().describe("Optional exact request origin filter"),
      limit: z.number().int().positive().max(200).optional().describe("Maximum number of assets to return"),
      cursor: z.string().optional().describe("Opaque pagination cursor returned by a previous list-assets call")
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
    "list-endpoints",
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
    "search-content",
    "Search live fixture content across assets, endpoint bodies, and text-like files, with path fallback when body text is unavailable or misses",
    {
      query: z.string().trim().min(1).describe("Case-insensitive substring query to search for"),
      origin: z.string().optional().describe("Optional origin filter"),
      pathContains: z.string().optional().describe("Optional case-insensitive relative path substring filter"),
      mimeTypes: optionalStringArraySchema.describe("Optional MIME types to include"),
      resourceTypes: optionalStringArraySchema.describe("Optional resource types to include"),
      limit: z.number().int().positive().max(100).optional().describe("Maximum number of matches to return"),
      cursor: z.string().optional().describe("Opaque pagination cursor returned by a previous search-content call")
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
    "read-fixture",
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
    "read-fixture-snippet",
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
    "read-endpoint-fixture",
    "Read the response metadata and body for an API fixture returned by list-endpoints",
    {
      fixtureDir: z.string().describe("Fixture directory returned by list-endpoints"),
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
    "read-manifest",
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
    "list-scenarios",
    "List all saved fixture scenarios",
    {},
    async () => {
      const scenarios = await listScenarios(rootPath);
      return renderJson({ scenarios });
    }
  );

  server.tool(
    "diff-scenarios",
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

function createConnectedServer(rootPath: string): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });
  registerTools(server, rootPath);
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
  const server = createConnectedServer(rootPath);
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
  const app = createMcpExpressApp({ host });
  const sessions = new Map<string, HttpSession>();

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

        const server = createConnectedServer(rootPath);
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
  const url = `http://${formatUrlHost(host)}:${actualAddress.port}${HTTP_MCP_PATH}`;

  return {
    rootPath,
    host,
    port: actualAddress.port,
    url,
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
