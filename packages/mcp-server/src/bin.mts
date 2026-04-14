#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  startHttpServer,
  startServer,
  type HttpServerHandle
} from "./server.mjs";

export interface ParsedArgs {
  rootPath?: string;
  http: boolean;
  host: string;
  port: number;
}

export function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `Invalid port: ${value}. Expected an integer between 1 and 65535.`
    );
  }

  return parsed;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let rootPath: string | undefined;
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
          throw new Error("Missing value for --host.");
        }
        host = argv[index + 1];
        sawHost = true;
        index++;
        break;
      case "--port":
        if (!argv[index + 1]) {
          throw new Error("Missing value for --port.");
        }
        port = parsePort(argv[index + 1]);
        sawPort = true;
        index++;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown argument: ${arg}`);
        }
        if (rootPath) {
          throw new Error(`Unexpected extra positional argument: ${arg}`);
        }
        rootPath = arg;
    }
  }

  if (!http && (sawHost || sawPort)) {
    throw new Error("--host and --port require --http.");
  }

  return { rootPath, http, host, port };
}

export function renderHttpStartup(
  handle: Pick<HttpServerHandle, "url" | "host" | "port">,
  rootPath: string,
  writeLine: (line: string) => void = console.log
): void {
  writeLine("MCP Server Ready");
  writeLine(`Root: ${rootPath}`);
  writeLine("Transport: streamable-http");
  writeLine(`Host: ${handle.host}`);
  writeLine(`Port: ${handle.port}`);
  writeLine(`URL: ${handle.url}`);
}

export async function runBin({
  argv = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  startServerImpl = startServer,
  startHttpServerImpl = startHttpServer,
  writeLine = console.log
}: {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  startServerImpl?: typeof startServer;
  startHttpServerImpl?: typeof startHttpServer;
  writeLine?: (line: string) => void;
} = {}): Promise<void> {
  const parsedArgs = parseArgs(argv);
  const rootPath = parsedArgs.rootPath || env.WRAITHWALKER_ROOT || cwd;

  if (parsedArgs.http) {
    const handle = await startHttpServerImpl(rootPath, {
      host: parsedArgs.host,
      port: parsedArgs.port
    });
    renderHttpStartup(handle, rootPath, writeLine);
    return;
  }

  await startServerImpl(rootPath);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runBin();
}
