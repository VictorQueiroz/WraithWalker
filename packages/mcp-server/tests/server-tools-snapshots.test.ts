import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";

import { saveScenario } from "@wraithwalker/core/scenarios";

import { createServerRootRuntime } from "../src/root-runtime.mts";
import { registerSnapshotTools } from "../src/server-tools-snapshots.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function createToolRegistry() {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool(
      name: string,
      _description: string,
      _schema: unknown,
      handler: ToolHandler
    ) {
      handlers.set(name, handler);
    }
  } as unknown as McpServer;

  return {
    server,
    async callTool(name: string, args: Record<string, unknown>) {
      const handler = handlers.get(name);
      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }

      return handler(args);
    }
  };
}

function readJson(result: ToolResult) {
  return JSON.parse(result.content[0]?.text ?? "null");
}

function readText(result: ToolResult) {
  return result.content[0]?.text ?? "";
}

describe("snapshot tool registration", () => {
  it("lists snapshot metadata and preserves legacy snapshots", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-snapshot-tools-"
    });
    const runtime = createServerRootRuntime({
      rootPath: root.rootPath,
      sentinel: root.sentinel
    });
    const registry = createToolRegistry();

    await saveScenario({
      path: root.rootPath,
      expectedRootId: root.rootId,
      name: "modern",
      createdAt: "2026-04-14T00:00:00.000Z",
      description: "Saved after refreshing the fixtures."
    });
    await root.ensureScenario("legacy");

    registerSnapshotTools(registry.server, root.rootPath, {
      runtime
    });

    expect(readJson(await registry.callTool("list-snapshots", {}))).toEqual({
      scenarios: ["modern", "legacy"],
      snapshots: [
        expect.objectContaining({
          name: "modern",
          source: "manual",
          hasMetadata: true,
          description: "Saved after refreshing the fixtures.",
          isActive: false
        }),
        {
          name: "legacy",
          source: "unknown",
          hasMetadata: false,
          isActive: false
        }
      ]
    });
  });

  it("saves a trace as a snapshot with provenance metadata", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-snapshot-tools-"
    });
    const runtime = createServerRootRuntime({
      rootPath: root.rootPath,
      sentinel: root.sentinel
    });
    const registry = createToolRegistry();

    await runtime.startTrace({
      traceId: "trace-guided",
      name: "Guided settings trace",
      goal: "Capture the settings save workflow.",
      selectedOrigins: ["https://app.example.com"],
      extensionClientId: "client-1",
      createdAt: "2026-04-08T00:00:00.000Z"
    });
    await runtime.recordClick({
      traceId: "trace-guided",
      step: {
        stepId: "step-1",
        tabId: 7,
        recordedAt: "2026-04-08T00:00:01.000Z",
        pageUrl: "https://app.example.com/settings",
        topOrigin: "https://app.example.com",
        selector: "#save-button",
        tagName: "button",
        textSnippet: "Save"
      }
    });
    await runtime.stopTrace("trace-guided", "2026-04-08T00:00:03.000Z");

    registerSnapshotTools(registry.server, root.rootPath, {
      runtime
    });

    const result = await registry.callTool("save-trace-as-snapshot", {
      traceId: "trace-guided",
      name: "settings_snapshot"
    });

    expect(result.isError).toBeFalsy();
    expect(readJson(result)).toEqual({
      ok: true,
      name: "settings_snapshot",
      snapshot: expect.objectContaining({
        name: "settings_snapshot",
        source: "trace",
        hasMetadata: true,
        description: "Capture the settings save workflow.",
        isActive: false,
        sourceTrace: expect.objectContaining({
          traceId: "trace-guided",
          stepCount: 1,
          linkedFixtureCount: 0,
          status: "completed"
        })
      })
    });
  });

  it("returns an error when saving a missing trace as a snapshot", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-snapshot-tools-"
    });
    const runtime = createServerRootRuntime({
      rootPath: root.rootPath,
      sentinel: root.sentinel
    });
    const registry = createToolRegistry();

    registerSnapshotTools(registry.server, root.rootPath, {
      runtime
    });

    const result = await registry.callTool("save-trace-as-snapshot", {
      traceId: "missing-trace"
    });

    expect(result.isError).toBe(true);
    expect(readText(result)).toBe('Trace "missing-trace" not found.');
  });

  it("falls back to trace metadata when saving trace snapshots", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-snapshot-tools-"
    });
    const runtime = createServerRootRuntime({
      rootPath: root.rootPath,
      sentinel: root.sentinel
    });
    const registry = createToolRegistry();

    await runtime.startTrace({
      traceId: "trace_goal",
      goal: "Capture the checkout flow.",
      selectedOrigins: ["https://app.example.com"],
      extensionClientId: "client-1",
      createdAt: "2026-04-14T00:00:00.000Z"
    });
    await runtime.stopTrace("trace_goal", "2026-04-14T00:00:01.000Z");

    await runtime.startTrace({
      traceId: "trace_named",
      name: "Named trace",
      selectedOrigins: ["https://app.example.com"],
      extensionClientId: "client-1",
      createdAt: "2026-04-14T00:00:02.000Z"
    });
    await runtime.stopTrace("trace_named", "2026-04-14T00:00:03.000Z");

    await runtime.startTrace({
      traceId: "trace_plain",
      selectedOrigins: ["https://app.example.com"],
      extensionClientId: "client-1",
      createdAt: "2026-04-14T00:00:04.000Z"
    });
    await runtime.stopTrace("trace_plain", "2026-04-14T00:00:05.000Z");

    registerSnapshotTools(registry.server, root.rootPath, {
      runtime
    });

    const goalResult = readJson(
      await registry.callTool("save-trace-as-snapshot", {
        traceId: "trace_goal"
      })
    );
    expect(goalResult).toEqual({
      ok: true,
      name: "trace_goal",
      snapshot: expect.objectContaining({
        name: "trace_goal",
        description: "Capture the checkout flow.",
        source: "trace",
        hasMetadata: true,
        isActive: false
      })
    });

    const namedResult = readJson(
      await registry.callTool("save-trace-as-snapshot", {
        traceId: "trace_named"
      })
    );
    expect(namedResult).toEqual({
      ok: true,
      name: "trace_named",
      snapshot: expect.objectContaining({
        name: "trace_named",
        description: 'Saved from trace "Named trace".',
        source: "trace",
        hasMetadata: true,
        isActive: false
      })
    });

    const plainResult = readJson(
      await registry.callTool("save-trace-as-snapshot", {
        traceId: "trace_plain"
      })
    );
    expect(plainResult).toEqual({
      ok: true,
      name: "trace_plain",
      snapshot: expect.objectContaining({
        name: "trace_plain",
        source: "trace",
        hasMetadata: true,
        isActive: false
      })
    });
    expect(plainResult.snapshot).not.toHaveProperty("description");
  });

  it("diffs snapshots through the tool and annotates missing scenario errors", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-snapshot-tools-"
    });
    const runtime = createServerRootRuntime({
      rootPath: root.rootPath,
      sentinel: root.sentinel
    });
    const registry = createToolRegistry();

    await root.writeApiFixture({
      scenario: "baseline",
      topOrigin: "https://app.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta: {
        status: 200,
        mimeType: "application/json",
        url: "https://api.example.com/users",
        method: "GET"
      },
      body: '{"users":[]}'
    });
    await root.writeApiFixture({
      scenario: "candidate",
      topOrigin: "https://app.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta: {
        status: 500,
        mimeType: "application/json",
        url: "https://api.example.com/users",
        method: "GET"
      },
      body: '{"error":true}'
    });

    registerSnapshotTools(registry.server, root.rootPath, {
      runtime
    });

    const diffResult = await registry.callTool("diff-snapshots", {
      scenarioA: "baseline",
      scenarioB: "candidate"
    });
    expect(diffResult.isError).toBeFalsy();
    expect(readText(diffResult)).toContain("# Fixture Diff: baseline vs candidate");
    expect(readText(diffResult)).toContain("## Changed Endpoints");
    expect(readText(diffResult)).toContain("200 → 500");

    const missingResult = await registry.callTool("diff-snapshots", {
      scenarioA: "baseline",
      scenarioB: "missing"
    });
    expect(missingResult.isError).toBe(true);
    expect(readText(missingResult)).toBe(
      'Error: Scenario "missing" does not exist. Available scenarios: baseline, candidate'
    );
  });

  it("reports missing and invalid diff inputs without changing the error contract", async () => {
    const emptyRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-snapshot-tools-"
    });
    const emptyRuntime = createServerRootRuntime({
      rootPath: emptyRoot.rootPath,
      sentinel: emptyRoot.sentinel
    });
    const emptyRegistry = createToolRegistry();

    registerSnapshotTools(emptyRegistry.server, emptyRoot.rootPath, {
      runtime: emptyRuntime
    });

    const missingResult = await emptyRegistry.callTool("diff-snapshots", {
      scenarioA: "missing_a",
      scenarioB: "missing_b"
    });
    expect(missingResult.isError).toBe(true);
    expect(readText(missingResult)).toBe(
      'Error: Scenario "missing_a" does not exist. No saved scenarios are available.'
    );

    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-snapshot-tools-"
    });
    const runtime = createServerRootRuntime({
      rootPath: root.rootPath,
      sentinel: root.sentinel
    });
    const registry = createToolRegistry();

    await root.ensureScenario("baseline");
    registerSnapshotTools(registry.server, root.rootPath, {
      runtime
    });

    const invalidResult = await registry.callTool("diff-snapshots", {
      scenarioA: "../escape",
      scenarioB: "baseline"
    });
    expect(invalidResult.isError).toBe(true);
    expect(readText(invalidResult)).toBe(
      "Error: Scenario name must be 1-64 alphanumeric, hyphen, or underscore characters."
    );
  });
});
