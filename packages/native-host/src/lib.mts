import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT_SENTINEL_RELATIVE_PATH = path.join(".wraithwalker", "root.json");

export interface RootSentinel {
  rootId: string;
  schemaVersion?: number;
  createdAt?: string;
}

export interface VerifyRootMessage {
  path?: string;
  expectedRootId?: string;
}

export interface OpenDirectoryMessage extends VerifyRootMessage {
  commandTemplate?: string;
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export async function readSentinel(rootPath: string): Promise<RootSentinel> {
  const sentinelPath = path.join(rootPath, ROOT_SENTINEL_RELATIVE_PATH);
  const sentinelRaw = await fs.readFile(sentinelPath, "utf8");
  return JSON.parse(sentinelRaw) as RootSentinel;
}

export async function verifyRoot({ path: rootPath, expectedRootId }: VerifyRootMessage): Promise<{ ok: true; sentinel: RootSentinel }> {
  if (!rootPath) {
    throw new Error("Root path is required.");
  }

  if (!expectedRootId) {
    throw new Error("Expected root ID is required.");
  }

  const sentinel = await readSentinel(rootPath);
  if (sentinel.rootId !== expectedRootId) {
    throw new Error(`Sentinel root ID mismatch. Expected ${expectedRootId}, received ${sentinel.rootId}.`);
  }

  return { ok: true, sentinel };
}

export function substituteDirectory(commandTemplate: string | undefined, rootPath: string): string {
  if (!commandTemplate) {
    throw new Error("Command template is required.");
  }

  if (!commandTemplate.includes("$DIR")) {
    return `${commandTemplate} ${shellQuote(rootPath)}`;
  }

  return commandTemplate
    .replace(/"\$DIR"/g, shellQuote(rootPath))
    .replace(/'\$DIR'/g, shellQuote(rootPath))
    .replace(/\$DIR/g, shellQuote(rootPath));
}

export async function openDirectory({
  path: rootPath,
  expectedRootId,
  commandTemplate
}: OpenDirectoryMessage): Promise<{ ok: true; command: string }> {
  await verifyRoot({ path: rootPath, expectedRootId });
  const command = substituteDirectory(commandTemplate, rootPath as string);

  const child = spawn("/bin/sh", ["-lc", command], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  return { ok: true, command };
}
