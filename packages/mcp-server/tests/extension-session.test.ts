import { afterEach, describe, expect, it, vi } from "vitest";

import { createExtensionSessionTracker, EXTENSION_HEARTBEAT_TTL_MS } from "../src/extension-session.mts";

afterEach(() => {
  vi.useRealTimers();
});

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
      getEffectiveSiteConfigs: async () => [
        {
          origin: "https://app.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        },
        {
          origin: "https://prepared.example.com",
          createdAt: "2026-04-08T00:00:01.000Z",
          dumpAllowlistPatterns: ["\\.css$"]
        }
      ],
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
        siteConfigs: [
          expect.objectContaining({ origin: "https://app.example.com" }),
          expect.objectContaining({ origin: "https://prepared.example.com" })
        ],
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

  it("queues commands for the connected client, redelivers them, and resolves waiters on completion", async () => {
    const tracker = createExtensionSessionTracker({
      getActiveTrace: async () => null,
      getEffectiveSiteConfigs: async () => [{
        origin: "https://app.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }],
      now: () => Date.parse("2026-04-08T00:00:00.000Z")
    });

    await tracker.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"]
    });
    const command = tracker.queueCommand({ type: "refresh_config" });
    const resultPromise = tracker.waitForCommandResult(command.commandId, { timeoutMs: 1_000 });

    const firstDelivery = await tracker.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"]
    });
    expect(firstDelivery.commands).toEqual([command]);

    const secondDelivery = await tracker.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"]
    });
    expect(secondDelivery.commands).toEqual([command]);

    const completedCommand = {
      commandId: command.commandId,
      type: "refresh_config" as const,
      ok: true,
      completedAt: "2026-04-08T00:00:05.000Z"
    };
    const afterCompletion = await tracker.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"],
      completedCommands: [completedCommand]
    });

    await expect(resultPromise).resolves.toEqual(completedCommand);
    expect(afterCompletion.commands).toEqual([]);
  });

  it("evicts the oldest completed command results once the retention limit is exceeded", async () => {
    const tracker = createExtensionSessionTracker({
      getActiveTrace: async () => null,
      getEffectiveSiteConfigs: async () => [],
      now: () => Date.parse("2026-04-08T00:00:00.000Z"),
      completedCommandResultLimit: 1
    });

    await tracker.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"]
    });

    const firstCommand = tracker.queueCommand({ type: "refresh_config" });
    const firstResult = {
      commandId: firstCommand.commandId,
      type: "refresh_config" as const,
      ok: true,
      completedAt: "2026-04-08T00:00:01.000Z"
    };
    await tracker.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"],
      completedCommands: [firstResult]
    });
    await expect(tracker.waitForCommandResult(firstCommand.commandId)).resolves.toEqual(firstResult);

    const secondCommand = tracker.queueCommand({ type: "refresh_config" });
    const secondResult = {
      commandId: secondCommand.commandId,
      type: "refresh_config" as const,
      ok: true,
      completedAt: "2026-04-08T00:00:02.000Z"
    };
    await tracker.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"],
      completedCommands: [secondResult]
    });

    await expect(tracker.waitForCommandResult(firstCommand.commandId)).rejects.toThrow(
      `Unknown extension server command: ${firstCommand.commandId}`
    );
    await expect(tracker.waitForCommandResult(secondCommand.commandId)).resolves.toEqual(secondResult);
  });

  it("rejects command queueing when no connected extension client is available", async () => {
    const tracker = createExtensionSessionTracker({
      getActiveTrace: async () => null,
      getEffectiveSiteConfigs: async () => [],
      now: () => Date.parse("2026-04-08T00:00:00.000Z")
    });

    expect(() => tracker.queueCommand({ type: "refresh_config" })).toThrow(
      "No connected browser extension is available to receive server commands."
    );
  });

  it("clears stale queued command state when the client heartbeat expires", async () => {
    let now = Date.parse("2026-04-08T00:00:00.000Z");
    const tracker = createExtensionSessionTracker({
      getActiveTrace: async () => null,
      getEffectiveSiteConfigs: async () => [],
      now: () => now
    });

    await tracker.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"]
    });
    const command = tracker.queueCommand({ type: "refresh_config" });
    const resultPromise = tracker.waitForCommandResult(command.commandId, { timeoutMs: 1_000 });

    now += EXTENSION_HEARTBEAT_TTL_MS + 1;
    await tracker.getStatus();

    await expect(resultPromise).rejects.toThrow(
      "The browser extension heartbeat expired before the queued command completed."
    );
    await expect(tracker.waitForCommandResult(command.commandId)).rejects.toThrow(
      `Unknown extension server command: ${command.commandId}`
    );
  });

  it("clears stale queued command state when a different extension client takes over", async () => {
    const tracker = createExtensionSessionTracker({
      getActiveTrace: async () => null,
      getEffectiveSiteConfigs: async () => [],
      now: () => Date.parse("2026-04-08T00:00:00.000Z")
    });

    await tracker.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"]
    });
    const command = tracker.queueCommand({ type: "refresh_config" });
    const resultPromise = tracker.waitForCommandResult(command.commandId, { timeoutMs: 1_000 });

    const nextHeartbeat = await tracker.heartbeat({
      clientId: "client-2",
      extensionVersion: "1.0.1",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"]
    });

    await expect(resultPromise).rejects.toThrow(
      "The active browser extension client changed from client-1 to client-2."
    );
    expect(nextHeartbeat.commands).toEqual([]);
  });

  it("times out waiting for a queued command result without dropping the pending command", async () => {
    vi.useFakeTimers();

    const tracker = createExtensionSessionTracker({
      getActiveTrace: async () => null,
      getEffectiveSiteConfigs: async () => [],
      now: () => Date.parse("2026-04-08T00:00:00.000Z")
    });

    await tracker.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"]
    });
    const command = tracker.queueCommand({ type: "refresh_config" });
    const resultPromise = tracker.waitForCommandResult(command.commandId, { timeoutMs: 1_000 });
    const timeoutExpectation = expect(resultPromise).rejects.toThrow(
      `Timed out waiting for extension command ${command.commandId} to complete.`
    );

    await vi.advanceTimersByTimeAsync(1_000);

    await timeoutExpectation;
    await expect(tracker.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"]
    })).resolves.toEqual(expect.objectContaining({
      commands: [command]
    }));
  });

  it("ignores stale completion payloads for unknown commands and keeps the real command pending", async () => {
    vi.useFakeTimers();

    const tracker = createExtensionSessionTracker({
      getActiveTrace: async () => null,
      getEffectiveSiteConfigs: async () => [],
      now: () => Date.parse("2026-04-08T00:00:00.000Z")
    });

    await tracker.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"]
    });
    const command = tracker.queueCommand({ type: "refresh_config" });

    const afterStaleCompletion = await tracker.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"],
      completedCommands: [{
        commandId: "missing-command",
        type: "refresh_config",
        ok: false,
        completedAt: "2026-04-08T00:00:05.000Z",
        error: "stale completion"
      }]
    });

    expect(afterStaleCompletion.commands).toEqual([command]);
    const timeoutExpectation = expect(tracker.waitForCommandResult(command.commandId, { timeoutMs: 1 })).rejects.toThrow(
      `Timed out waiting for extension command ${command.commandId} to complete.`
    );
    await vi.advanceTimersByTimeAsync(1);
    await timeoutExpectation;
  });
});
