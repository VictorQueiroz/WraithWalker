import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  startHttpServer,
  startServer
} from "@wraithwalker/mcp-server/server";
import { findRoot } from "@wraithwalker/core/root";

import type { CommandSpec } from "../lib/command.mjs";
import { UsageError } from "../lib/command.mjs";

interface ServeArgs {
  http: boolean;
  host: string;
  port: number;
}

type ServeResult =
  | { transport: "stdio" }
  | {
    transport: "streamable-http";
    rootPath: string;
    host: string;
    port: number;
    url: string;
    tools: readonly string[];
    warnNonLoopback: boolean;
  };

function isLoopbackHost(host: string): boolean {
  const normalized = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;

  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new UsageError(
      `Invalid port: ${value}. Expected an integer between 1 and 65535.\nUsage: wraithwalker serve [--http] [--host <host>] [--port <port>]`
    );
  }

  return parsed;
}

export const command: CommandSpec<ServeArgs, ServeResult> = {
  name: "serve",
  summary: "Start the MCP server",
  usage: "Usage: wraithwalker serve [--http] [--host <host>] [--port <port>]",
  requiresRoot: true,
  parse(argv) {
    let http = false;
    let host = DEFAULT_HTTP_HOST;
    let port = DEFAULT_HTTP_PORT;
    let sawHost = false;
    let sawPort = false;

    for (let index = 0; index < argv.length; index++) {
      const arg = argv[index];

      switch (arg) {
        case "--http":
          http = true;
          break;
        case "--host":
          if (!argv[index + 1]) {
            throw new UsageError("Usage: wraithwalker serve [--http] [--host <host>] [--port <port>]");
          }
          host = argv[index + 1];
          sawHost = true;
          index++;
          break;
        case "--port":
          if (!argv[index + 1]) {
            throw new UsageError("Usage: wraithwalker serve [--http] [--host <host>] [--port <port>]");
          }
          port = parsePort(argv[index + 1]);
          sawPort = true;
          index++;
          break;
        default:
          throw new UsageError("Usage: wraithwalker serve [--http] [--host <host>] [--port <port>]");
      }
    }

    if (!http && (sawHost || sawPort)) {
      throw new UsageError(
        `--host and --port require --http.\nUsage: wraithwalker serve [--http] [--host <host>] [--port <port>]`
      );
    }

    return { http, host, port };
  },
  async execute(context, args) {
    const { rootPath } = await findRoot(context.cwd);

    if (!args.http) {
      await startServer(rootPath);
      return { transport: "stdio" };
    }

    const handle = await startHttpServer(rootPath, {
      host: args.host,
      port: args.port
    });

    return {
      transport: "streamable-http",
      rootPath,
      host: handle.host,
      port: handle.port,
      url: handle.url,
      tools: handle.tools,
      warnNonLoopback: !isLoopbackHost(handle.host)
    };
  },
  render(output, result) {
    if (result.transport !== "streamable-http") {
      return;
    }

    output.heading("MCP Server Ready");
    output.keyValue("Root", result.rootPath);
    output.keyValue("Transport", result.transport);
    output.keyValue("Host", result.host);
    output.keyValue("Port", result.port);
    output.keyValue("URL", result.url);

    output.heading("Tools");
    for (const tool of result.tools) {
      output.listItem(tool);
    }

    output.info("Use this URL in HTTP-capable MCP clients like Claude Code, Cursor, Windsurf, and Codex.");

    if (result.warnNonLoopback) {
      output.warn("This server is not bound to a loopback host. Review your network exposure before sharing the URL.");
    }
  }
};
