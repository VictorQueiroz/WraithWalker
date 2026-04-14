import type { Server as HttpServer } from "node:http";

import express from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface HttpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
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

export function createLoopbackHttpApp() {
  const app = express();
  app.use(
    createHostHeaderValidationMiddleware(["localhost", "127.0.0.1", "[::1]"])
  );
  return app;
}

export function createJsonRpcError(code: number, message: string) {
  return {
    jsonrpc: "2.0" as const,
    error: { code, message },
    id: null
  };
}

export function getSessionId(
  header: string | string[] | undefined
): string | undefined {
  if (Array.isArray(header)) {
    return header[0];
  }

  return header;
}

export function formatUrlHost(host: string): string {
  const normalized =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  return normalized.includes(":") ? `[${normalized}]` : normalized;
}

export function isLoopbackHost(host: string): boolean {
  const normalized =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1"
  );
}

export async function closeHttpSession(session: HttpSession): Promise<void> {
  await Promise.allSettled([session.transport.close(), session.server.close()]);
}

export async function closeHttpListener(listener: HttpServer): Promise<void> {
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
