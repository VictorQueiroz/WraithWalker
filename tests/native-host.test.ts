import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import { openDirectory, substituteDirectory, verifyRoot } from "../src/native-host/lib.mts";

async function createFixtureRoot() {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-"));
  const sentinelDirectory = path.join(rootPath, ".wraithwalker");
  await fs.mkdir(sentinelDirectory, { recursive: true });
  await fs.writeFile(
    path.join(sentinelDirectory, "root.json"),
    JSON.stringify({ rootId: "root-123" }, null, 2),
    "utf8"
  );
  return rootPath;
}

describe("native host helpers", () => {
  it("requires a root path before verifying", async () => {
    await expect(verifyRoot({ expectedRootId: "root-123" })).rejects.toThrow("Root path is required.");
  });

  it("requires an expected root id before verifying", async () => {
    const rootPath = await createFixtureRoot();
    await expect(verifyRoot({ path: rootPath })).rejects.toThrow("Expected root ID is required.");
  });

  it("validates the sentinel root id", async () => {
    const rootPath = await createFixtureRoot();
    const result = await verifyRoot({ path: rootPath, expectedRootId: "root-123" });
    expect(result.ok).toBe(true);
    expect(result.sentinel.rootId).toBe("root-123");
  });

  it("rejects mismatched sentinel ids", async () => {
    const rootPath = await createFixtureRoot();
    await expect(verifyRoot({ path: rootPath, expectedRootId: "wrong" })).rejects.toThrow(
      /Sentinel root ID mismatch/
    );
  });

  it("requires a command template when substituting directories", () => {
    expect(() => substituteDirectory("", "/tmp/fixtures")).toThrow("Command template is required.");
  });

  it("appends a quoted directory when no placeholder is present", () => {
    expect(substituteDirectory("code", "/tmp/fixtures")).toBe(`code '/tmp/fixtures'`);
  });

  it("injects a shell-quoted path", () => {
    const command = substituteDirectory('code "$DIR"', "/tmp/fixtures folder");
    expect(command).toBe(`code '/tmp/fixtures folder'`);
  });

  it("supports single-quoted and unquoted placeholders", () => {
    expect(substituteDirectory("open '$DIR'", "/tmp/fixtures folder")).toBe(`open '/tmp/fixtures folder'`);
    expect(substituteDirectory("open $DIR", "/tmp/fixture's")).toBe(`open '/tmp/fixture'\\''s'`);
  });

  it("returns the final command after verification", async () => {
    const rootPath = await createFixtureRoot();
    const result = await openDirectory({
      path: rootPath,
      expectedRootId: "root-123",
      commandTemplate: "true"
    });
    expect(result.ok).toBe(true);
    expect(result.command).toBe(`true '${rootPath}'`);
  });
});
