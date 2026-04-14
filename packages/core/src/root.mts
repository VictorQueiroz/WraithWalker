import path from "node:path";

import {
  ROOT_SENTINEL_RELATIVE_PATH,
  ROOT_SENTINEL_SCHEMA_VERSION
} from "./constants.mjs";
import { createFixtureRootFs } from "./root-fs.mjs";

export interface RootSentinel {
  rootId: string;
  schemaVersion?: number;
  createdAt?: string;
}

export async function readSentinel(rootPath: string): Promise<RootSentinel> {
  return createFixtureRootFs(rootPath).readJson<RootSentinel>(
    ROOT_SENTINEL_RELATIVE_PATH
  );
}

export async function findRoot(
  startDir?: string
): Promise<{ rootPath: string; sentinel: RootSentinel }> {
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
  const rootFs = createFixtureRootFs(dir);
  const existing = await rootFs.readOptionalJson<RootSentinel>(
    ROOT_SENTINEL_RELATIVE_PATH
  );
  if (existing) {
    return existing;
  }

  const sentinel: RootSentinel = {
    rootId: crypto.randomUUID(),
    schemaVersion: ROOT_SENTINEL_SCHEMA_VERSION,
    createdAt: new Date().toISOString()
  };

  await rootFs.writeJson(ROOT_SENTINEL_RELATIVE_PATH, sentinel);
  return sentinel;
}
