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
  listScenarios,
  readApiFixture,
  readFixtureBody,
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
  "list-endpoints",
  "read-endpoint-fixture",
  "read-fixture",
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

function registerTools(server: McpServer, rootPath: string): void {
  server.tool(
    "list-origins",
    "List all captured origins and their fixture summary",
    {},
    async () => {
      const configs = await readSiteConfigs(rootPath);
      const origins = [];

      for (const config of configs) {
        const info = await readOriginInfo(rootPath, config);
        origins.push({
          origin: info.origin,
          mode: info.mode,
          apiEndpoints: info.apiEndpoints.length,
          staticAssets: info.manifest
            ? Object.values(info.manifest.resourcesByPathname).flat().length
            : 0
        });
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(origins, null, 2) }]
      };
    }
  );

  server.tool(
    "list-endpoints",
    "List all captured API endpoints for an origin",
    { origin: z.string().describe("The origin to list endpoints for (e.g., https://app.example.com)") },
    async ({ origin }) => {
      const configs = await readSiteConfigs(rootPath);
      const config = configs.find((candidate) => candidate.origin === origin);
      if (!config) {
        return {
          content: [{ type: "text" as const, text: `Origin "${origin}" not found. Available: ${configs.map((candidate) => candidate.origin).join(", ")}` }],
          isError: true
        };
      }

      const info = await readOriginInfo(rootPath, config);
      const endpoints = info.apiEndpoints.map((endpoint) => ({
        method: endpoint.method,
        pathname: endpoint.pathname,
        status: endpoint.status,
        mimeType: endpoint.mimeType,
        fixtureDir: endpoint.fixtureDir
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(endpoints, null, 2) }]
      };
    }
  );

  server.tool(
    "read-fixture",
    "Read a fixture response body by its file path relative to the fixture root",
    { path: z.string().describe("Relative path to the fixture file (e.g., cdn.example.com/assets/app.js)") },
    async ({ path: filePath }) => {
      if (!resolveFixturePath(rootPath, filePath)) {
        return {
          content: [{ type: "text" as const, text: `Invalid fixture path: ${filePath}. Paths must stay within the fixture root.` }],
          isError: true
        };
      }

      const content = await readFixtureBody(rootPath, filePath);
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
    "read-endpoint-fixture",
    "Read the response metadata and body for an API fixture returned by list-endpoints",
    { fixtureDir: z.string().describe("Fixture directory returned by list-endpoints") },
    async ({ fixtureDir }) => {
      if (!resolveFixturePath(rootPath, path.join(fixtureDir, "response.meta.json"))) {
        return {
          content: [{ type: "text" as const, text: `Invalid fixture directory: ${fixtureDir}. Paths must stay within the fixture root.` }],
          isError: true
        };
      }

      const fixture = await readApiFixture(rootPath, fixtureDir);
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
      const configs = await readSiteConfigs(rootPath);
      const config = configs.find((candidate) => candidate.origin === origin);
      if (!config) {
        return {
          content: [{ type: "text" as const, text: `Origin "${origin}" not found.` }],
          isError: true
        };
      }

      const info = await readOriginInfo(rootPath, config);
      if (!info.manifest) {
        return {
          content: [{ type: "text" as const, text: `No manifest found for "${origin}".` }],
          isError: true
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(info.manifest, null, 2) }]
      };
    }
  );

  server.tool(
    "list-scenarios",
    "List all saved fixture scenarios",
    {},
    async () => {
      const scenarios = await listScenarios(rootPath);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ scenarios }, null, 2) }]
      };
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
