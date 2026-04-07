import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  startHttpServer
} from "@wraithwalker/mcp-server/server";

import type { CommandSpec } from "../lib/command.mjs";
import { UsageError } from "../lib/command.mjs";
import { resolveServeRoot } from "../lib/serve-root.mjs";

interface ServeArgs {
  dir?: string;
  http: boolean;
  host: string;
  port: number;
}

interface ServeResult {
  rootPath: string;
  host: string;
  port: number;
  baseUrl: string;
  trpcUrl: string;
  url: string;
  tools: readonly string[];
}

function createUsageMessage() {
  return "Usage: wraithwalker serve [dir] [--http] [--host <host>] [--port <port>]";
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new UsageError(
      `Invalid port: ${value}. Expected an integer between 1 and 65535.\n${createUsageMessage()}`
    );
  }

  return parsed;
}

export const command: CommandSpec<ServeArgs, ServeResult> = {
  name: "serve",
  summary: "Start the combined MCP+tRPC HTTP server",
  usage: createUsageMessage(),
  parse(argv) {
    let dir: string | undefined;
    let http = false;
    let host = DEFAULT_HTTP_HOST;
    let port = DEFAULT_HTTP_PORT;

    for (let index = 0; index < argv.length; index++) {
      const arg = argv[index];

      switch (arg) {
        case "--http":
          http = true;
          break;
        case "--host":
          if (!argv[index + 1]) {
            throw new UsageError(createUsageMessage());
          }
          host = argv[index + 1];
          index++;
          break;
        case "--port":
          if (!argv[index + 1]) {
            throw new UsageError(createUsageMessage());
          }
          port = parsePort(argv[index + 1]);
          index++;
          break;
        default:
          if (arg.startsWith("-")) {
            throw new UsageError(createUsageMessage());
          }

          if (dir) {
            throw new UsageError(createUsageMessage());
          }

          dir = arg;
      }
    }

    return { dir, http, host, port };
  },
  async execute(context, args) {
    void args.http;

    const rootPath = resolveServeRoot({
      cwd: context.cwd,
      explicitDir: args.dir,
      env: context.env,
      platform: context.platform ?? process.platform,
      homeDir: context.homeDir
    });

    const handle = await startHttpServer(rootPath, {
      host: args.host,
      port: args.port
    });

    return {
      rootPath: handle.rootPath,
      host: handle.host,
      port: handle.port,
      baseUrl: handle.baseUrl,
      trpcUrl: handle.trpcUrl,
      url: handle.url,
      tools: handle.tools
    };
  },
  render(output, result) {
    output.heading("WraithWalker Server Ready");
    output.keyValue("Root", result.rootPath);
    output.keyValue("Host", result.host);
    output.keyValue("Port", result.port);
    output.keyValue("Base URL", result.baseUrl);
    output.keyValue("MCP URL", result.url);
    output.keyValue("tRPC URL", result.trpcUrl);

    output.heading("Tools");
    for (const tool of result.tools) {
      output.listItem(tool);
    }

    output.info("The extension will automatically prefer the local WraithWalker server at the tRPC URL above when it is running.");
  }
};
