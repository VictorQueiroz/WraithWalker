import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  diffScenarios,
  listScenarios,
  renderDiffMarkdown,
  saveScenario,
  switchScenario
} from "../src/scenarios.mts";
import { createRoot } from "../src/root.mts";

async function createFixtureRoot() {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-core-scenarios-"));
  const sentinel = await createRoot(rootPath);
  return { rootPath, rootId: sentinel.rootId };
}

async function writeScenarioFixture(
  rootPath: string,
  scenario: string,
  originKey: string,
  method: string,
  fixture: string,
  meta: { status: number; mimeType: string; url: string; method: string },
  body: string
): Promise<void> {
  const base = path.join(
    rootPath,
    ".wraithwalker",
    "scenarios",
    scenario,
    originKey,
    "origins",
    originKey,
    "http",
    method,
    fixture
  );
  await fs.mkdir(base, { recursive: true });
  await fs.writeFile(path.join(base, "response.meta.json"), JSON.stringify(meta), "utf8");
  await fs.writeFile(path.join(base, "response.body"), body, "utf8");
}

describe("scenario operations", () => {
  it("saves, lists, and switches scenarios", async () => {
    const { rootPath, rootId } = await createFixtureRoot();
    await fs.mkdir(path.join(rootPath, "cdn.example.com", "assets"), { recursive: true });
    await fs.writeFile(path.join(rootPath, "cdn.example.com", "assets", "app.js"), "console.log('v1');", "utf8");
    await fs.writeFile(path.join(rootPath, ".cursorrules"), "version 1", "utf8");

    await saveScenario({ path: rootPath, expectedRootId: rootId, name: "v1" });
    await fs.writeFile(path.join(rootPath, "cdn.example.com", "assets", "app.js"), "console.log('v2');", "utf8");
    await fs.writeFile(path.join(rootPath, ".cursorrules"), "version 2", "utf8");
    await saveScenario({ path: rootPath, expectedRootId: rootId, name: "v2" });

    expect(await listScenarios(rootPath)).toEqual(["v1", "v2"]);

    const result = await switchScenario({ path: rootPath, expectedRootId: rootId, name: "v1" });
    expect(result).toEqual({ ok: true, name: "v1" });
    expect(await fs.readFile(path.join(rootPath, "cdn.example.com", "assets", "app.js"), "utf8")).toBe("console.log('v1');");
    expect(await fs.readFile(path.join(rootPath, ".cursorrules"), "utf8")).toBe("version 1");
  });

  it("validates required scenario inputs", async () => {
    const { rootPath, rootId } = await createFixtureRoot();
    await expect(saveScenario({ path: rootPath, name: "test" })).rejects.toThrow("Expected root ID is required.");
    await expect(saveScenario({ expectedRootId: "root", name: "test" })).rejects.toThrow("Root path is required.");
    await expect(saveScenario({ path: rootPath, expectedRootId: "wrong", name: "test" })).rejects.toThrow("Sentinel root ID mismatch");
    await expect(saveScenario({ path: rootPath, expectedRootId: "wrong", name: "../escape" })).rejects.toThrow("Sentinel root ID mismatch");
    await expect(saveScenario({ path: rootPath, expectedRootId: rootId, name: "../escape" })).rejects.toThrow(
      "Scenario name must be 1-64 alphanumeric, hyphen, or underscore characters."
    );
    await expect(switchScenario({ path: rootPath, expectedRootId: rootId, name: "missing" })).rejects.toThrow(
      'Scenario "missing" does not exist.'
    );
  });
});

describe("scenario diffing", () => {
  it("detects added, removed, and changed endpoints", async () => {
    const { rootPath } = await createFixtureRoot();
    const meta = { status: 200, mimeType: "application/json", url: "https://api.example.com/users", method: "GET" };

    await writeScenarioFixture(rootPath, "a", "https__app.example.com", "GET", "users__q-abc__b-def", meta, '{"users":[]}');
    await writeScenarioFixture(rootPath, "b", "https__app.example.com", "GET", "users__q-abc__b-def", { ...meta, status: 500 }, '{"error":true}');
    await writeScenarioFixture(rootPath, "b", "https__app.example.com", "POST", "orders__q-abc__b-def", {
      status: 201,
      mimeType: "application/json",
      url: "https://api.example.com/orders",
      method: "POST"
    }, '{"created":true}');

    const diff = await diffScenarios(rootPath, "a", "b");
    expect(diff.added).toHaveLength(1);
    expect(diff.changed).toHaveLength(1);
    expect(diff.removed).toHaveLength(0);

    const markdown = renderDiffMarkdown(diff);
    expect(markdown).toContain("## Added Endpoints");
    expect(markdown).toContain("## Changed Endpoints");
    expect(markdown).toContain("200 → 500");
  });

  it("supports simple-mode scenario fixtures and markdown rendering", async () => {
    const { rootPath } = await createFixtureRoot();
    const base = path.join(
      rootPath,
      ".wraithwalker",
      "scenarios",
      "simple-a",
      ".wraithwalker",
      "simple",
      "https__app.example.com",
      "origins",
      "https__api.example.com",
      "http",
      "POST",
      "users__q-abc__b-def"
    );
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(path.join(base, "response.meta.json"), JSON.stringify({
      status: 200,
      mimeType: "application/json",
      url: "https://api.example.com/users",
      method: "POST"
    }), "utf8");
    await fs.writeFile(path.join(base, "response.body"), '{"created":true}', "utf8");
    await fs.mkdir(path.join(rootPath, ".wraithwalker", "scenarios", "simple-b"), { recursive: true });

    const diff = await diffScenarios(rootPath, "simple-a", "simple-b");
    expect(diff.removed).toHaveLength(1);

    const markdown = renderDiffMarkdown(diff);
    expect(markdown).toContain("## Removed Endpoints");
    expect(markdown).toContain("Summary: 0 added, 1 removed, 0 changed");
  });
});
