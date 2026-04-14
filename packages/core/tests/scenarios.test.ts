import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildScenarioSnapshotSourceTrace,
  diffScenarios,
  listScenarioPanelState,
  listScenarioSnapshots,
  listScenarios,
  readActiveScenarioMarker,
  readScenarioSnapshot,
  renderDiffMarkdown,
  saveScenario,
  switchScenario,
  writeActiveScenarioMarker
} from "../src/scenarios.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

describe("scenario operations", () => {
  it("saves, lists, reads metadata for, and switches scenarios", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });
    await root.writeText("cdn.example.com/assets/app.js", "console.log('v1');");
    await root.writeText(".cursorrules", "version 1");

    await saveScenario({
      path: root.rootPath,
      expectedRootId: root.rootId,
      name: "v1",
      createdAt: "2026-04-08T00:00:00.000Z"
    });
    const v1Snapshot = await readScenarioSnapshot(root.rootPath, "v1");
    expect(v1Snapshot).toEqual(
      expect.objectContaining({
        name: "v1",
        source: "manual",
        hasMetadata: true,
        rootId: root.rootId
      })
    );

    await root.writeText("cdn.example.com/assets/app.js", "console.log('v2');");
    await root.writeText(".cursorrules", "version 2");
    await saveScenario({
      path: root.rootPath,
      expectedRootId: root.rootId,
      name: "v2",
      createdAt: "2026-04-08T00:00:01.000Z"
    });

    expect(await listScenarios(root.rootPath)).toEqual(["v1", "v2"]);
    expect(await listScenarioSnapshots(root.rootPath)).toEqual([
      expect.objectContaining({
        name: "v2",
        source: "manual",
        hasMetadata: true,
        isActive: false
      }),
      expect.objectContaining({
        name: "v1",
        source: "manual",
        hasMetadata: true,
        isActive: false
      })
    ]);

    const result = await switchScenario({
      path: root.rootPath,
      expectedRootId: root.rootId,
      name: "v1"
    });
    expect(result).toEqual({ ok: true, name: "v1" });
    expect(await readActiveScenarioMarker(root.rootPath)).toEqual({
      schemaVersion: 1,
      name: "v1",
      rootId: root.rootId,
      updatedAt: expect.any(String)
    });
    expect(await listScenarioSnapshots(root.rootPath)).toEqual([
      expect.objectContaining({
        name: "v1",
        isActive: true
      }),
      expect.objectContaining({
        name: "v2",
        isActive: false
      })
    ]);
    expect(
      await fs.readFile(root.resolve("cdn.example.com/assets/app.js"), "utf8")
    ).toBe("console.log('v1');");
    expect(await fs.readFile(root.resolve(".cursorrules"), "utf8")).toBe(
      "version 1"
    );
    await expect(fs.access(root.resolve("scenario.json"))).rejects.toThrow();
  });

  it("validates required scenario inputs", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });
    await expect(
      saveScenario({ path: root.rootPath, name: "test" })
    ).rejects.toThrow("Expected root ID is required.");
    await expect(
      saveScenario({ expectedRootId: "root", name: "test" })
    ).rejects.toThrow("Root path is required.");
    await expect(
      saveScenario({
        path: root.rootPath,
        expectedRootId: "wrong",
        name: "test"
      })
    ).rejects.toThrow("Sentinel root ID mismatch");
    await expect(
      saveScenario({
        path: root.rootPath,
        expectedRootId: "wrong",
        name: "../escape"
      })
    ).rejects.toThrow("Sentinel root ID mismatch");
    await expect(
      saveScenario({
        path: root.rootPath,
        expectedRootId: root.rootId,
        name: "../escape"
      })
    ).rejects.toThrow(
      "Scenario name must be 1-64 alphanumeric, hyphen, or underscore characters."
    );
    await expect(
      switchScenario({
        path: root.rootPath,
        expectedRootId: root.rootId,
        name: "missing"
      })
    ).rejects.toThrow('Scenario "missing" does not exist.');
  });

  it("stores trace provenance in snapshot metadata and falls back for legacy scenarios", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });

    await root.writeText(
      "cdn.example.com/assets/app.js",
      "console.log('trace');"
    );

    const sourceTrace = buildScenarioSnapshotSourceTrace({
      schemaVersion: 2,
      traceId: "trace-guided",
      name: "Guided settings trace",
      goal: "Capture the settings save workflow.",
      status: "completed",
      createdAt: "2026-04-08T00:00:00.000Z",
      startedAt: "2026-04-08T00:00:01.000Z",
      endedAt: "2026-04-08T00:00:03.000Z",
      rootId: root.rootId,
      selectedOrigins: ["https://app.example.com"],
      extensionClientId: "client-1",
      steps: [
        {
          stepId: "step-1",
          tabId: 7,
          recordedAt: "2026-04-08T00:00:01.000Z",
          pageUrl: "https://app.example.com/settings",
          topOrigin: "https://app.example.com",
          selector: "#save-button",
          tagName: "button",
          textSnippet: "Save",
          linkedFixtures: [
            {
              bodyPath: "cdn.example.com/assets/app.js",
              requestUrl: "https://cdn.example.com/assets/app.js",
              resourceType: "Script",
              capturedAt: "2026-04-08T00:00:02.000Z"
            }
          ]
        }
      ]
    });

    await saveScenario({
      path: root.rootPath,
      expectedRootId: root.rootId,
      name: "trace_snapshot",
      description: "Saved after guiding the settings save flow.",
      createdAt: "2026-04-08T00:00:04.000Z",
      sourceTrace
    });

    expect(await readScenarioSnapshot(root.rootPath, "trace_snapshot")).toEqual(
      expect.objectContaining({
        name: "trace_snapshot",
        source: "trace",
        description: "Saved after guiding the settings save flow.",
        sourceTrace: expect.objectContaining({
          traceId: "trace-guided",
          stepCount: 1,
          linkedFixtureCount: 1
        })
      })
    );

    await root.ensureScenario("legacy");
    expect(await readScenarioSnapshot(root.rootPath, "legacy")).toEqual({
      name: "legacy",
      source: "unknown",
      hasMetadata: false,
      isActive: false
    });
  });

  it("writes and reads the active marker without clearing stale references", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });

    await root.ensureScenario("baseline");
    await writeActiveScenarioMarker({
      path: root.rootPath,
      expectedRootId: root.rootId,
      name: "baseline",
      createdAt: "2026-04-09T00:00:00.000Z"
    });

    expect(await readActiveScenarioMarker(root.rootPath)).toEqual({
      schemaVersion: 1,
      name: "baseline",
      rootId: root.rootId,
      updatedAt: "2026-04-09T00:00:00.000Z"
    });

    await writeActiveScenarioMarker({
      path: root.rootPath,
      expectedRootId: root.rootId,
      name: "missing_snapshot",
      createdAt: "2026-04-09T00:00:01.000Z"
    });

    expect(await listScenarioPanelState(root.rootPath)).toEqual({
      snapshots: [
        {
          name: "baseline",
          source: "unknown",
          hasMetadata: false,
          isActive: false
        }
      ],
      activeScenarioName: "missing_snapshot",
      activeScenarioMissing: true
    });
  });

  it("does not update the active marker when manually saving a new snapshot", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });

    await root.writeText("cdn.example.com/assets/app.js", "console.log('a');");
    await saveScenario({
      path: root.rootPath,
      expectedRootId: root.rootId,
      name: "baseline",
      createdAt: "2026-04-09T00:00:00.000Z"
    });
    await switchScenario({
      path: root.rootPath,
      expectedRootId: root.rootId,
      name: "baseline"
    });

    await root.writeText("cdn.example.com/assets/app.js", "console.log('b');");
    await saveScenario({
      path: root.rootPath,
      expectedRootId: root.rootId,
      name: "candidate",
      description: "Manual follow-up snapshot.",
      createdAt: "2026-04-09T00:00:01.000Z"
    });

    expect(await listScenarioPanelState(root.rootPath)).toEqual({
      snapshots: [
        expect.objectContaining({
          name: "baseline",
          isActive: true
        }),
        expect.objectContaining({
          name: "candidate",
          description: "Manual follow-up snapshot.",
          isActive: false
        })
      ],
      activeScenarioName: "baseline",
      activeScenarioMissing: false
    });
  });

  it("normalizes active marker shapes, metadata summaries, and snapshot ordering", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });

    await root.ensureScenario("alpha_undated");
    await root.ensureScenario("beta_dated_old");
    await root.ensureScenario("gamma_dated_new");
    await root.ensureScenario("delta_active");
    await root.ensureScenario("epsilon_weird");
    await root.ensureScenario("eta_same_date");
    await root.ensureScenario("trace_mixed");
    await root.ensureScenario("trace_partial");
    await root.ensureScenario("zeta_same_date");

    await root.writeJson(
      path.join(
        ".wraithwalker",
        "scenarios",
        "beta_dated_old",
        "scenario.json"
      ),
      {
        schemaVersion: 1,
        name: "beta_dated_old",
        createdAt: "2026-04-10T00:00:00.000Z",
        rootId: root.rootId,
        source: "manual"
      }
    );
    await root.writeJson(
      path.join(
        ".wraithwalker",
        "scenarios",
        "gamma_dated_new",
        "scenario.json"
      ),
      {
        schemaVersion: 1,
        name: "gamma_dated_new",
        createdAt: "2026-04-11T00:00:00.000Z",
        rootId: root.rootId,
        source: "manual"
      }
    );
    await root.writeJson(
      path.join(".wraithwalker", "scenarios", "eta_same_date", "scenario.json"),
      {
        schemaVersion: 1,
        name: "eta_same_date",
        createdAt: "2026-04-11T12:00:00.000Z",
        rootId: root.rootId,
        source: "manual"
      }
    );
    await root.writeJson(
      path.join(".wraithwalker", "scenarios", "epsilon_weird", "scenario.json"),
      {
        name: "epsilon_weird",
        source: "mystery",
        description: "   ",
        sourceTrace: {
          traceId: "trace-invalid",
          createdAt: "2026-04-10T00:00:00.000Z",
          status: "completed"
        }
      }
    );
    await root.writeJson(
      path.join(".wraithwalker", "scenarios", "trace_mixed", "scenario.json"),
      {
        schemaVersion: 1,
        name: "trace_mixed",
        createdAt: "2026-04-12T00:00:00.000Z",
        rootId: root.rootId,
        source: "trace",
        sourceTrace: {
          traceId: "trace-mixed",
          name: "Mixed trace",
          goal: "Capture the mixed path.",
          status: "completed",
          createdAt: "2026-04-12T00:00:00.000Z",
          startedAt: "2026-04-12T00:00:01.000Z",
          endedAt: "2026-04-12T00:00:03.000Z",
          selectedOrigins: ["https://app.example.com", 7, null],
          extensionClientId: "client-1",
          stepCount: 2,
          linkedFixtureCount: 3
        }
      }
    );
    await root.writeJson(
      path.join(".wraithwalker", "scenarios", "trace_partial", "scenario.json"),
      {
        schemaVersion: 1,
        name: "trace_partial",
        rootId: root.rootId,
        source: "trace",
        sourceTrace: {
          traceId: "trace-partial",
          status: "recording",
          createdAt: "2026-04-12T00:00:05.000Z",
          selectedOrigins: ["https://app.example.com", null],
          extensionClientId: "client-2",
          stepCount: 0,
          linkedFixtureCount: 0
        }
      }
    );
    await root.writeJson(
      path.join(
        ".wraithwalker",
        "scenarios",
        "zeta_same_date",
        "scenario.json"
      ),
      {
        schemaVersion: 1,
        name: "zeta_same_date",
        createdAt: "2026-04-11T12:00:00.000Z",
        rootId: root.rootId,
        source: "manual"
      }
    );
    await root.writeJson(".wraithwalker/scenarios/active.json", {
      name: "delta_active",
      rootId: root.rootId,
      updatedAt: "2026-04-12T00:00:04.000Z"
    });

    expect(await readActiveScenarioMarker(root.rootPath)).toEqual({
      schemaVersion: 1,
      name: "delta_active",
      rootId: root.rootId,
      updatedAt: "2026-04-12T00:00:04.000Z"
    });

    expect(await readScenarioSnapshot(root.rootPath, "epsilon_weird")).toEqual({
      name: "epsilon_weird",
      source: "unknown",
      hasMetadata: true,
      isActive: false
    });
    expect(await readScenarioSnapshot(root.rootPath, "trace_mixed")).toEqual({
      name: "trace_mixed",
      schemaVersion: 1,
      createdAt: "2026-04-12T00:00:00.000Z",
      rootId: root.rootId,
      source: "trace",
      hasMetadata: true,
      isActive: false,
      sourceTrace: {
        traceId: "trace-mixed",
        name: "Mixed trace",
        goal: "Capture the mixed path.",
        status: "completed",
        createdAt: "2026-04-12T00:00:00.000Z",
        startedAt: "2026-04-12T00:00:01.000Z",
        endedAt: "2026-04-12T00:00:03.000Z",
        selectedOrigins: ["https://app.example.com"],
        extensionClientId: "client-1",
        stepCount: 2,
        linkedFixtureCount: 3
      }
    });
    expect(await readScenarioSnapshot(root.rootPath, "trace_partial")).toEqual({
      name: "trace_partial",
      schemaVersion: 1,
      rootId: root.rootId,
      source: "trace",
      hasMetadata: true,
      isActive: false,
      sourceTrace: {
        traceId: "trace-partial",
        status: "recording",
        createdAt: "2026-04-12T00:00:05.000Z",
        selectedOrigins: ["https://app.example.com"],
        extensionClientId: "client-2",
        stepCount: 0,
        linkedFixtureCount: 0
      }
    });
    expect(
      (await listScenarioSnapshots(root.rootPath)).map(
        (snapshot) => snapshot.name
      )
    ).toEqual([
      "delta_active",
      "trace_mixed",
      "eta_same_date",
      "zeta_same_date",
      "gamma_dated_new",
      "beta_dated_old",
      "alpha_undated",
      "epsilon_weird",
      "trace_partial"
    ]);
  });

  it("returns null for malformed active markers", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });

    for (const marker of [
      {
        name: "../escape",
        rootId: root.rootId,
        updatedAt: "2026-04-09T00:00:00.000Z"
      },
      { name: "baseline", updatedAt: "2026-04-09T00:00:00.000Z" },
      { name: "baseline", rootId: root.rootId }
    ]) {
      await root.writeJson(".wraithwalker/scenarios/active.json", marker);
      expect(await readActiveScenarioMarker(root.rootPath)).toBeNull();
    }
  });

  it("ignores active markers copied from a different root", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });

    await root.ensureScenario("baseline");
    await root.writeJson(".wraithwalker/scenarios/active.json", {
      name: "baseline",
      rootId: "copied-root-id",
      updatedAt: "2026-04-09T00:00:00.000Z"
    });

    expect(await readActiveScenarioMarker(root.rootPath)).toBeNull();
    expect(await listScenarioPanelState(root.rootPath)).toEqual({
      snapshots: [
        {
          name: "baseline",
          source: "unknown",
          hasMetadata: false,
          isActive: false
        }
      ],
      activeScenarioName: null,
      activeScenarioMissing: false
    });
  });

  it("writes an active marker timestamp when createdAt is omitted", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });

    const marker = await writeActiveScenarioMarker({
      path: root.rootPath,
      expectedRootId: root.rootId,
      name: "baseline"
    });

    expect(marker).toEqual({
      schemaVersion: 1,
      name: "baseline",
      rootId: root.rootId,
      updatedAt: expect.any(String)
    });
  });

  it("copies root metadata directories into saved scenarios", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });

    await root.writeJson(".wraithwalker/captures/session.json", {
      capturedAt: "2026-04-09T00:00:00.000Z"
    });
    await root.writeJson(
      ".wraithwalker/manifests/app.example.com/RESOURCE_MANIFEST.json",
      {
        resourcesByPathname: {}
      }
    );

    await saveScenario({
      path: root.rootPath,
      expectedRootId: root.rootId,
      name: "with_root_metadata",
      createdAt: "2026-04-09T00:00:02.000Z"
    });

    expect(
      JSON.parse(
        await fs.readFile(
          root.resolve(
            ".wraithwalker/scenarios/with_root_metadata/.wraithwalker/captures/session.json"
          )!,
          "utf8"
        )
      )
    ).toEqual({
      capturedAt: "2026-04-09T00:00:00.000Z"
    });
    expect(
      JSON.parse(
        await fs.readFile(
          root.resolve(
            ".wraithwalker/scenarios/with_root_metadata/.wraithwalker/manifests/app.example.com/RESOURCE_MANIFEST.json"
          )!,
          "utf8"
        )
      )
    ).toEqual({
      resourcesByPathname: {}
    });
  });
});

describe("scenario diffing", () => {
  it("detects added, removed, and changed endpoints", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });
    const meta = {
      status: 200,
      mimeType: "application/json",
      url: "https://api.example.com/users",
      method: "GET"
    };

    await root.writeApiFixture({
      scenario: "a",
      topOrigin: "https://app.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta,
      body: '{"users":[]}'
    });
    await root.writeApiFixture({
      scenario: "b",
      topOrigin: "https://app.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta: { ...meta, status: 500 },
      body: '{"error":true}'
    });
    await root.writeApiFixture({
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
      body: '{"created":true}'
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
      body: '{"created":true}'
    });
    await root.ensureScenario("simple-b");

    const diff = await diffScenarios(root.rootPath, "simple-a", "simple-b");
    expect(diff.removed).toHaveLength(1);

    const markdown = renderDiffMarkdown(diff);
    expect(markdown).toContain("## Removed Endpoints");
    expect(markdown).toContain("Summary: 0 added, 1 removed, 0 changed");
  });

  it("rejects missing or invalid scenario names before diffing", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });
    await root.ensureScenario("baseline");

    await expect(
      diffScenarios(root.rootPath, "baseline", "missing")
    ).rejects.toThrow('Scenario "missing" does not exist.');
    await expect(
      diffScenarios(root.rootPath, "../escape", "baseline")
    ).rejects.toThrow(
      "Scenario name must be 1-64 alphanumeric, hyphen, or underscore characters."
    );
  });

  it("renders no-diff and same-status body-change markdown branches", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-scenarios-"
    });
    await root.ensureScenario("empty_a");
    await root.ensureScenario("empty_b");

    const emptyDiff = await diffScenarios(root.rootPath, "empty_a", "empty_b");
    expect(renderDiffMarkdown(emptyDiff)).toContain("No differences found.");

    await root.writeApiFixture({
      scenario: "same_status_a",
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
      scenario: "same_status_b",
      topOrigin: "https://app.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta: {
        status: 200,
        mimeType: "application/json",
        url: "https://api.example.com/users",
        method: "GET"
      },
      body: '{"users":[1]}'
    });

    const changedDiff = await diffScenarios(
      root.rootPath,
      "same_status_a",
      "same_status_b"
    );
    const markdown = renderDiffMarkdown(changedDiff);
    expect(markdown).toContain("| GET | /users | 200 | Yes |");
    expect(markdown).not.toContain("200 → 200");
  });
});
