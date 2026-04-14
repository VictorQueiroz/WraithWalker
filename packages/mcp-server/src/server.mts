import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";

import * as trpcExpress from "@trpc/server/adapters/express";
import express from "express";
import { createRoot } from "@wraithwalker/core/root";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_HTTP_TRPC_MAX_BODY_SIZE_BYTES,
  HTTP_MCP_PATH,
  MCP_TOOL_NAMES,
  SERVER_NAME,
  SERVER_VERSION
} from "./server-constants.mjs";
import {
  closeHttpListener,
  closeHttpSession,
  createJsonRpcError,
  createLoopbackHttpApp,
  formatUrlHost,
  getSessionId,
  isLoopbackHost,
  type HttpSession
} from "./server-http.mjs";
import { createConnectedServer } from "./server-tool-registration.mjs";
import { createExtensionSessionTracker } from "./extension-session.mjs";
import {
  appendVaryHeader,
  buildLocalServerCorsHeaders
} from "./local-server-cors.mjs";
import { createServerRootRuntime } from "./root-runtime.mjs";
import { createWraithwalkerRouter, HTTP_TRPC_PATH } from "./trpc.mjs";

export {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_HTTP_TRPC_MAX_BODY_SIZE_BYTES,
  HTTP_MCP_PATH,
  MCP_TOOL_NAMES
} from "./server-constants.mjs";

export { isLoopbackHost } from "./server-http.mjs";

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

export async function startServer(
  rootPath: string,
  options: StartServerOptions = {}
): Promise<import("@modelcontextprotocol/sdk/server/mcp.js").McpServer> {
  const sentinel = await createRoot(rootPath);
  const runtime = createServerRootRuntime({ rootPath, sentinel });
  const extensionSessions = createExtensionSessionTracker({
    getActiveTrace: () => runtime.getActiveTrace(),
    getEffectiveSiteConfigs: () => runtime.readEffectiveSiteConfigs()
  });
  const server = createConnectedServer(rootPath, {
    runtime,
    extensionSessions
  });
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
    throw new Error(
      `Refusing to start WraithWalker HTTP server on non-loopback host "${host}". Use 127.0.0.1, localhost, or ::1.`
    );
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
    const origin =
      typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    const requestedHeaders =
      typeof req.headers["access-control-request-headers"] === "string"
        ? req.headers["access-control-request-headers"]
        : undefined;
    const requestedPrivateNetwork =
      typeof req.headers["access-control-request-private-network"] === "string"
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

  app.use(
    HTTP_TRPC_PATH,
    trpcExpress.createExpressMiddleware({
      router: trpcRouter,
      createContext: () => ({}),
      allowMethodOverride: true,
      maxBodySize: DEFAULT_HTTP_TRPC_MAX_BODY_SIZE_BYTES
    })
  );

  app.use(HTTP_MCP_PATH, express.json());

  app.all(HTTP_MCP_PATH, async (req, res) => {
    const sessionId = getSessionId(req.headers["mcp-session-id"]);
    let session = sessionId ? sessions.get(sessionId) : undefined;
    let createdSession = false;

    try {
      if (!session) {
        if (sessionId) {
          res
            .status(404)
            .json(
              createJsonRpcError(-32000, `Session "${sessionId}" not found.`)
            );
          return;
        }

        if (req.method !== "POST" || !isInitializeRequest(req.body)) {
          res
            .status(400)
            .json(
              createJsonRpcError(
                -32000,
                "Bad Request: No valid session ID provided."
              )
            );
          return;
        }

        const server = createConnectedServer(rootPath, {
          runtime,
          extensionSessions
        });
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
        res
          .status(500)
          .json(
            createJsonRpcError(-32603, `Internal server error: ${message}`)
          );
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

      await Promise.allSettled(
        activeSessions.map((session) => closeHttpSession(session))
      );
      await closeHttpListener(listener);
    }
  };
}
