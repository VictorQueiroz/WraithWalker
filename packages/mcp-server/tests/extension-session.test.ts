import { describe, expect, it } from "vitest";

import { createExtensionSessionTracker, EXTENSION_HEARTBEAT_TTL_MS } from "../src/extension-session.mts";

describe("extension session tracker", () => {
  it("reports disconnected by default and exposes the active trace", async () => {
    const tracker = createExtensionSessionTracker({
      getActiveTrace: async () => ({
        schemaVersion: 1,
        traceId: "trace-1",
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
        activeTrace: expect.objectContaining({ traceId: "trace-1" })
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
      enabledOrigins: ["https://app.example.com"]
    });
    expect(ready).toEqual(
      expect.objectContaining({
        connected: true,
        captureReady: true,
        captureDestination: "server",
        clientId: "client-1",
        enabledOrigins: ["https://app.example.com"],
        siteConfigs: [expect.objectContaining({ origin: "https://app.example.com" })]
      })
    );

    now += EXTENSION_HEARTBEAT_TTL_MS + 1;

    await expect(tracker.getStatus()).resolves.toEqual(
      expect.objectContaining({
        connected: false,
        captureReady: false,
        sessionActive: false,
        captureDestination: "none",
        enabledOrigins: [],
        siteConfigs: []
      })
    );
  });
});
