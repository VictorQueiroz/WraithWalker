#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  diffScenarios,
  listScenarios,
  openDirectory,
  revealDirectory,
  saveScenario,
  switchScenario,
  verifyRoot
} from "./lib.mjs";

interface NativeHostMessage {
  type?: string;
  path?: string;
  expectedRootId?: string;
  commandTemplate?: string;
  name?: string;
  description?: string;
  scenarioA?: string;
  scenarioB?: string;
}

export function writeMessage(payload: unknown): void {
  const content = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(content.length, 0);
  process.stdout.write(Buffer.concat([header, content]));
}

export async function handleMessage(
  message: NativeHostMessage
): Promise<unknown> {
  if (message.type === "verifyRoot") {
    return verifyRoot(message);
  }

  if (message.type === "openDirectory") {
    return openDirectory(message);
  }

  if (message.type === "revealDirectory") {
    return revealDirectory(message);
  }

  if (message.type === "saveScenario") {
    return saveScenario(message);
  }

  if (message.type === "switchScenario") {
    return switchScenario(message);
  }

  if (message.type === "listScenarios") {
    return listScenarios(message);
  }

  if (message.type === "diffScenarios") {
    return diffScenarios(message);
  }

  throw new Error(`Unknown message type: ${message.type}`);
}

export async function main({
  stdin = process.stdin,
  handleMessageImpl = handleMessage,
  writeMessageImpl = writeMessage
}: {
  stdin?: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>;
  handleMessageImpl?: typeof handleMessage;
  writeMessageImpl?: typeof writeMessage;
} = {}): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const input = Buffer.concat(chunks);
  if (input.length < 4) {
    throw new Error("Native host expected a length-prefixed message.");
  }

  const messageLength = input.readUInt32LE(0);
  if (input.length < 4 + messageLength) {
    throw new Error(
      "Native host received a truncated length-prefixed message."
    );
  }

  const body = input.subarray(4, 4 + messageLength).toString("utf8");
  const message = JSON.parse(body) as NativeHostMessage;
  const response = await handleMessageImpl(message);
  writeMessageImpl(response);
}

export async function runEntrypoint(
  options?: Parameters<typeof main>[0]
): Promise<void> {
  try {
    await main(options);
  } catch (error) {
    (options?.writeMessageImpl ?? writeMessage)({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function resolveExecutionPath(filePath: string): string | null {
  try {
    return realpathSync(path.resolve(filePath));
  } catch {
    return null;
  }
}

export function isDirectExecution(argv = process.argv): boolean {
  const entrypointPath = argv[1];
  if (!entrypointPath) {
    return false;
  }

  return (
    resolveExecutionPath(entrypointPath) ===
    resolveExecutionPath(fileURLToPath(import.meta.url))
  );
}

if (isDirectExecution()) {
  await runEntrypoint();
}
