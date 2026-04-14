import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  getRevealDirectoryCommand,
  getRevealDirectoryLaunch,
  listScenarios,
  openDirectory,
  revealDirectory,
  saveScenario,
  spawnDetached,
  substituteDirectory,
  switchScenario,
  verifyRoot
} from "../src/lib.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

async function createFixtureRoot() {
  return createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-",
    rootId: "root-123"
  });
}

describe("native host helpers", () => {
  it("requires a root path before verifying", async () => {
    await expect(verifyRoot({ expectedRootId: "root-123" })).rejects.toThrow(
      "Root path is required."
    );
  });

  it("requires an expected root id before verifying", async () => {
    const root = await createFixtureRoot();
    await expect(verifyRoot({ path: root.rootPath })).rejects.toThrow(
      "Expected root ID is required."
    );
  });

  it("validates the sentinel root id", async () => {
    const root = await createFixtureRoot();
    const result = await verifyRoot({
      path: root.rootPath,
      expectedRootId: "root-123"
    });
    expect(result.ok).toBe(true);
    expect(result.sentinel.rootId).toBe("root-123");
  });

  it("rejects mismatched sentinel ids", async () => {
    const root = await createFixtureRoot();
    await expect(
      verifyRoot({ path: root.rootPath, expectedRootId: "wrong" })
    ).rejects.toThrow(/Sentinel root ID mismatch/);
  });

  it("requires a command template when substituting directories", () => {
    expect(() => substituteDirectory("", "/tmp/fixtures")).toThrow(
      "Command template is required."
    );
  });

  it("appends a quoted directory when no placeholder is present", () => {
    expect(substituteDirectory("code", "/tmp/fixtures")).toBe(
      `code '/tmp/fixtures'`
    );
  });

  it("injects a shell-quoted path", () => {
    const command = substituteDirectory('code "$DIR"', "/tmp/fixtures folder");
    expect(command).toBe(`code '/tmp/fixtures folder'`);
  });

  it("supports single-quoted and unquoted placeholders", () => {
    expect(substituteDirectory("open '$DIR'", "/tmp/fixtures folder")).toBe(
      `open '/tmp/fixtures folder'`
    );
    expect(substituteDirectory("open $DIR", "/tmp/fixture's")).toBe(
      `open '/tmp/fixture'\\''s'`
    );
  });

  it("returns the final command after verification", async () => {
    const root = await createFixtureRoot();
    const result = await openDirectory({
      path: root.rootPath,
      expectedRootId: "root-123",
      commandTemplate: "true"
    });
    expect(result.ok).toBe(true);
    expect(result.command).toBe(`true '${root.rootPath}'`);
  });

  it("builds the OS reveal command for supported platforms", async () => {
    const root = await createFixtureRoot();

    expect(getRevealDirectoryCommand(root.rootPath, "darwin")).toBe(
      `open '${root.rootPath}'`
    );
    expect(getRevealDirectoryCommand(root.rootPath, "linux")).toBe(
      `xdg-open '${root.rootPath}'`
    );
    expect(getRevealDirectoryLaunch(root.rootPath, "win32")).toEqual({
      command: `cmd /c start \"\" '${root.rootPath}'`,
      program: "cmd",
      args: ["/c", "start", "", root.rootPath]
    });
  });

  it("uses the injected spawn function for OS reveal launches", async () => {
    const root = await createFixtureRoot();
    const child = { unref() {} };
    const spawnFn = vi.fn().mockReturnValue(child as any);

    const result = await revealDirectory(
      {
        path: root.rootPath,
        expectedRootId: "root-123"
      },
      spawnFn
    );

    expect(spawnFn).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("supports detached spawn helpers in isolation", () => {
    const child = { unref: vi.fn() };
    const spawnFn = vi.fn().mockReturnValue(child as any);

    spawnDetached("open", ["/tmp/fixtures"], spawnFn);

    expect(spawnFn).toHaveBeenCalledWith("open", ["/tmp/fixtures"], {
      detached: true,
      stdio: "ignore"
    });
    expect(child.unref).toHaveBeenCalled();
  });
});

describe("scenario management", () => {
  async function createFixtureRootWithData() {
    const root = await createFixtureRoot();
    await root.writeText("cdn.example.com/assets/app.js", "console.log('v1');");
    return root;
  }

  it("rejects invalid scenario names", async () => {
    const root = await createFixtureRoot();
    await expect(
      saveScenario({
        path: root.rootPath,
        expectedRootId: "root-123",
        name: ""
      })
    ).rejects.toThrow("Scenario name must be");
    await expect(
      saveScenario({
        path: root.rootPath,
        expectedRootId: "root-123",
        name: "../escape"
      })
    ).rejects.toThrow("Scenario name must be");
    await expect(
      saveScenario({
        path: root.rootPath,
        expectedRootId: "root-123",
        name: "has spaces"
      })
    ).rejects.toThrow("Scenario name must be");
  });

  it("saves a scenario by copying fixture directories", async () => {
    const root = await createFixtureRootWithData();
    const result = await saveScenario({
      path: root.rootPath,
      expectedRootId: "root-123",
      name: "baseline"
    });

    expect(result).toEqual({ ok: true, name: "baseline" });

    const savedFile = path.join(
      root.rootPath,
      ".wraithwalker",
      "scenarios",
      "baseline",
      "cdn.example.com",
      "assets",
      "app.js"
    );
    const content = await fs.readFile(savedFile, "utf8");
    expect(content).toBe("console.log('v1');");
  });

  it("lists available scenarios", async () => {
    const root = await createFixtureRootWithData();

    // No scenarios yet
    const empty = await listScenarios({
      path: root.rootPath,
      expectedRootId: "root-123"
    });
    expect(empty).toEqual({ ok: true, scenarios: [] });

    // Save two scenarios
    await saveScenario({
      path: root.rootPath,
      expectedRootId: "root-123",
      name: "alpha"
    });
    await saveScenario({
      path: root.rootPath,
      expectedRootId: "root-123",
      name: "beta"
    });

    const result = await listScenarios({
      path: root.rootPath,
      expectedRootId: "root-123"
    });
    expect(result).toEqual({ ok: true, scenarios: ["alpha", "beta"] });
  });

  it("switches to a saved scenario", async () => {
    const root = await createFixtureRootWithData();

    // Save v1
    await saveScenario({
      path: root.rootPath,
      expectedRootId: "root-123",
      name: "v1"
    });

    // Modify the current fixtures
    await root.writeText("cdn.example.com/assets/app.js", "console.log('v2');");

    // Save v2
    await saveScenario({
      path: root.rootPath,
      expectedRootId: "root-123",
      name: "v2"
    });

    // Switch back to v1
    const result = await switchScenario({
      path: root.rootPath,
      expectedRootId: "root-123",
      name: "v1"
    });
    expect(result).toEqual({ ok: true, name: "v1" });

    const content = await fs.readFile(
      path.join(root.rootPath, "cdn.example.com", "assets", "app.js"),
      "utf8"
    );
    expect(content).toBe("console.log('v1');");
  });

  it("rejects switching to a non-existent scenario", async () => {
    const root = await createFixtureRoot();
    await expect(
      switchScenario({
        path: root.rootPath,
        expectedRootId: "root-123",
        name: "missing"
      })
    ).rejects.toThrow('Scenario "missing" does not exist.');
  });

  it("preserves the .wraithwalker directory when switching scenarios", async () => {
    const root = await createFixtureRootWithData();
    await saveScenario({
      path: root.rootPath,
      expectedRootId: "root-123",
      name: "test"
    });
    await switchScenario({
      path: root.rootPath,
      expectedRootId: "root-123",
      name: "test"
    });

    // .wraithwalker should still exist with sentinel
    const sentinel = await root.readJson<{ rootId: string }>(
      ".wraithwalker/root.json"
    );
    expect(sentinel.rootId).toBe("root-123");

    // Scenario should still be listed
    const result = await listScenarios({
      path: root.rootPath,
      expectedRootId: "root-123"
    });
    expect(result.scenarios).toContain("test");
  });
});
