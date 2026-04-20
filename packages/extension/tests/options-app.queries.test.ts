import { describe, expect, it, vi } from "vitest";

import { DEFAULT_NATIVE_HOST_CONFIG } from "../src/lib/constants.js";
import type { ScenarioListSuccess } from "../src/lib/messages.js";
import type { SessionSnapshot, SiteConfig } from "../src/lib/types.js";
import {
  createNativeHostConfigQueryOptions,
  createOptionsQueryClient,
  createRememberedRootStateQueryOptions,
  createScenarioPanelQueryOptions,
  createSessionSnapshotQueryOptions,
  createSiteConfigsQueryOptions,
  normalizeScenarioPanelState,
  optionsQueryKeys,
  refetchOptionsQuery
} from "../src/ui/options-app.queries.js";

function createSessionSnapshot(
  overrides: Partial<SessionSnapshot> = {}
): SessionSnapshot {
  return {
    sessionActive: false,
    attachedTabIds: [],
    enabledOrigins: [],
    rootReady: false,
    captureDestination: "none",
    captureRootPath: "",
    lastError: "",
    ...overrides
  };
}

function createScenarioListResult(
  overrides: Partial<Omit<ScenarioListSuccess, "ok">> = {}
): ScenarioListSuccess {
  return {
    ok: true,
    scenarios: ["baseline"],
    snapshots: [
      {
        name: "baseline",
        createdAt: "2026-04-03T12:00:00.000Z",
        source: "manual",
        hasMetadata: true,
        isActive: false
      }
    ],
    activeScenarioName: null,
    activeScenarioMissing: false,
    activeTrace: null,
    supportsTraceSave: false,
    ...overrides
  };
}

describe("options app queries", () => {
  it("creates a query client with conservative extension defaults", () => {
    const queryClient = createOptionsQueryClient();

    expect(queryClient.getDefaultOptions().queries).toMatchObject({
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false
    });
    expect(queryClient.getDefaultOptions().mutations).toMatchObject({
      retry: false
    });
  });

  it("falls back to the default native host config when the getter returns undefined", async () => {
    const queryClient = createOptionsQueryClient();

    const result = await queryClient.fetchQuery(
      createNativeHostConfigQueryOptions({
        getNativeHostConfig: vi.fn().mockResolvedValue(undefined)
      })
    );

    expect(result).toEqual(DEFAULT_NATIVE_HOST_CONFIG);
  });

  it("reads the remembered root state through the injected helpers", async () => {
    const rootHandle = { kind: "directory" } as FileSystemDirectoryHandle;
    const queryClient = createOptionsQueryClient();

    const result = await queryClient.fetchQuery(
      createRememberedRootStateQueryOptions({
        loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
        queryRootPermission: vi.fn().mockResolvedValue("granted"),
        ensureRootSentinel: vi.fn().mockResolvedValue({
          rootId: "root-id"
        })
      })
    );

    expect(result).toEqual({
      hasHandle: true,
      permission: "granted",
      sentinel: {
        rootId: "root-id"
      }
    });
  });

  it("returns a prompt root state when no remembered root handle exists", async () => {
    const ensureRootSentinel = vi.fn();
    const queryRootPermission = vi.fn();
    const queryClient = createOptionsQueryClient();

    const result = await queryClient.fetchQuery(
      createRememberedRootStateQueryOptions({
        loadStoredRootHandle: vi.fn().mockResolvedValue(null),
        queryRootPermission,
        ensureRootSentinel
      })
    );

    expect(result).toEqual({
      hasHandle: false,
      permission: "prompt",
      sentinel: null
    });
    expect(queryRootPermission).not.toHaveBeenCalled();
    expect(ensureRootSentinel).not.toHaveBeenCalled();
  });

  it("skips sentinel loading when the remembered root permission is not granted", async () => {
    const rootHandle = { kind: "directory" } as FileSystemDirectoryHandle;
    const ensureRootSentinel = vi.fn();
    const queryClient = createOptionsQueryClient();

    const result = await queryClient.fetchQuery(
      createRememberedRootStateQueryOptions({
        loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
        queryRootPermission: vi.fn().mockResolvedValue("prompt"),
        ensureRootSentinel
      })
    );

    expect(result).toEqual({
      hasHandle: true,
      permission: "prompt",
      sentinel: null
    });
    expect(ensureRootSentinel).not.toHaveBeenCalled();
  });

  it("keeps explicit polling only on the queries that should poll", () => {
    const runtime = {
      sendMessage: vi.fn()
    };
    const getSiteConfigs = vi
      .fn<() => Promise<SiteConfig[]>>()
      .mockResolvedValue([]);

    expect(
      createSessionSnapshotQueryOptions({
        runtime,
        refetchIntervalMs: 25
      }).refetchInterval
    ).toBe(25);
    expect(
      createSiteConfigsQueryOptions({
        getSiteConfigs,
        refetchIntervalMs: 25
      }).refetchInterval
    ).toBe(25);
    expect(
      createScenarioPanelQueryOptions({
        runtime,
        refetchIntervalMs: false
      }).refetchInterval
    ).toBe(false);
  });

  it("normalizes configured sites through the site-config query", async () => {
    const queryClient = createOptionsQueryClient();

    const result = await queryClient.fetchQuery(
      createSiteConfigsQueryOptions({
        getSiteConfigs: vi.fn().mockResolvedValue([
          {
            origin: "app.example.com",
            createdAt: "2026-04-03T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ]),
        refetchIntervalMs: false
      })
    );

    expect(result).toEqual([
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-03T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }
    ]);
  });

  it("normalizes scenario panel data from the scenario query", async () => {
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue(
        createScenarioListResult({
          activeScenarioName: "baseline"
        })
      )
    };
    const queryClient = createOptionsQueryClient();

    const result = await queryClient.fetchQuery(
      createScenarioPanelQueryOptions({
        runtime,
        refetchIntervalMs: false
      })
    );

    expect(result).toEqual(
      normalizeScenarioPanelState(
        createScenarioListResult({
          activeScenarioName: "baseline"
        })
      )
    );
  });

  it("normalizes scenario snapshots and derives scenarios from valid snapshots when needed", () => {
    const result = normalizeScenarioPanelState({
      ok: true,
      snapshots: [
        null,
        { createdAt: "2026-04-03T12:00:00.000Z" } as unknown,
        {
          name: "baseline",
          schemaVersion: 2,
          rootId: "root-1",
          source: "mystery",
          description: "   ",
          sourceTrace: "invalid",
          hasMetadata: "yes"
        } as unknown,
        {
          name: "candidate",
          source: "trace",
          description: "  Saved from trace  ",
          sourceTrace: {
            traceId: "trace-1"
          } as unknown,
          hasMetadata: true
        } as unknown
      ],
      activeScenarioName: "baseline",
      activeScenarioMissing: 1 as unknown as boolean,
      activeTrace: {
        traceId: "trace-1"
      } as unknown,
      supportsTraceSave: 1 as unknown as boolean
    } as Parameters<typeof normalizeScenarioPanelState>[0]);

    expect(result).toEqual({
      scenarios: ["baseline", "candidate"],
      snapshots: [
        {
          name: "baseline",
          schemaVersion: 2,
          rootId: "root-1",
          source: "unknown",
          hasMetadata: false,
          isActive: true
        },
        {
          name: "candidate",
          source: "trace",
          description: "Saved from trace",
          sourceTrace: {
            traceId: "trace-1"
          },
          hasMetadata: true,
          isActive: false
        }
      ],
      activeScenarioName: "baseline",
      activeScenarioMissing: true,
      activeTrace: {
        traceId: "trace-1"
      },
      supportsTraceSave: true
    });
  });

  it("falls back to legacy scenario names when structured snapshots are absent", () => {
    const result = normalizeScenarioPanelState({
      ok: true,
      scenarios: ["baseline", 42, "candidate"] as unknown as string[],
      activeScenarioName: "candidate",
      supportsTraceSave: false
    });

    expect(result).toEqual({
      scenarios: ["baseline", "candidate"],
      snapshots: [
        {
          name: "baseline",
          source: "unknown",
          hasMetadata: false,
          isActive: false
        },
        {
          name: "candidate",
          source: "unknown",
          hasMetadata: false,
          isActive: true
        }
      ],
      activeScenarioName: "candidate",
      activeScenarioMissing: false,
      activeTrace: null,
      supportsTraceSave: false
    });
  });

  it("treats a non-string active scenario name as absent", () => {
    const result = normalizeScenarioPanelState({
      ok: true,
      snapshots: [
        {
          name: "baseline",
          source: "manual",
          hasMetadata: true
        } as unknown
      ],
      activeScenarioName: 42 as unknown as string
    } as Parameters<typeof normalizeScenarioPanelState>[0]);

    expect(result).toEqual({
      scenarios: ["baseline"],
      snapshots: [
        {
          name: "baseline",
          source: "manual",
          hasMetadata: true,
          isActive: false
        }
      ],
      activeScenarioName: null,
      activeScenarioMissing: false,
      activeTrace: null,
      supportsTraceSave: false
    });
  });

  it("surfaces scenario list failures as query errors", async () => {
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue({
        ok: false,
        error: "Scenario list failed."
      })
    };
    const queryClient = createOptionsQueryClient();

    await expect(
      queryClient.fetchQuery(
        createScenarioPanelQueryOptions({
          runtime,
          refetchIntervalMs: false
        })
      )
    ).rejects.toThrow("Scenario list failed.");
  });

  it("falls back to an unknown error when scenario list failures omit an error message", async () => {
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue({
        ok: false
      })
    };
    const queryClient = createOptionsQueryClient();

    await expect(
      queryClient.fetchQuery(
        createScenarioPanelQueryOptions({
          runtime,
          refetchIntervalMs: false
        })
      )
    ).rejects.toThrow("Unknown error.");
  });

  it("uses stable option query keys", () => {
    expect(optionsQueryKeys.nativeHostConfig()).toEqual([
      "options",
      "nativeHostConfig"
    ]);
    expect(optionsQueryKeys.rememberedRootState()).toEqual([
      "options",
      "rememberedRootState"
    ]);
    expect(optionsQueryKeys.sessionSnapshot()).toEqual([
      "options",
      "sessionSnapshot"
    ]);
    expect(optionsQueryKeys.siteConfigs()).toEqual(["options", "siteConfigs"]);
    expect(optionsQueryKeys.scenarioPanel()).toEqual([
      "options",
      "scenarioPanel"
    ]);
  });

  it("routes the session snapshot query through the runtime message helper", async () => {
    const snapshot = createSessionSnapshot({
      captureDestination: "server",
      captureRootPath: "/tmp/server-root",
      enabledOrigins: ["https://app.example.com"],
      rootReady: true
    });
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue(snapshot)
    };
    const queryClient = createOptionsQueryClient();

    const result = await queryClient.fetchQuery(
      createSessionSnapshotQueryOptions({
        runtime,
        refetchIntervalMs: false
      })
    );

    expect(result).toEqual(snapshot);
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: "session.getState"
    });
  });

  it("invalidates and refetches only the requested options query", async () => {
    const calls: string[] = [];
    const queryClient = {
      invalidateQueries: vi.fn(async () => {
        calls.push("invalidate");
      }),
      refetchQueries: vi.fn(async () => {
        calls.push("refetch");
      })
    } as unknown as ReturnType<typeof createOptionsQueryClient>;
    const queryKey = optionsQueryKeys.siteConfigs();

    await refetchOptionsQuery(queryClient, queryKey);

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey
    });
    expect(queryClient.refetchQueries).toHaveBeenCalledWith({
      queryKey,
      type: "active"
    });
    expect(calls).toEqual(["invalidate", "refetch"]);
  });

  it("forwards timeout provider functions without touching the real TanStack timeout manager", async () => {
    vi.resetModules();
    const setTimeoutProvider = vi.fn();
    vi.doMock("@tanstack/react-query", async () => {
      const actual = await vi.importActual<
        typeof import("@tanstack/react-query")
      >("@tanstack/react-query");

      return {
        ...actual,
        timeoutManager: {
          setTimeoutProvider
        }
      };
    });

    try {
      const { setOptionsQueryTimeoutProvider } =
        await import("../src/ui/options-app.queries.js");
      const setIntervalFn = vi.fn() as unknown as typeof setInterval;
      const clearIntervalFn = vi.fn() as unknown as typeof clearInterval;
      const setTimeoutFn = vi.fn() as unknown as typeof setTimeout;
      const clearTimeoutFn = vi.fn() as unknown as typeof clearTimeout;

      setOptionsQueryTimeoutProvider();
      setOptionsQueryTimeoutProvider({
        setIntervalFn,
        clearIntervalFn,
        setTimeoutFn,
        clearTimeoutFn
      });

      expect(setTimeoutProvider).toHaveBeenNthCalledWith(1, {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval
      });
      expect(setTimeoutProvider).toHaveBeenNthCalledWith(2, {
        setTimeout: setTimeoutFn,
        clearTimeout: clearTimeoutFn,
        setInterval: setIntervalFn,
        clearInterval: clearIntervalFn
      });
    } finally {
      vi.doUnmock("@tanstack/react-query");
      vi.resetModules();
    }
  });
});
