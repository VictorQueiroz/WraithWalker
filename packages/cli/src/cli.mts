#!/usr/bin/env node

import process from "node:process";

import { runCli } from "./lib/runner.mjs";

function formatEntrypointError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runEntrypoint({
  argv = process.argv.slice(2),
  runCliImpl = runCli,
  reportError = (message: string) => console.error(message)
}: {
  argv?: string[];
  runCliImpl?: typeof runCli;
  reportError?: (message: string) => void;
} = {}): Promise<number> {
  try {
    const exitCode = await runCliImpl(argv);
    process.exitCode = exitCode;
    return exitCode;
  } catch (error) {
    reportError(formatEntrypointError(error));
    process.exitCode = 1;
    return 1;
  }
}

await runEntrypoint();
