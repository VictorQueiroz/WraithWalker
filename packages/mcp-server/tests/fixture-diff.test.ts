import { describe, expect, it } from "vitest";

import { diffScenarios, renderDiffMarkdown } from "../src/fixture-diff.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

describe("fixture diff", () => {
  it("detects no differences between identical scenarios", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-diff-"
    });
    const meta = { status: 200, mimeType: "application/json", url: "https://api.example.com/users", method: "GET" };

    await root.writeApiFixture({
      scenario: "a",
      topOrigin: "https://app.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta,
      body: "{\"users\":[]}"
    });
    await root.writeApiFixture({
      scenario: "b",
      topOrigin: "https://app.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta,
      body: "{\"users\":[]}"
    });

    const diff = await diffScenarios(root.rootPath, "a", "b");
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("detects added endpoints", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-diff-"
    });
    const meta = { status: 200, mimeType: "application/json", url: "https://api.example.com/users", method: "GET" };

    await root.ensureScenario("a");
    await root.writeApiFixture({
      scenario: "b",
      topOrigin: "https://app.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta,
      body: "{\"users\":[]}"
    });

    const diff = await diffScenarios(root.rootPath, "a", "b");
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].pathname).toBe("/users");
    expect(diff.removed).toHaveLength(0);
  });

  it("detects removed endpoints", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-diff-"
    });
    const meta = { status: 200, mimeType: "application/json", url: "https://api.example.com/users", method: "GET" };

    await root.writeApiFixture({
      scenario: "a",
      topOrigin: "https://app.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta,
      body: "{\"users\":[]}"
    });
    await root.ensureScenario("b");

    const diff = await diffScenarios(root.rootPath, "a", "b");
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].pathname).toBe("/users");
    expect(diff.added).toHaveLength(0);
  });

  it("detects changed status codes and body content", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-diff-"
    });
    const metaA = { status: 200, mimeType: "application/json", url: "https://api.example.com/users", method: "GET" };
    const metaB = { status: 500, mimeType: "application/json", url: "https://api.example.com/users", method: "GET" };

    await root.writeApiFixture({
      scenario: "a",
      topOrigin: "https://app.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta: metaA,
      body: "{\"users\":[]}"
    });
    await root.writeApiFixture({
      scenario: "b",
      topOrigin: "https://app.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta: metaB,
      body: "{\"error\":\"internal\"}"
    });

    const diff = await diffScenarios(root.rootPath, "a", "b");
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].statusBefore).toBe(200);
    expect(diff.changed[0].statusAfter).toBe(500);
    expect(diff.changed[0].bodyChanged).toBe(true);
  });

  it("renders a markdown diff report", async () => {
    const diff = {
      scenarioA: "v1",
      scenarioB: "v2",
      added: [{ method: "POST", pathname: "/api/orders", status: 201, mimeType: "application/json" }],
      removed: [{ method: "DELETE", pathname: "/api/legacy", status: 200, mimeType: "text/plain" }],
      changed: [{ method: "GET", pathname: "/api/users", statusBefore: 200, statusAfter: 500, bodyChanged: true }]
    };

    const markdown = renderDiffMarkdown(diff);
    expect(markdown).toContain("# Fixture Diff: v1 vs v2");
    expect(markdown).toContain("## Added Endpoints");
    expect(markdown).toContain("POST /api/orders");
    expect(markdown).toContain("## Removed Endpoints");
    expect(markdown).toContain("DELETE /api/legacy");
    expect(markdown).toContain("## Changed Endpoints");
    expect(markdown).toContain("200 → 500");
    expect(markdown).toContain("1 added, 1 removed, 1 changed");
  });

  it("handles empty or non-existent scenario directories gracefully", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-diff-"
    });
    await root.ensureScenario("empty-a");
    await root.ensureScenario("empty-b");

    const diff = await diffScenarios(root.rootPath, "empty-a", "empty-b");
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("handles fixtures with missing body files", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-diff-"
    });
    const meta = { status: 200, mimeType: "application/json", url: "https://api.example.com/users", method: "GET" };

    await root.writeApiFixture({
      scenario: "a",
      topOrigin: "https://app.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta,
      body: "{\"data\":1}"
    });
    await root.writeApiFixture({
      scenario: "b",
      topOrigin: "https://app.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta
    });

    const diff = await diffScenarios(root.rootPath, "a", "b");
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].bodyChanged).toBe(true);
  });

  it("detects API endpoint changes in simple-mode scenarios", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-diff-"
    });
    const meta = { status: 200, mimeType: "application/json", url: "https://api.example.com/users", method: "POST" };

    await root.writeApiFixture({
      scenario: "a",
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      method: "POST",
      fixtureName: "users__q-abc__b-def",
      meta,
      body: "{\"created\":true}"
    });
    await root.ensureScenario("b");

    const diff = await diffScenarios(root.rootPath, "a", "b");
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].method).toBe("POST");
    expect(diff.removed[0].pathname).toBe("/users");
  });

  it("renders no-differences message", () => {
    const diff = { scenarioA: "a", scenarioB: "b", added: [], removed: [], changed: [] };
    const markdown = renderDiffMarkdown(diff);
    expect(markdown).toContain("No differences found.");
  });
});
