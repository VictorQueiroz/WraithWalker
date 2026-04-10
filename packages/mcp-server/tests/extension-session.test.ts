import { describe, expect, it } from "vitest";

import { createExtensionSessionTracker, EXTENSION_HEARTBEAT_TTL_MS } from "../src/extension-session.mts";

describe("extension session tracker", () => {
  it("reports disconnected by default and exposes the active trace", async () => {
    const tracker = createExtensionSessionTracker({
      getActiveTrace: async () => ({
        schemaVersion: 2,
        traceId: "trace-1",
        goal: "Map the disconnected state for agents.",
        status: "armed",
        createdAt: "2026-04-08T00:00:00.000Z",
        rootId: "root-1",
        selectedOrigins: ["https://app.example.com"],
        extensionClientId: "client-1",
        steps: []
      }),
      getEffectiveSiteConfigs: async () => [],
      now: () => 0
    });

    await expect(tracker.getStatus()).resolves.toEqual(
      expect.objectContaining({
        connected: false,
        captureReady: false,
        tracePhase: "disconnected",
        blockingReason: "extension_disconnected",
        recentConsoleEntries: [],
        activeTrace: expect.objectContaining({ traceId: "trace-1" }),
        activeTraceSummary: expect.objectContaining({
          traceId: "trace-1",
          goal: "Map the disconnected state for agents.",
          stepCount: 0,
          linkedFixtureCount: 0
        })
      })
    );
  });

  it("tracks the latest heartbeat and expires it after the ttl", async () => {
    let now = Date.parse("2026-04-08T00:00:00.000Z");
    const tracker = createExtensionSessionTracker({
      getActiveTrace: async () => null,
      getEffectiveSiteConfigs: async () => [{
        origin: "https://app.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }],
      now: () => now
    });

    const ready = await tracker.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"],
      recentConsoleEntries: [{
        tabId: 7,
        topOrigin: "https://app.example.com",
        source: "javascript",
        level: "error",
        text: "Unhandled exception: boom",
        timestamp: "2026-04-08T00:00:00.000Z",
        url: "https://app.example.com/assets/app.js",
        lineNumber: 42,
        columnNumber: 7
      }]
    });
    expect(ready).toEqual(
      expect.objectContaining({
        connected: true,
        captureReady: true,
        tracePhase: "idle",
        captureDestination: "server",
        clientId: "client-1",
        enabledOrigins: ["https://app.example.com"],
        siteConfigs: [expect.objectContaining({ origin: "https://app.example.com" })],
        recentConsoleEntries: [
          expect.objectContaining({
            tabId: 7,
            level: "error",
            text: "Unhandled exception: boom"
          })
        ],
        activeTraceSummary: null
      })
    );

    now += EXTENSION_HEARTBEAT_TTL_MS + 1;

    await expect(tracker.getStatus()).resolves.toEqual(
      expect.objectContaining({
        connected: false,
        captureReady: false,
        sessionActive: false,
        tracePhase: "disconnected",
        blockingReason: "extension_disconnected",
        captureDestination: "none",
        enabledOrigins: [],
        siteConfigs: [],
        recentConsoleEntries: []
      })
    );
  });
});
