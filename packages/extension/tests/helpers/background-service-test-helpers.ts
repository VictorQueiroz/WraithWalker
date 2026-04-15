import { vi } from "vitest";

import { DEFAULT_NATIVE_HOST_CONFIG } from "../../src/lib/constants.js";
import type { BackgroundState } from "../../src/lib/background-runtime-shared.js";
import type { WraithWalkerServerClient } from "../../src/lib/wraithwalker-server.js";
export {
  createTestChromeApi,
  installTestChromeApi,
  type TestChromeApi,
  type TestChromeApiOverrides
} from "./chrome-api-test-helpers.js";

export function createMockServerClient(
  overrides: Partial<WraithWalkerServerClient> = {}
): WraithWalkerServerClient {
  const heartbeat =
    overrides.heartbeat ??
    vi.fn().mockResolvedValue({
      version: "1.0.0",
      rootPath: "/tmp/server-root",
      sentinel: { rootId: "server-root" },
      baseUrl: "http://127.0.0.1:4319",
      mcpUrl: "http://127.0.0.1:4319/mcp",
      trpcUrl: "http://127.0.0.1:4319/trpc",
      activeTrace: null
    });

  return {
    getSystemInfo: vi.fn().mockResolvedValue({
      version: "1.0.0",
      rootPath: "/tmp/server-root",
      sentinel: { rootId: "server-root" },
      baseUrl: "http://127.0.0.1:4319",
      mcpUrl: "http://127.0.0.1:4319/mcp",
      trpcUrl: "http://127.0.0.1:4319/trpc",
      siteConfigs: []
    }),
    revealRoot: vi
      .fn()
      .mockResolvedValue({ ok: true, command: "open /tmp/server-root" }),
    listScenarios: vi.fn().mockResolvedValue({
      scenarios: [],
      snapshots: [],
      activeScenarioName: null,
      activeScenarioMissing: false,
      activeTrace: null,
      supportsTraceSave: true
    }),
    saveScenario: vi
      .fn()
      .mockImplementation(async (name: string) => ({ ok: true, name })),
    switchScenario: vi
      .fn()
      .mockImplementation(async (name: string) => ({ ok: true, name })),
    diffScenarios: vi.fn().mockResolvedValue({
      ok: true,
      diff: {
        scenarioA: "baseline",
        scenarioB: "candidate",
        added: [],
        removed: [],
        changed: []
      }
    }),
    saveScenarioFromTrace: vi
      .fn()
      .mockImplementation(async (name: string) => ({ ok: true, name })),
    heartbeat,
    hasFixture: vi.fn().mockResolvedValue({
      exists: false,
      sentinel: { rootId: "server-root" }
    }),
    readConfiguredSiteConfigs: vi.fn().mockResolvedValue({
      siteConfigs: [],
      sentinel: { rootId: "server-root" }
    }),
    readEffectiveSiteConfigs: vi.fn().mockResolvedValue({
      siteConfigs: [],
      sentinel: { rootId: "server-root" }
    }),
    writeConfiguredSiteConfigs: vi.fn().mockResolvedValue({
      siteConfigs: [],
      sentinel: { rootId: "server-root" }
    }),
    readFixture: vi.fn().mockResolvedValue({
      exists: false,
      sentinel: { rootId: "server-root" }
    }),
    writeFixtureIfAbsent: vi.fn().mockResolvedValue({
      written: true,
      descriptor: { bodyPath: "fixture-body" },
      sentinel: { rootId: "server-root" }
    }),
    generateContext: vi.fn().mockResolvedValue({ ok: true }),
    recordTraceClick: vi
      .fn()
      .mockResolvedValue({ recorded: false, activeTrace: null }),
    linkTraceFixture: vi.fn().mockResolvedValue({ linked: false, trace: null }),
    ...overrides
  } as WraithWalkerServerClient;
}

export function createBackgroundState(
  overrides: Partial<BackgroundState> = {}
): BackgroundState {
  return {
    sessionActive: false,
    attachedTabs: new Map(),
    requests: new Map(),
    recentConsoleEntries: [],
    enabledOrigins: [],
    siteConfigsByOrigin: new Map(),
    localEnabledOrigins: [],
    localSiteConfigsByOrigin: new Map(),
    preferredEditorId: "cursor",
    lastError: "",
    localRootReady: false,
    localRootSentinel: null,
    rootReady: false,
    rootSentinel: null,
    nativeHostConfig: { ...DEFAULT_NATIVE_HOST_CONFIG },
    extensionClientId: "client-1",
    extensionVersion: "0.1.0",
    serverInfo: null,
    activeTrace: null,
    serverCheckedAt: 0,
    legacySiteConfigsMigrated: false,
    ...overrides
  };
}
