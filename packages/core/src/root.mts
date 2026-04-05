import { promises as fs } from "node:fs";
import path from "node:path";

import { ROOT_SENTINEL_RELATIVE_PATH, ROOT_SENTINEL_SCHEMA_VERSION } from "./constants.mjs";

export interface RootSentinel {
  rootId: string;
  schemaVersion?: number;
  createdAt?: string;
}

export async function readSentinel(rootPath: string): Promise<RootSentinel> {
  const sentinelPath = path.join(rootPath, ROOT_SENTINEL_RELATIVE_PATH);
  const sentinelRaw = await fs.readFile(sentinelPath, "utf8");
  return JSON.parse(sentinelRaw) as RootSentinel;
}

export async function findRoot(startDir?: string): Promise<{ rootPath: string; sentinel: RootSentinel }> {
  let current = path.resolve(startDir || process.cwd());

  while (true) {
    try {
      const sentinel = await readSentinel(current);
      return { rootPath: current, sentinel };
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(
          "No .wraithwalker/root.json found. Run `wraithwalker init` to create a fixture root."
        );
      }
      current = parent;
    }
  }
}

export async function createRoot(dir: string): Promise<RootSentinel> {
  const sentinelPath = path.join(dir, ROOT_SENTINEL_RELATIVE_PATH);

  try {
    const existing = await fs.readFile(sentinelPath, "utf8");
    return JSON.parse(existing) as RootSentinel;
  } catch {
    // Root sentinel does not exist yet.
  }

  const sentinel: RootSentinel = {
    rootId: crypto.randomUUID(),
    schemaVersion: ROOT_SENTINEL_SCHEMA_VERSION,
    createdAt: new Date().toISOString()
  };

  await fs.mkdir(path.dirname(sentinelPath), { recursive: true });
  await fs.writeFile(sentinelPath, JSON.stringify(sentinel, null, 2), "utf8");
  return sentinel;
}
