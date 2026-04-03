#!/usr/bin/env node

import process from "node:process";
import { openDirectory, verifyRoot } from "./lib.mjs";

interface NativeHostMessage {
  type?: string;
  path?: string;
  expectedRootId?: string;
  commandTemplate?: string;
}

export function writeMessage(payload: unknown): void {
  const content = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(content.length, 0);
  process.stdout.write(Buffer.concat([header, content]));
}

export async function handleMessage(message: NativeHostMessage): Promise<unknown> {
  if (message.type === "verifyRoot") {
    return verifyRoot(message);
  }

  if (message.type === "openDirectory") {
    return openDirectory(message);
  }

  throw new Error(`Unknown message type: ${message.type}`);
}

export async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const input = Buffer.concat(chunks);
  if (input.length < 4) {
    throw new Error("Native host expected a length-prefixed message.");
  }

  const messageLength = input.readUInt32LE(0);
  const body = input.subarray(4, 4 + messageLength).toString("utf8");
  const message = JSON.parse(body) as NativeHostMessage;
  const response = await handleMessage(message);
  writeMessage(response);
}

main().catch((error: unknown) => {
  writeMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  });
});
