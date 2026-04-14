import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthorityHarness } from "./helpers/background-authority-test-helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("background authority server sync", () => {
  it("schedules heartbeats without chrome alarms and refreshes the server when the timer fires", async () => {
    vi.useFakeTimers();
    const { chromeApi } = createAuthorityHarness();
    delete (chromeApi as Partial<typeof chromeApi>).alarms;
    const heartbeat = vi.fn().mockResolvedValue({
      version: "1.0.0",
      rootPath: "/tmp/server-root",
      sentinel: { rootId: "server-root" },
      baseUrl: "http://127.0.0.1:4319",
      mcpUrl: "http://127.0.0.1:4319/mcp",
      trpcUrl: "http://127.0.0.1:4319/trpc",
      activeTrace: null,
      siteConfigs: []
    });
    const { authority, serverClient } = createAuthorityHarness({
      chromeApi,
      stateOverrides: {
        sessionActive: true
      },
      serverClientOverrides: {
        heartbeat
      }
    });

    authority.scheduleHeartbeat();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(serverClient.heartbeat).toHaveBeenCalledTimes(1);
  });

  it("processes refresh_config commands, persists a snapshot, and immediately acknowledges completion", async () => {
    const command = {
      commandId: "command-1",
      type: "refresh_config" as const,
      issuedAt: "2026-04-10T00:00:00.000Z"
    };
    const heartbeat = vi
      .fn()
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [
          {
            origin: "https://app.example.com",
            createdAt: "2026-04-10T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ],
        commands: [command]
      })
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [
          {
            origin: "https://app.example.com",
            createdAt: "2026-04-10T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ],
        commands: []
      });
    const setLastSessionSnapshot = vi.fn().mockResolvedValue(undefined);
    const { authority, reconcileTabs, state } = createAuthorityHarness({
      stateOverrides: {
        sessionActive: true,
        enabledOrigins: ["https://app.example.com"],
        siteConfigsByOrigin: new Map([
          [
            "https://app.example.com",
            {
              origin: "https://app.example.com",
              createdAt: "2026-04-10T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.js$"]
            }
          ]
        ])
      },
      serverClientOverrides: {
        heartbeat
      },
      setLastSessionSnapshot
    });

    await authority.refreshServerInfo({ force: true });

    expect(heartbeat).toHaveBeenCalledTimes(2);
    expect(reconcileTabs).toHaveBeenCalledTimes(1);
    expect(setLastSessionSnapshot).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        completedCommands: [
          expect.objectContaining({
            commandId: "command-1",
            type: "refresh_config",
            ok: true
          })
        ]
      })
    );
    expect(state.serverInfo?.rootPath).toBe("/tmp/server-root");
  });

  it("does not rerun duplicate refresh_config commands while the completion result is buffered", async () => {
    const command = {
      commandId: "command-1",
      type: "refresh_config" as const,
      issuedAt: "2026-04-10T00:00:00.000Z"
    };
    const heartbeat = vi
      .fn()
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [],
        commands: [command]
      })
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [],
        commands: [command]
      });
    const setLastSessionSnapshot = vi.fn().mockResolvedValue(undefined);
    const { authority, reconcileTabs } = createAuthorityHarness({
      stateOverrides: {
        sessionActive: true
      },
      serverClientOverrides: {
        heartbeat
      },
      setLastSessionSnapshot
    });

    await authority.refreshServerInfo({ force: true });

    expect(heartbeat).toHaveBeenCalledTimes(2);
    expect(reconcileTabs).toHaveBeenCalledTimes(1);
    expect(setLastSessionSnapshot).toHaveBeenCalledTimes(1);
  });

  it("reruns a recycled refresh_config command id after the earlier completion has been acknowledged", async () => {
    const command = {
      commandId: "command-1",
      type: "refresh_config" as const,
      issuedAt: "2026-04-10T00:00:00.000Z"
    };
    const heartbeat = vi
      .fn()
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [],
        commands: [command]
      })
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [],
        commands: []
      })
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [],
        commands: [command]
      })
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [],
        commands: []
      });
    const setLastSessionSnapshot = vi.fn().mockResolvedValue(undefined);
    const { authority, reconcileTabs } = createAuthorityHarness({
      stateOverrides: {
        sessionActive: true
      },
      serverClientOverrides: {
        heartbeat
      },
      setLastSessionSnapshot
    });

    await authority.refreshServerInfo({ force: true });
    await authority.refreshServerInfo({ force: true });

    expect(heartbeat).toHaveBeenCalledTimes(4);
    expect(reconcileTabs).toHaveBeenCalledTimes(2);
    expect(setLastSessionSnapshot).toHaveBeenCalledTimes(2);
    expect(heartbeat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        completedCommands: [
          expect.objectContaining({
            commandId: "command-1",
            type: "refresh_config",
            ok: true
          })
        ]
      })
    );
    expect(heartbeat).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        completedCommands: [
          expect.objectContaining({
            commandId: "command-1",
            type: "refresh_config",
            ok: true
          })
        ]
      })
    );
  });

  it("reports failed refresh_config execution and acknowledges the error result", async () => {
    const command = {
      commandId: "command-1",
      type: "refresh_config" as const,
      issuedAt: "2026-04-10T00:00:00.000Z"
    };
    const heartbeat = vi
      .fn()
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [
          {
            origin: "https://app.example.com",
            createdAt: "2026-04-10T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ],
        commands: [command]
      })
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [
          {
            origin: "https://app.example.com",
            createdAt: "2026-04-10T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ],
        commands: []
      });
    const setLastSessionSnapshot = vi.fn().mockResolvedValue(undefined);
    const setLastError = vi.fn();
    const reconcileTabs = vi
      .fn()
      .mockRejectedValue(new Error("tab sync failed"));
    const { authority } = createAuthorityHarness({
      stateOverrides: {
        sessionActive: true,
        enabledOrigins: ["https://app.example.com"],
        siteConfigsByOrigin: new Map([
          [
            "https://app.example.com",
            {
              origin: "https://app.example.com",
              createdAt: "2026-04-10T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.js$"]
            }
          ]
        ])
      },
      serverClientOverrides: {
        heartbeat
      },
      setLastSessionSnapshot,
      setLastError,
      reconcileTabs
    });

    await authority.refreshServerInfo({ force: true });

    expect(reconcileTabs).toHaveBeenCalledTimes(1);
    expect(setLastSessionSnapshot).not.toHaveBeenCalled();
    expect(setLastError).toHaveBeenCalledWith("tab sync failed");
    expect(heartbeat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        completedCommands: [
          expect.objectContaining({
            commandId: "command-1",
            type: "refresh_config",
            ok: false,
            error: "tab sync failed"
          })
        ]
      })
    );
  });

  it("processes refresh_config commands while the session is inactive without reconciling tabs", async () => {
    const command = {
      commandId: "command-1",
      type: "refresh_config" as const,
      issuedAt: "2026-04-10T00:00:00.000Z"
    };
    const heartbeat = vi
      .fn()
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [
          {
            origin: "https://app.example.com",
            createdAt: "2026-04-10T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ],
        commands: [command]
      })
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [
          {
            origin: "https://app.example.com",
            createdAt: "2026-04-10T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ],
        commands: []
      });
    const setLastSessionSnapshot = vi.fn().mockResolvedValue(undefined);
    const { authority, reconcileTabs } = createAuthorityHarness({
      serverClientOverrides: {
        heartbeat
      },
      setLastSessionSnapshot
    });

    await authority.refreshServerInfo({ force: true });

    expect(reconcileTabs).not.toHaveBeenCalled();
    expect(setLastSessionSnapshot).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        completedCommands: [
          expect.objectContaining({
            commandId: "command-1",
            type: "refresh_config",
            ok: true
          })
        ]
      })
    );
  });

  it("retries a completed refresh_config acknowledgement after the immediate follow-up heartbeat fails", async () => {
    const command = {
      commandId: "command-1",
      type: "refresh_config" as const,
      issuedAt: "2026-04-10T00:00:00.000Z"
    };
    const heartbeat = vi
      .fn()
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [],
        commands: [command]
      })
      .mockRejectedValueOnce(new Error("ack transport failed"))
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [],
        commands: []
      });
    const setLastSessionSnapshot = vi.fn().mockResolvedValue(undefined);
    const { authority, state } = createAuthorityHarness({
      serverClientOverrides: {
        heartbeat
      },
      setLastSessionSnapshot
    });

    await expect(
      authority.refreshServerInfo({ force: true })
    ).resolves.toBeNull();
    expect(state.serverInfo).toBeNull();

    await authority.refreshServerInfo({ force: true });

    expect(setLastSessionSnapshot).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        completedCommands: [
          expect.objectContaining({
            commandId: "command-1",
            type: "refresh_config",
            ok: true
          })
        ]
      })
    );
    expect(heartbeat).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        completedCommands: [
          expect.objectContaining({
            commandId: "command-1",
            type: "refresh_config",
            ok: true
          })
        ]
      })
    );
    expect(state.serverInfo?.rootPath).toBe("/tmp/server-root");
  });

  it("keeps idle polling alive while the server is connected and stops after the server goes offline", async () => {
    vi.useFakeTimers();
    const heartbeat = vi
      .fn()
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: []
      })
      .mockRejectedValueOnce(new Error("offline"));
    const { authority, state } = createAuthorityHarness({
      serverClientOverrides: {
        heartbeat
      }
    });

    await authority.refreshServerInfo({ force: true });
    expect(state.serverInfo?.rootPath).toBe("/tmp/server-root");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    expect(state.serverInfo).toBeNull();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  it("restores local state and reconciles active sessions when the server goes offline", async () => {
    const syncTraceBindings = vi.fn().mockResolvedValue(undefined);
    const reconcileTabs = vi.fn().mockResolvedValue(undefined);
    const { authority, state } = createAuthorityHarness({
      stateOverrides: {
        sessionActive: true,
        serverInfo: {
          rootPath: "/tmp/server-root",
          sentinel: { rootId: "server-root" },
          baseUrl: "http://127.0.0.1:4319",
          mcpUrl: "http://127.0.0.1:4319/mcp",
          trpcUrl: "http://127.0.0.1:4319/trpc"
        },
        activeTrace: {
          schemaVersion: 2,
          traceId: "trace-1",
          status: "armed",
          createdAt: "2026-04-09T00:00:00.000Z",
          rootId: "server-root",
          selectedOrigins: ["https://server.example.com"],
          extensionClientId: "client-1",
          steps: []
        },
        enabledOrigins: ["https://server.example.com"],
        siteConfigsByOrigin: new Map([
          [
            "https://server.example.com",
            {
              origin: "https://server.example.com",
              createdAt: "2026-04-09T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.js$"]
            }
          ]
        ]),
        localRootReady: true,
        localRootSentinel: { rootId: "local-root" },
        localEnabledOrigins: ["https://local.example.com"],
        localSiteConfigsByOrigin: new Map([
          [
            "https://local.example.com",
            {
              origin: "https://local.example.com",
              createdAt: "2026-04-09T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.css$"]
            }
          ]
        ])
      },
      syncTraceBindings,
      reconcileTabs
    });

    authority.markServerOffline();
    await Promise.resolve();

    expect(state.serverInfo).toBeNull();
    expect(state.activeTrace).toBeNull();
    expect(state.enabledOrigins).toEqual(["https://local.example.com"]);
    expect(state.rootSentinel).toEqual({ rootId: "local-root" });
    expect(syncTraceBindings).toHaveBeenCalled();
    expect(reconcileTabs).toHaveBeenCalled();
  });
});
