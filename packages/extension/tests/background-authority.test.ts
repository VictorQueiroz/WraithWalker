import { afterEach, describe, expect, it, vi } from "vitest";

import { createBackgroundAuthority } from "../src/lib/background-authority.js";
import { createBackgroundState, createChromeApi, createMockServerClient } from "./helpers/background-service-test-helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createAuthorityHarness({
  stateOverrides = {},
  chromeApi = createChromeApi(),
  serverClientOverrides = {},
  getSiteConfigs = vi.fn().mockResolvedValue([]),
  getLegacySiteConfigs = vi.fn().mockResolvedValue([]),
  getLegacySiteConfigsMigrated = vi.fn().mockResolvedValue(true),
  getNativeHostConfig = vi.fn().mockResolvedValue({ hostName: "", launchPath: "", editorLaunchOverrides: {} }),
  getOrCreateExtensionClientId = vi.fn().mockResolvedValue("client-1"),
  setLegacySiteConfigsMigrated = vi.fn().mockResolvedValue(undefined),
  setLastSessionSnapshot = vi.fn().mockResolvedValue(undefined),
  normalizeSiteConfigs = vi.fn((siteConfigs) => siteConfigs as any),
  setLastError,
  syncTraceBindings = vi.fn().mockResolvedValue(undefined),
  reconcileTabs = vi.fn().mockResolvedValue(undefined)
}: {
  stateOverrides?: Record<string, unknown>;
  chromeApi?: ReturnType<typeof createChromeApi>;
  serverClientOverrides?: Record<string, unknown>;
  getSiteConfigs?: ReturnType<typeof vi.fn>;
  getLegacySiteConfigs?: ReturnType<typeof vi.fn>;
  getLegacySiteConfigsMigrated?: ReturnType<typeof vi.fn>;
  getNativeHostConfig?: ReturnType<typeof vi.fn>;
  getOrCreateExtensionClientId?: ReturnType<typeof vi.fn>;
  setLegacySiteConfigsMigrated?: ReturnType<typeof vi.fn>;
  setLastSessionSnapshot?: ReturnType<typeof vi.fn>;
  normalizeSiteConfigs?: ReturnType<typeof vi.fn>;
  setLastError?: ReturnType<typeof vi.fn>;
  syncTraceBindings?: ReturnType<typeof vi.fn>;
  reconcileTabs?: ReturnType<typeof vi.fn>;
} = {}) {
  const state = createBackgroundState(stateOverrides as Parameters<typeof createBackgroundState>[0]);
  const appliedSetLastError = setLastError ?? vi.fn((message: string) => {
    state.lastError = message;
  });
  const serverClient = createMockServerClient(serverClientOverrides as Parameters<typeof createMockServerClient>[0]);
  const authority = createBackgroundAuthority({
    state,
    chromeApi,
    serverClient,
    getSiteConfigs,
    getLegacySiteConfigs,
    getLegacySiteConfigsMigrated,
    getNativeHostConfig,
    getOrCreateExtensionClientId,
    setLegacySiteConfigsMigrated,
    setLastSessionSnapshot,
    normalizeSiteConfigs,
    setLastError: appliedSetLastError,
    syncTraceBindings,
    reconcileTabs
  });

  return {
    state,
    chromeApi,
    serverClient,
    authority,
    setLastError: appliedSetLastError,
    setLastSessionSnapshot,
    syncTraceBindings,
    reconcileTabs
  };
}

describe("background authority", () => {
  it("reuses an existing offscreen document instead of creating a second one", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{}]);
    chromeApi.runtime.sendMessage.mockResolvedValue({ ok: true });

    const authority = createBackgroundAuthority({
      state: createBackgroundState(),
      chromeApi,
      serverClient: createMockServerClient(),
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(true),
      getNativeHostConfig: vi.fn().mockResolvedValue({ hostName: "", launchPath: "", editorLaunchOverrides: {} }),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(undefined),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      normalizeSiteConfigs: vi.fn((siteConfigs) => siteConfigs as any),
      setLastError: vi.fn(),
      syncTraceBindings: vi.fn().mockResolvedValue(undefined),
      reconcileTabs: vi.fn().mockResolvedValue(undefined)
    });

    await authority.sendOffscreenMessage("fs.ensureRoot", { requestPermission: true });
    await authority.sendOffscreenMessage("fs.ensureRoot", { requestPermission: false });

    expect(chromeApi.offscreen.createDocument).toHaveBeenCalledTimes(1);
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("falls back to local configured site configs when a server-backed read fails", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return { ok: true, sentinel: { rootId: "local-root" }, permission: "granted" };
      }
      if (message?.type === "fs.readConfiguredSiteConfigs") {
        return {
          ok: true,
          siteConfigs: [{
            origin: "https://local.example.com",
            createdAt: "2026-04-09T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }],
          sentinel: { rootId: "local-root" }
        };
      }
      return { ok: true };
    });

    const authority = createBackgroundAuthority({
      state: createBackgroundState(),
      chromeApi,
      serverClient: createMockServerClient({
        readConfiguredSiteConfigs: vi.fn().mockRejectedValue(new Error("server offline"))
      }),
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(true),
      getNativeHostConfig: vi.fn().mockResolvedValue({ hostName: "", launchPath: "", editorLaunchOverrides: {} }),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(undefined),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      normalizeSiteConfigs: vi.fn((siteConfigs) => siteConfigs as any),
      setLastError: vi.fn(),
      syncTraceBindings: vi.fn().mockResolvedValue(undefined),
      reconcileTabs: vi.fn().mockResolvedValue(undefined)
    });

    const result = await authority.readConfiguredSiteConfigsForAuthority();

    expect(result).toEqual({
      ok: true,
      siteConfigs: [{
        origin: "https://local.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }],
      sentinel: { rootId: "local-root" }
    });
  });

  it("reports missing roots, missing configs, and server disconnects in diagnostics", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return { ok: false, error: "No root directory selected." };
      }
      if (message?.type === "fs.readConfiguredSiteConfigs" || message?.type === "fs.readEffectiveSiteConfigs") {
        return {
          ok: true,
          siteConfigs: [],
          sentinel: { rootId: "local-root" }
        };
      }
      return { ok: true };
    });

    const state = createBackgroundState({
      lastError: "transport unavailable",
      nativeHostConfig: { hostName: "", launchPath: "", editorLaunchOverrides: {} }
    });
    const authority = createBackgroundAuthority({
      state,
      chromeApi,
      serverClient: createMockServerClient({
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      }),
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(true),
      getNativeHostConfig: vi.fn().mockResolvedValue({ hostName: "", launchPath: "", editorLaunchOverrides: {} }),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(undefined),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      normalizeSiteConfigs: vi.fn((siteConfigs) => siteConfigs as any),
      setLastError: vi.fn((message) => {
        state.lastError = message;
      }),
      syncTraceBindings: vi.fn().mockResolvedValue(undefined),
      reconcileTabs: vi.fn().mockResolvedValue(undefined)
    });

    const report = await authority.getDiagnosticsReport();

    expect(report.issues).toEqual(expect.arrayContaining([
      "No active capture root is ready.",
      "No enabled origins are configured.",
      "Native host name is not configured.",
      "Local WraithWalker server is not connected.",
      "Last runtime error: transport unavailable"
    ]));
  });

  it("schedules heartbeats without chrome alarms and refreshes the server when the timer fires", async () => {
    vi.useFakeTimers();
    const chromeApi = createChromeApi();
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
    const heartbeat = vi.fn()
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [{
          origin: "https://app.example.com",
          createdAt: "2026-04-10T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }],
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
        siteConfigs: [{
          origin: "https://app.example.com",
          createdAt: "2026-04-10T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }],
        commands: []
      });
    const setLastSessionSnapshot = vi.fn().mockResolvedValue(undefined);
    const { authority, reconcileTabs, state } = createAuthorityHarness({
      stateOverrides: {
        sessionActive: true,
        enabledOrigins: ["https://app.example.com"],
        siteConfigsByOrigin: new Map([["https://app.example.com", {
          origin: "https://app.example.com",
          createdAt: "2026-04-10T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }]])
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
    expect(heartbeat).toHaveBeenNthCalledWith(2, expect.objectContaining({
      completedCommands: [
        expect.objectContaining({
          commandId: "command-1",
          type: "refresh_config",
          ok: true
        })
      ]
    }));
    expect(state.serverInfo?.rootPath).toBe("/tmp/server-root");
  });

  it("does not rerun duplicate refresh_config commands while the completion result is buffered", async () => {
    const command = {
      commandId: "command-1",
      type: "refresh_config" as const,
      issuedAt: "2026-04-10T00:00:00.000Z"
    };
    const heartbeat = vi.fn()
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
    const heartbeat = vi.fn()
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
    expect(heartbeat).toHaveBeenNthCalledWith(2, expect.objectContaining({
      completedCommands: [
        expect.objectContaining({
          commandId: "command-1",
          type: "refresh_config",
          ok: true
        })
      ]
    }));
    expect(heartbeat).toHaveBeenNthCalledWith(4, expect.objectContaining({
      completedCommands: [
        expect.objectContaining({
          commandId: "command-1",
          type: "refresh_config",
          ok: true
        })
      ]
    }));
  });

  it("reports failed refresh_config execution and acknowledges the error result", async () => {
    const command = {
      commandId: "command-1",
      type: "refresh_config" as const,
      issuedAt: "2026-04-10T00:00:00.000Z"
    };
    const heartbeat = vi.fn()
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [{
          origin: "https://app.example.com",
          createdAt: "2026-04-10T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }],
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
        siteConfigs: [{
          origin: "https://app.example.com",
          createdAt: "2026-04-10T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }],
        commands: []
      });
    const setLastSessionSnapshot = vi.fn().mockResolvedValue(undefined);
    const setLastError = vi.fn();
    const reconcileTabs = vi.fn().mockRejectedValue(new Error("tab sync failed"));
    const { authority } = createAuthorityHarness({
      stateOverrides: {
        sessionActive: true,
        enabledOrigins: ["https://app.example.com"],
        siteConfigsByOrigin: new Map([["https://app.example.com", {
          origin: "https://app.example.com",
          createdAt: "2026-04-10T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }]])
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
    expect(heartbeat).toHaveBeenNthCalledWith(2, expect.objectContaining({
      completedCommands: [
        expect.objectContaining({
          commandId: "command-1",
          type: "refresh_config",
          ok: false,
          error: "tab sync failed"
        })
      ]
    }));
  });

  it("processes refresh_config commands while the session is inactive without reconciling tabs", async () => {
    const command = {
      commandId: "command-1",
      type: "refresh_config" as const,
      issuedAt: "2026-04-10T00:00:00.000Z"
    };
    const heartbeat = vi.fn()
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace: null,
        siteConfigs: [{
          origin: "https://app.example.com",
          createdAt: "2026-04-10T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }],
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
        siteConfigs: [{
          origin: "https://app.example.com",
          createdAt: "2026-04-10T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }],
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
    expect(heartbeat).toHaveBeenNthCalledWith(2, expect.objectContaining({
      completedCommands: [
        expect.objectContaining({
          commandId: "command-1",
          type: "refresh_config",
          ok: true
        })
      ]
    }));
  });

  it("retries a completed refresh_config acknowledgement after the immediate follow-up heartbeat fails", async () => {
    const command = {
      commandId: "command-1",
      type: "refresh_config" as const,
      issuedAt: "2026-04-10T00:00:00.000Z"
    };
    const heartbeat = vi.fn()
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

    await expect(authority.refreshServerInfo({ force: true })).resolves.toBeNull();
    expect(state.serverInfo).toBeNull();

    await authority.refreshServerInfo({ force: true });

    expect(setLastSessionSnapshot).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenNthCalledWith(2, expect.objectContaining({
      completedCommands: [
        expect.objectContaining({
          commandId: "command-1",
          type: "refresh_config",
          ok: true
        })
      ]
    }));
    expect(heartbeat).toHaveBeenNthCalledWith(3, expect.objectContaining({
      completedCommands: [
        expect.objectContaining({
          commandId: "command-1",
          type: "refresh_config",
          ok: true
        })
      ]
    }));
    expect(state.serverInfo?.rootPath).toBe("/tmp/server-root");
  });

  it("keeps idle polling alive while the server is connected and stops after the server goes offline", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn()
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

  it("reuses an in-flight offscreen document creation and waits before closing it", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValueOnce([]);

    let finishCreate: (() => void) | null = null;
    chromeApi.offscreen.createDocument.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finishCreate = resolve;
      });
    });
    chromeApi.runtime.sendMessage.mockResolvedValue({ ok: true });

    const { authority } = createAuthorityHarness({ chromeApi });

    const firstMessage = authority.sendOffscreenMessage("fs.ensureRoot", { requestPermission: true });
    await vi.waitFor(() => {
      expect(chromeApi.offscreen.createDocument).toHaveBeenCalledTimes(1);
      expect(finishCreate).not.toBeNull();
    });
    const secondMessage = authority.sendOffscreenMessage("fs.ensureRoot", { requestPermission: false });
    finishCreate?.();

    await Promise.all([firstMessage, secondMessage]);
    chromeApi.runtime.getContexts.mockResolvedValueOnce([{}]);
    await authority.closeOffscreenDocument();

    expect(chromeApi.offscreen.createDocument).toHaveBeenCalledTimes(1);
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(chromeApi.offscreen.closeDocument).toHaveBeenCalledTimes(1);
  });

  it("propagates unexpected offscreen creation errors", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([]);
    chromeApi.offscreen.createDocument.mockRejectedValue(new Error("Offscreen denied."));

    const { authority } = createAuthorityHarness({ chromeApi });

    await expect(authority.sendOffscreenMessage("fs.ensureRoot")).rejects.toThrow("Offscreen denied.");
  });

  it("restores local state and reconciles active sessions when the server goes offline", async () => {
    const state = createBackgroundState({
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
      siteConfigsByOrigin: new Map([["https://server.example.com", {
        origin: "https://server.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }]]),
      localRootReady: true,
      localRootSentinel: { rootId: "local-root" },
      localEnabledOrigins: ["https://local.example.com"],
      localSiteConfigsByOrigin: new Map([["https://local.example.com", {
        origin: "https://local.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.css$"]
      }]])
    });
    const syncTraceBindings = vi.fn().mockResolvedValue(undefined);
    const reconcileTabs = vi.fn().mockResolvedValue(undefined);
    const authority = createBackgroundAuthority({
      state,
      chromeApi: createChromeApi(),
      serverClient: createMockServerClient(),
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(true),
      getNativeHostConfig: vi.fn().mockResolvedValue({ hostName: "", launchPath: "", editorLaunchOverrides: {} }),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(undefined),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      normalizeSiteConfigs: vi.fn((siteConfigs) => siteConfigs as any),
      setLastError: vi.fn((message) => {
        state.lastError = message;
      }),
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

  it("returns local-root errors when no offscreen root result is available", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockResolvedValue(null);
    const { authority, setLastError } = createAuthorityHarness({ chromeApi });

    await expect(authority.ensureLocalRootReady()).resolves.toEqual({
      ok: false,
      error: "No root directory selected."
    });
    expect(setLastError).toHaveBeenCalledWith("No root directory selected.");
  });

  it("surfaces repository fallback errors and incomplete fixture reads", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    const responses = new Map<string, unknown>([
      ["fs.hasFixture", { ok: false, error: "Fixture lookup failed." }],
      ["fs.readFixture", { ok: true, exists: true, meta: { status: 200 }, bodyBase64: "Yg==" }],
      ["fs.writeFixture", { ok: false, error: "Fixture write failed." }]
    ]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => responses.get(String((message as { type?: string }).type)));
    const { authority } = createAuthorityHarness({
      chromeApi,
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      }
    });

    await expect(authority.repository.exists({
      requestUrl: "https://cdn.example.com/app.js",
      bodyPath: "assets/app.js"
    } as any)).rejects.toThrow("Fixture lookup failed.");
    await expect(authority.repository.read({
      requestUrl: "https://cdn.example.com/app.js",
      bodyPath: "assets/app.js"
    } as any)).resolves.toBeNull();
    await expect(authority.repository.writeIfAbsent({
      descriptor: {
        requestUrl: "https://cdn.example.com/app.js",
        bodyPath: "assets/app.js"
      } as any,
      request: {
        method: "GET",
        url: "https://cdn.example.com/app.js",
        headers: [],
        body: "",
        bodyEncoding: "utf8"
      } as any,
      response: {
        body: "body",
        bodyEncoding: "utf8",
        meta: {
          status: 200,
          statusText: "OK",
          headers: []
        } as any
      }
    })).rejects.toThrow("Fixture write failed.");
  });

  it("rejects fixture reads when the local fallback reports an explicit read error", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.readFixture") {
        return { ok: false, error: "Fixture read failed." };
      }
      return { ok: true };
    });
    const { authority } = createAuthorityHarness({
      chromeApi,
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      }
    });

    await expect(authority.repository.read({
      requestUrl: "https://cdn.example.com/app.js",
      bodyPath: "assets/app.js"
    } as any)).rejects.toThrow("Fixture read failed.");
  });

  it("throws a combined error when the server is unavailable and no fallback root is ready", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return { ok: false, error: "Permission denied." };
      }
      return { ok: true };
    });
    const { authority } = createAuthorityHarness({
      chromeApi,
      stateOverrides: {
        serverInfo: {
          rootPath: "/tmp/server-root",
          sentinel: { rootId: "server-root" },
          baseUrl: "http://127.0.0.1:4319",
          mcpUrl: "http://127.0.0.1:4319/mcp",
          trpcUrl: "http://127.0.0.1:4319/trpc"
        },
        serverCheckedAt: Date.now()
      }
    });

    await expect(authority.withServerFallback({
      remoteOperation: async () => {
        throw new Error("server offline");
      },
      localOperation: async () => "local"
    })).rejects.toThrow("Local WraithWalker server is unavailable and no fallback root is ready. server offline");
  });

  it("writes configured site configs locally and reconciles active tabs when local mode is active", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return { ok: true, sentinel: { rootId: "local-root" }, permission: "granted" };
      }
      if (message?.type === "fs.writeConfiguredSiteConfigs") {
        return {
          ok: true,
          siteConfigs: [{
            origin: "https://local.example.com",
            createdAt: "2026-04-09T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }],
          sentinel: { rootId: "local-root" }
        };
      }
      return { ok: true };
    });

    const reconcileTabs = vi.fn().mockResolvedValue(undefined);
    const { authority } = createAuthorityHarness({
      chromeApi,
      stateOverrides: {
        sessionActive: true
      },
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      },
      reconcileTabs
    });

    const result = await authority.writeConfiguredSiteConfigsForAuthority([{
      origin: "https://local.example.com",
      createdAt: "2026-04-09T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.js$"]
    }]);

    expect(result).toEqual({
      ok: true,
      siteConfigs: [{
        origin: "https://local.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }],
      sentinel: { rootId: "local-root" }
    });
    expect(reconcileTabs).toHaveBeenCalled();
  });

  it("falls back to local configured-site writes when a server write fails", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return { ok: true, sentinel: { rootId: "local-root" }, permission: "granted" };
      }
      if (message?.type === "fs.writeConfiguredSiteConfigs") {
        return {
          ok: true,
          siteConfigs: [{
            origin: "https://fallback.example.com",
            createdAt: "2026-04-09T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.css$"]
          }],
          sentinel: { rootId: "local-root" }
        };
      }
      return { ok: true };
    });
    const reconcileTabs = vi.fn().mockResolvedValue(undefined);
    const { authority } = createAuthorityHarness({
      chromeApi,
      stateOverrides: {
        sessionActive: true
      },
      serverClientOverrides: {
        writeConfiguredSiteConfigs: vi.fn().mockRejectedValue(new Error("server write failed"))
      },
      reconcileTabs
    });

    const result = await authority.writeConfiguredSiteConfigsForAuthority([{
      origin: "https://fallback.example.com",
      createdAt: "2026-04-09T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.css$"]
    }]);

    expect(result).toEqual({
      ok: true,
      siteConfigs: [{
        origin: "https://fallback.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.css$"]
      }],
      sentinel: { rootId: "local-root" }
    });
    expect(reconcileTabs).toHaveBeenCalled();
  });

  it("refreshes local state from offscreen storage and preserves the prior version when the manifest omits one", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getManifest = vi.fn(() => ({}));
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.readEffectiveSiteConfigs") {
        return {
          ok: true,
          siteConfigs: [{
            origin: "https://local.example.com",
            createdAt: "2026-04-09T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }],
          sentinel: { rootId: "local-root" }
        };
      }
      return { ok: true };
    });
    const state = createBackgroundState({
      extensionVersion: "9.9.9"
    });
    const authority = createBackgroundAuthority({
      state,
      chromeApi,
      serverClient: createMockServerClient(),
      getLegacySiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(true),
      getNativeHostConfig: vi.fn().mockResolvedValue({ hostName: "", launchPath: "", editorLaunchOverrides: {} }),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(undefined),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      normalizeSiteConfigs: vi.fn((siteConfigs) => siteConfigs as any),
      setLastError: vi.fn((message) => {
        state.lastError = message;
      }),
      syncTraceBindings: vi.fn().mockResolvedValue(undefined),
      reconcileTabs: vi.fn().mockResolvedValue(undefined)
    });

    await authority.refreshStoredConfig();

    expect(state.localEnabledOrigins).toEqual(["https://local.example.com"]);
    expect(state.extensionVersion).toBe("9.9.9");
  });

  it("returns diagnostics for configured/effective config failures and local-root permission errors", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return { ok: false, error: "Permission denied." };
      }
      if (message?.type === "fs.readConfiguredSiteConfigs") {
        return { ok: false, error: "configured read failed" };
      }
      if (message?.type === "fs.readEffectiveSiteConfigs") {
        return { ok: false, error: "effective read failed" };
      }
      return { ok: true };
    });

    const { authority } = createAuthorityHarness({
      chromeApi,
      stateOverrides: {
        lastError: "transport unavailable"
      },
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      }
    });

    const report = await authority.getDiagnosticsReport();

    expect(report.issues).toEqual(expect.arrayContaining([
      "Configured-site read failed: configured read failed",
      "Effective-site read failed: effective read failed",
      "Local root check failed: Permission denied."
    ]));
    expect(report.config.configuredSiteError).toBe("configured read failed");
    expect(report.config.effectiveSiteError).toBe("effective read failed");
  });

  it("fails legacy site-config migration when the local write returns no result", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return { ok: true, sentinel: { rootId: "local-root" }, permission: "granted" };
      }
      if (message?.type === "fs.readConfiguredSiteConfigs") {
        return { ok: true, siteConfigs: [], sentinel: { rootId: "local-root" } };
      }
      if (message?.type === "fs.writeConfiguredSiteConfigs") {
        return null;
      }
      return { ok: true };
    });
    const { authority } = createAuthorityHarness({
      chromeApi,
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      },
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(false),
      getLegacySiteConfigs: vi.fn().mockResolvedValue([{
        origin: "https://legacy.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }])
    });

    await expect(authority.readConfiguredSiteConfigsForAuthority()).rejects.toThrow("Failed to update root config.");
  });

  it("fails legacy site-config migration when the local write returns an explicit error", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return { ok: true, sentinel: { rootId: "local-root" }, permission: "granted" };
      }
      if (message?.type === "fs.readConfiguredSiteConfigs") {
        return { ok: true, siteConfigs: [], sentinel: { rootId: "local-root" } };
      }
      if (message?.type === "fs.writeConfiguredSiteConfigs") {
        return { ok: false, error: "Failed to write merged site config." };
      }
      return { ok: true };
    });
    const { authority } = createAuthorityHarness({
      chromeApi,
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      },
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(false),
      getLegacySiteConfigs: vi.fn().mockResolvedValue([{
        origin: "https://legacy.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }])
    });

    await expect(authority.readConfiguredSiteConfigsForAuthority()).rejects.toThrow("Failed to write merged site config.");
  });
});
