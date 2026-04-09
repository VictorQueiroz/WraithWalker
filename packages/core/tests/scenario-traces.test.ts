import { describe, expect, it } from "vitest";

import { createRoot } from "../src/root.mts";
import { createFixtureRootFs, type FixtureRootFs } from "../src/root-fs.mts";
import {
  createScenarioTraceStore,
  normalizeScenarioTraceRecord,
  summarizeScenarioTrace,
  summarizeScenarioTraceForRead,
  type ScenarioTraceStorage
} from "../src/scenario-traces.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

function createStorage(rootFs: FixtureRootFs): ScenarioTraceStorage<FixtureRootFs> {
  return {
    readOptionalJson: (root, relativePath) => root.readOptionalJson(relativePath),
    writeJson: (root, relativePath, value) => root.writeJson(relativePath, value),
    listDirectory: (root, relativePath) => root.listDirectory(relativePath)
  };
}

describe("scenario trace store", () => {
  it("starts, reads, lists, records, links, and stops traces", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-traces-"
    });
    const rootFs = createFixtureRootFs(root.rootPath);
    const store = createScenarioTraceStore({
      root: rootFs,
      storage: createStorage(rootFs),
      ensureReady: () => createRoot(root.rootPath)
    });

    expect(await store.listTraces()).toEqual([]);
    expect(await store.getActiveTrace()).toBeNull();
    expect(await store.readTrace("trace_missing")).toBeNull();

    const trace = await store.startTrace({
      traceId: "trace_1",
      name: "Dropdown Walkthrough",
      goal: "Capture the dropdown interactions that reveal the settings menu.",
      selectedOrigins: ["https://app.example.com"],
      extensionClientId: "client-1",
      createdAt: "2026-04-08T00:00:00.000Z"
    });

    expect(trace).toMatchObject({
      traceId: "trace_1",
      status: "armed",
      goal: "Capture the dropdown interactions that reveal the settings menu.",
      selectedOrigins: ["https://app.example.com"],
      extensionClientId: "client-1",
      steps: []
    });
    expect(await store.getActiveTrace()).toMatchObject({
      traceId: "trace_1",
      status: "armed"
    });
    expect(await store.listTraces()).toEqual([
      expect.objectContaining({
        traceId: "trace_1",
        goal: "Capture the dropdown interactions that reveal the settings menu.",
        stepCount: 0,
        linkedFixtureCount: 0
      })
    ]);

    const recordingTrace = await store.recordClick({
      traceId: "trace_1",
      step: {
        stepId: "step-1",
        tabId: 9,
        recordedAt: "2026-04-08T00:00:01.000Z",
        pageUrl: "https://app.example.com/dashboard",
        topOrigin: "https://app.example.com",
        selector: "#dropdown-trigger",
        tagName: "button",
        textSnippet: "Open menu",
        role: "button",
        ariaLabel: "Open menu",
        href: "https://app.example.com/help"
      }
    });

    expect(recordingTrace).toMatchObject({
      status: "recording",
      startedAt: "2026-04-08T00:00:01.000Z",
      steps: [
        expect.objectContaining({
          stepId: "step-1",
          linkedFixtures: []
        })
      ]
    });

    const linkedResult = await store.linkFixture({
      traceId: "trace_1",
      tabId: 9,
      requestedAt: "2026-04-08T00:00:03.000Z",
      fixture: {
        bodyPath: "cdn.example.com/assets/app.js",
        requestUrl: "https://cdn.example.com/assets/app.js",
        resourceType: "Script",
        capturedAt: "2026-04-08T00:00:04.000Z"
      }
    });

    expect(linkedResult.linked).toBe(true);
    expect(linkedResult.trace?.steps[0]?.linkedFixtures).toEqual([
      {
        bodyPath: "cdn.example.com/assets/app.js",
        requestUrl: "https://cdn.example.com/assets/app.js",
        resourceType: "Script",
        capturedAt: "2026-04-08T00:00:04.000Z"
      }
    ]);
    expect(summarizeScenarioTrace(linkedResult.trace!)).toEqual(
      expect.objectContaining({
        traceId: "trace_1",
        goal: "Capture the dropdown interactions that reveal the settings menu.",
        stepCount: 1,
        linkedFixtureCount: 1,
        lastRecordedAt: "2026-04-08T00:00:01.000Z",
        lastPageUrl: "https://app.example.com/dashboard",
        lastSelector: "#dropdown-trigger",
        lastTextSnippet: "Open menu",
        recentSteps: [
          expect.objectContaining({
            stepId: "step-1",
            linkedFixtureCount: 1
          })
        ]
      })
    );
    expect(summarizeScenarioTraceForRead(linkedResult.trace!)).toEqual(
      expect.objectContaining({
        linkedFixtureCountsByResourceType: {
          Script: 1
        }
      })
    );

    const duplicateLink = await store.linkFixture({
      traceId: "trace_1",
      tabId: 9,
      requestedAt: "2026-04-08T00:00:03.000Z",
      fixture: {
        bodyPath: "cdn.example.com/assets/app.js",
        requestUrl: "https://cdn.example.com/assets/app.js",
        resourceType: "Script",
        capturedAt: "2026-04-08T00:00:04.000Z"
      }
    });
    expect(duplicateLink.linked).toBe(false);

    const completedTrace = await store.stopTrace("trace_1", "2026-04-08T00:00:06.000Z");
    expect(completedTrace).toMatchObject({
      status: "completed",
      endedAt: "2026-04-08T00:00:06.000Z"
    });
    expect(await store.getActiveTrace()).toBeNull();
    expect(await root.readJson(".wraithwalker/scenario-traces/active.json")).toEqual({
      traceId: null,
      updatedAt: "2026-04-08T00:00:06.000Z"
    });

    const armedOnly = await store.startTrace({
      traceId: "trace_armed_only",
      selectedOrigins: [],
      extensionClientId: "client-1",
      createdAt: "2026-04-08T00:01:00.000Z"
    });
    expect(armedOnly.startedAt).toBeUndefined();
    const stoppedArmedOnly = await store.stopTrace("trace_armed_only", "2026-04-08T00:01:05.000Z");
    expect(stoppedArmedOnly).toEqual(
      expect.objectContaining({
        status: "completed",
        startedAt: "2026-04-08T00:01:00.000Z",
        endedAt: "2026-04-08T00:01:05.000Z"
      })
    );
    expect(summarizeScenarioTrace(stoppedArmedOnly)).toEqual(
      expect.objectContaining({
        traceId: "trace_armed_only",
        status: "completed",
        stepCount: 0,
        linkedFixtureCount: 0,
        recentSteps: []
      })
    );
  });

  it("guards invalid ids, duplicate actives, missing traces, and link windows", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-traces-"
    });
    const rootFs = createFixtureRootFs(root.rootPath);
    const store = createScenarioTraceStore({
      root: rootFs,
      storage: createStorage(rootFs),
      ensureReady: () => createRoot(root.rootPath)
    });

    await expect(store.startTrace({
      traceId: "../bad",
      selectedOrigins: [],
      extensionClientId: "client-1"
    })).rejects.toThrow("Trace ID must be 1-128 alphanumeric, hyphen, or underscore characters.");

    await store.startTrace({
      traceId: "trace_2",
      selectedOrigins: [],
      extensionClientId: "client-2",
      createdAt: "2026-04-08T00:00:00.000Z"
    });

    await expect(store.startTrace({
      traceId: "trace_3",
      selectedOrigins: [],
      extensionClientId: "client-2"
    })).rejects.toThrow('Trace "trace_2" is already active.');

    expect(await store.recordClick({
      traceId: "trace_missing",
      step: {
        stepId: "step-missing",
        tabId: 1,
        recordedAt: "2026-04-08T00:00:00.000Z",
        pageUrl: "https://app.example.com",
        topOrigin: "https://app.example.com",
        selector: "#missing",
        tagName: "div",
        textSnippet: ""
      }
    })).toBeNull();

    expect(await store.linkFixture({
      traceId: "trace_2",
      tabId: 1,
      requestedAt: "not-a-date",
      fixture: {
        bodyPath: "cdn.example.com/assets/app.js",
        requestUrl: "https://cdn.example.com/assets/app.js",
        resourceType: "Script",
        capturedAt: "2026-04-08T00:00:04.000Z"
      }
    })).toEqual({
      linked: false,
      trace: expect.objectContaining({ traceId: "trace_2" })
    });

    await store.recordClick({
      traceId: "trace_2",
      step: {
        stepId: "step-2",
        tabId: 1,
        recordedAt: "2026-04-08T00:00:01.000Z",
        pageUrl: "https://app.example.com/a",
        topOrigin: "https://app.example.com",
        selector: "#a",
        tagName: "button",
        textSnippet: "A"
      }
    });
    await store.recordClick({
      traceId: "trace_2",
      step: {
        stepId: "step-3",
        tabId: 1,
        recordedAt: "2026-04-08T00:00:02.000Z",
        pageUrl: "https://app.example.com/b",
        topOrigin: "https://app.example.com",
        selector: "#b",
        tagName: "button",
        textSnippet: "B"
      }
    });
    await store.recordClick({
      traceId: "trace_2",
      step: {
        stepId: "step-other-tab",
        tabId: 2,
        recordedAt: "2026-04-08T00:00:02.500Z",
        pageUrl: "https://app.example.com/other",
        topOrigin: "https://app.example.com",
        selector: "#other",
        tagName: "button",
        textSnippet: "Other"
      }
    });

    await store.recordClick({
      traceId: "trace_2",
      step: {
        stepId: "step-bad-date",
        tabId: 1,
        recordedAt: "not-a-date",
        pageUrl: "https://app.example.com/c",
        topOrigin: "https://app.example.com",
        selector: "#c",
        tagName: "button",
        textSnippet: "C"
      }
    });

    expect(await store.linkFixture({
      traceId: "trace_2",
      tabId: 1,
      requestedAt: "2026-04-08T00:00:08.500Z",
      fixture: {
        bodyPath: "cdn.example.com/assets/late.js",
        requestUrl: "https://cdn.example.com/assets/late.js",
        resourceType: "Script",
        capturedAt: "2026-04-08T00:00:08.500Z"
      }
    })).toEqual({
      linked: false,
      trace: expect.objectContaining({ traceId: "trace_2" })
    });

    const linkedFirstStep = await store.linkFixture({
      traceId: "trace_2",
      tabId: 1,
      requestedAt: "2026-04-08T00:00:01.500Z",
      fixture: {
        bodyPath: "cdn.example.com/assets/first.js",
        requestUrl: "https://cdn.example.com/assets/first.js",
        resourceType: "Script",
        capturedAt: "2026-04-08T00:00:01.500Z"
      }
    });
    expect(linkedFirstStep.linked).toBe(true);
    expect(linkedFirstStep.trace?.steps.find((step) => step.stepId === "step-2")?.linkedFixtures).toEqual([
      expect.objectContaining({
        bodyPath: "cdn.example.com/assets/first.js"
      })
    ]);
    expect(linkedFirstStep.trace?.steps.find((step) => step.stepId === "step-3")?.linkedFixtures).toEqual([]);

    expect(await store.linkFixture({
      traceId: "trace_missing",
      tabId: 1,
      requestedAt: "2026-04-08T00:00:03.000Z",
      fixture: {
        bodyPath: "cdn.example.com/assets/missing.js",
        requestUrl: "https://cdn.example.com/assets/missing.js",
        resourceType: "Script",
        capturedAt: "2026-04-08T00:00:03.000Z"
      }
    })).toEqual({
      linked: false,
      trace: null
    });

    await expect(store.stopTrace("trace_missing")).rejects.toThrow('Trace "trace_missing" does not exist.');
  });

  it("normalizes legacy traces and keeps agent summaries stable across schema versions", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-traces-"
    });
    const rootFs = createFixtureRootFs(root.rootPath);
    const store = createScenarioTraceStore({
      root: rootFs,
      storage: createStorage(rootFs),
      ensureReady: () => createRoot(root.rootPath)
    });

    await root.writeJson(".wraithwalker/scenario-traces/legacy_trace/trace.json", {
      schemaVersion: 1,
      traceId: "legacy_trace",
      name: "Legacy walkthrough",
      status: "recording",
      createdAt: "2026-04-07T00:00:00.000Z",
      startedAt: "2026-04-07T00:00:02.000Z",
      rootId: "root-legacy",
      selectedOrigins: ["https://legacy.example.com"],
      extensionClientId: "client-legacy",
      steps: [{
        stepId: "legacy-step-1",
        tabId: 4,
        recordedAt: "2026-04-07T00:00:02.000Z",
        pageUrl: "https://legacy.example.com/dashboard",
        topOrigin: "https://legacy.example.com",
        selector: "#legacy",
        tagName: "button",
        textSnippet: "Legacy",
        linkedFixtures: [{
          bodyPath: "cdn.example.com/assets/legacy.css",
          requestUrl: "https://cdn.example.com/assets/legacy.css",
          resourceType: "Stylesheet",
          capturedAt: "2026-04-07T00:00:02.500Z"
        }]
      }]
    });

    const legacy = await store.readTrace("legacy_trace");

    expect(legacy).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        traceId: "legacy_trace"
      })
    );
    expect(legacy).not.toHaveProperty("goal");
    expect(await store.listTraces()).toEqual([
      expect.objectContaining({
        traceId: "legacy_trace",
        linkedFixtureCount: 1,
        lastRecordedAt: "2026-04-07T00:00:02.000Z",
        lastPageUrl: "https://legacy.example.com/dashboard"
      })
    ]);
    expect(summarizeScenarioTrace(legacy!)).toEqual(
      expect.objectContaining({
        traceId: "legacy_trace",
        linkedFixtureCount: 1,
        recentSteps: [
          expect.objectContaining({
            stepId: "legacy-step-1",
            linkedFixtureCount: 1
          })
        ]
      })
    );
    expect(summarizeScenarioTraceForRead(legacy!)).toEqual(
      expect.objectContaining({
        linkedFixtureCountsByResourceType: {
          Stylesheet: 1
        }
      })
    );
    expect(normalizeScenarioTraceRecord({
      schemaVersion: 1,
      traceId: "legacy_direct",
      status: "armed",
      createdAt: "2026-04-07T00:00:00.000Z",
      rootId: "root-legacy",
      selectedOrigins: [],
      extensionClientId: "client-legacy",
      steps: []
    })).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        traceId: "legacy_direct",
        steps: []
      })
    );
  });
});
