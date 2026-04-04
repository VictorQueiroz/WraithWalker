import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import { diffScenarios, renderDiffMarkdown } from "../src/fixture-diff.mts";

async function createRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-diff-"));
  await fs.mkdir(path.join(rootPath, ".wraithwalker", "scenarios"), { recursive: true });
  return rootPath;
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
  const base = path.join(rootPath, ".wraithwalker", "scenarios", scenario, originKey, "origins", originKey, "http", method, fixture);
  await fs.mkdir(base, { recursive: true });
  await fs.writeFile(path.join(base, "response.meta.json"), JSON.stringify(meta), "utf8");
  await fs.writeFile(path.join(base, "response.body"), body, "utf8");
}

describe("fixture diff", () => {
  it("detects no differences between identical scenarios", async () => {
    const rootPath = await createRoot();
    const meta = { status: 200, mimeType: "application/json", url: "https://api.example.com/users", method: "GET" };

    await writeScenarioFixture(rootPath, "a", "https__app.example.com", "GET", "users__q-abc__b-def", meta, '{"users":[]}');
    await writeScenarioFixture(rootPath, "b", "https__app.example.com", "GET", "users__q-abc__b-def", meta, '{"users":[]}');

    const diff = await diffScenarios(rootPath, "a", "b");
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("detects added endpoints", async () => {
    const rootPath = await createRoot();
    const meta = { status: 200, mimeType: "application/json", url: "https://api.example.com/users", method: "GET" };

    // Scenario a: empty
    await fs.mkdir(path.join(rootPath, ".wraithwalker", "scenarios", "a"), { recursive: true });
    // Scenario b: has an endpoint
    await writeScenarioFixture(rootPath, "b", "https__app.example.com", "GET", "users__q-abc__b-def", meta, '{"users":[]}');

    const diff = await diffScenarios(rootPath, "a", "b");
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].pathname).toBe("/users");
    expect(diff.removed).toHaveLength(0);
  });

  it("detects removed endpoints", async () => {
    const rootPath = await createRoot();
    const meta = { status: 200, mimeType: "application/json", url: "https://api.example.com/users", method: "GET" };

    await writeScenarioFixture(rootPath, "a", "https__app.example.com", "GET", "users__q-abc__b-def", meta, '{"users":[]}');
    await fs.mkdir(path.join(rootPath, ".wraithwalker", "scenarios", "b"), { recursive: true });

    const diff = await diffScenarios(rootPath, "a", "b");
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].pathname).toBe("/users");
    expect(diff.added).toHaveLength(0);
  });

  it("detects changed status codes and body content", async () => {
    const rootPath = await createRoot();
    const metaA = { status: 200, mimeType: "application/json", url: "https://api.example.com/users", method: "GET" };
    const metaB = { status: 500, mimeType: "application/json", url: "https://api.example.com/users", method: "GET" };

    await writeScenarioFixture(rootPath, "a", "https__app.example.com", "GET", "users__q-abc__b-def", metaA, '{"users":[]}');
    await writeScenarioFixture(rootPath, "b", "https__app.example.com", "GET", "users__q-abc__b-def", metaB, '{"error":"internal"}');

    const diff = await diffScenarios(rootPath, "a", "b");
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
    const rootPath = await createRoot();
    // Neither scenario exists as populated directories
    await fs.mkdir(path.join(rootPath, ".wraithwalker", "scenarios", "empty-a"), { recursive: true });
    await fs.mkdir(path.join(rootPath, ".wraithwalker", "scenarios", "empty-b"), { recursive: true });

    const diff = await diffScenarios(rootPath, "empty-a", "empty-b");
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("handles fixtures with missing body files", async () => {
    const rootPath = await createRoot();
    const meta = { status: 200, mimeType: "application/json", url: "https://api.example.com/users", method: "GET" };

    // Scenario a: has body, scenario b: no body file
    await writeScenarioFixture(rootPath, "a", "https__app.example.com", "GET", "users__q-abc__b-def", meta, '{"data":1}');

    const baseB = path.join(rootPath, ".wraithwalker", "scenarios", "b", "https__app.example.com", "origins", "https__app.example.com", "http", "GET", "users__q-abc__b-def");
    await fs.mkdir(baseB, { recursive: true });
    await fs.writeFile(path.join(baseB, "response.meta.json"), JSON.stringify(meta), "utf8");
    // No response.body

    const diff = await diffScenarios(rootPath, "a", "b");
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].bodyChanged).toBe(true);
  });

  it("renders no-differences message", () => {
    const diff = { scenarioA: "a", scenarioB: "b", added: [], removed: [], changed: [] };
    const markdown = renderDiffMarkdown(diff);
    expect(markdown).toContain("No differences found.");
  });
});
