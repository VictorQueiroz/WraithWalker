import { promises as fs } from "node:fs";
import path from "node:path";

const SENTINEL_PATH = path.join(".wraithwalker", "root.json");

export interface RootSentinel {
  rootId: string;
  schemaVersion: number;
  createdAt: string;
}

export async function findRoot(startDir?: string): Promise<{ rootPath: string; sentinel: RootSentinel }> {
  let current = path.resolve(startDir || process.cwd());

  while (true) {
    const sentinelFile = path.join(current, SENTINEL_PATH);
    try {
      const content = await fs.readFile(sentinelFile, "utf8");
      return { rootPath: current, sentinel: JSON.parse(content) as RootSentinel };
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
  const sentinelFile = path.join(dir, SENTINEL_PATH);

  try {
    const existing = await fs.readFile(sentinelFile, "utf8");
    return JSON.parse(existing) as RootSentinel;
  } catch {
    // Does not exist — create it
  }

  const sentinel: RootSentinel = {
    rootId: crypto.randomUUID(),
    schemaVersion: 1,
    createdAt: new Date().toISOString()
  };

  await fs.mkdir(path.dirname(sentinelFile), { recursive: true });
  await fs.writeFile(sentinelFile, JSON.stringify(sentinel, null, 2), "utf8");
  return sentinel;
}
