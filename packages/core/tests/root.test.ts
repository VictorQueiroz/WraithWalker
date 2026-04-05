import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import { createRoot, findRoot, readSentinel } from "../src/root.mts";

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-core-root-"));
}

describe("root helpers", () => {
  it("creates and reads a root sentinel", async () => {
    const dir = await tmpdir();
    const sentinel = await createRoot(dir);

    expect(sentinel.rootId).toBeDefined();
    expect(sentinel.schemaVersion).toBe(1);
    expect(await readSentinel(dir)).toEqual(sentinel);
  });

  it("returns an existing sentinel without overwriting it", async () => {
    const dir = await tmpdir();
    await fs.mkdir(path.join(dir, ".wraithwalker"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".wraithwalker", "root.json"),
      JSON.stringify({ rootId: "existing-root" }, null, 2),
      "utf8"
    );

    const sentinel = await createRoot(dir);
    expect(sentinel.rootId).toBe("existing-root");
  });

  it("finds the nearest root by walking up directories", async () => {
    const dir = await tmpdir();
    const sentinel = await createRoot(dir);
    const nested = path.join(dir, "deep", "nested");
    await fs.mkdir(nested, { recursive: true });

    const found = await findRoot(nested);
    expect(found.rootPath).toBe(dir);
    expect(found.sentinel.rootId).toBe(sentinel.rootId);
  });

  it("throws when no root exists", async () => {
    const dir = await tmpdir();
    await expect(findRoot(dir)).rejects.toThrow("No .wraithwalker/root.json found");
  });
});
