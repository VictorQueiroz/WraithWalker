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
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

describe("scenario operations", () => {
  it("saves, lists, and switches scenarios", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });
    await root.writeText("cdn.example.com/assets/app.js", "console.log('v1');");
    await root.writeText(".cursorrules", "version 1");

    await saveScenario({ path: root.rootPath, expectedRootId: root.rootId, name: "v1" });
    await root.writeText("cdn.example.com/assets/app.js", "console.log('v2');");
    await root.writeText(".cursorrules", "version 2");
    await saveScenario({ path: root.rootPath, expectedRootId: root.rootId, name: "v2" });

    expect(await listScenarios(root.rootPath)).toEqual(["v1", "v2"]);

    const result = await switchScenario({ path: root.rootPath, expectedRootId: root.rootId, name: "v1" });
    expect(result).toEqual({ ok: true, name: "v1" });
    expect(await fs.readFile(root.resolve("cdn.example.com/assets/app.js"), "utf8")).toBe("console.log('v1');");
    expect(await fs.readFile(root.resolve(".cursorrules"), "utf8")).toBe("version 1");
  });

  it("validates required scenario inputs", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });
    await expect(saveScenario({ path: root.rootPath, name: "test" })).rejects.toThrow("Expected root ID is required.");
    await expect(saveScenario({ expectedRootId: "root", name: "test" })).rejects.toThrow("Root path is required.");
    await expect(saveScenario({ path: root.rootPath, expectedRootId: "wrong", name: "test" })).rejects.toThrow("Sentinel root ID mismatch");
    await expect(saveScenario({ path: root.rootPath, expectedRootId: "wrong", name: "../escape" })).rejects.toThrow("Sentinel root ID mismatch");
    await expect(saveScenario({ path: root.rootPath, expectedRootId: root.rootId, name: "../escape" })).rejects.toThrow(
      "Scenario name must be 1-64 alphanumeric, hyphen, or underscore characters."
    );
    await expect(switchScenario({ path: root.rootPath, expectedRootId: root.rootId, name: "missing" })).rejects.toThrow(
      'Scenario "missing" does not exist.'
    );
  });
});

describe("scenario diffing", () => {
  it("detects added, removed, and changed endpoints", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });
    const meta = { status: 200, mimeType: "application/json", url: "https://api.example.com/users", method: "GET" };

    await root.writeApiFixture({
      mode: "advanced",
      scenario: "a",
      topOrigin: "https://app.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta,
      body: "{\"users\":[]}"
    });
    await root.writeApiFixture({
      mode: "advanced",
      scenario: "b",
      topOrigin: "https://app.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta: { ...meta, status: 500 },
      body: "{\"error\":true}"
    });
    await root.writeApiFixture({
      mode: "advanced",
      scenario: "b",
      topOrigin: "https://app.example.com",
      method: "POST",
      fixtureName: "orders__q-abc__b-def",
      meta: {
        status: 201,
        mimeType: "application/json",
        url: "https://api.example.com/orders",
        method: "POST"
      },
      body: "{\"created\":true}"
    });

    const diff = await diffScenarios(root.rootPath, "a", "b");
    expect(diff.added).toHaveLength(1);
    expect(diff.changed).toHaveLength(1);
    expect(diff.removed).toHaveLength(0);

    const markdown = renderDiffMarkdown(diff);
    expect(markdown).toContain("## Added Endpoints");
    expect(markdown).toContain("## Changed Endpoints");
    expect(markdown).toContain("200 → 500");
  });

  it("supports simple-mode scenario fixtures and markdown rendering", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });
    await root.writeApiFixture({
      mode: "simple",
      scenario: "simple-a",
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      method: "POST",
      fixtureName: "users__q-abc__b-def",
      meta: {
        status: 200,
        mimeType: "application/json",
        url: "https://api.example.com/users",
        method: "POST"
      },
      body: "{\"created\":true}"
    });
    await root.ensureScenario("simple-b");

    const diff = await diffScenarios(root.rootPath, "simple-a", "simple-b");
    expect(diff.removed).toHaveLength(1);

    const markdown = renderDiffMarkdown(diff);
    expect(markdown).toContain("## Removed Endpoints");
    expect(markdown).toContain("Summary: 0 added, 1 removed, 0 changed");
  });
});
