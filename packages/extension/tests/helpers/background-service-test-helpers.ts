import { vi } from "vitest";

import { DEFAULT_NATIVE_HOST_CONFIG } from "../../src/lib/constants.js";
import type {
  BackgroundState,
  ChromeApi
} from "../../src/lib/background-runtime-shared.js";
import type { WraithWalkerServerClient } from "../../src/lib/wraithwalker-server.js";

function createEvent() {
  const listeners: Array<(...args: any[]) => unknown> = [];
  return {
    listeners,
    addListener: vi.fn((listener) => {
      listeners.push(listener);
    })
  };
}

export function createChromeApi(): ChromeApi & {
  runtime: ChromeApi["runtime"] & {
    sendMessage: ReturnType<typeof vi.fn>;
    sendNativeMessage: ReturnType<typeof vi.fn>;
    getContexts: ReturnType<typeof vi.fn>;
  };
  debugger: ChromeApi["debugger"] & {
    attach: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
  };
  tabs: ChromeApi["tabs"] & {
    query: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  offscreen: ChromeApi["offscreen"] & {
    createDocument: ReturnType<typeof vi.fn>;
    closeDocument: ReturnType<typeof vi.fn>;
  };
  alarms: NonNullable<ChromeApi["alarms"]> & {
    create: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  permissions: NonNullable<ChromeApi["permissions"]> & {
    request: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  contextMenus: NonNullable<ChromeApi["contextMenus"]> & {
    create: ReturnType<typeof vi.fn>;
    removeAll: ReturnType<typeof vi.fn>;
  };
} {
  return {
    runtime: {
      getURL: vi.fn((path) => path),
      getManifest: vi.fn(() => ({ version: "0.1.0" })),
      sendMessage: vi.fn(),
      sendNativeMessage: vi.fn(),
      onMessage: createEvent(),
      onStartup: createEvent(),
      onInstalled: createEvent(),
      getContexts: vi.fn().mockResolvedValue([])
    },
    debugger: {
      attach: vi.fn(),
      sendCommand: vi.fn(),
      detach: vi.fn(),
      onEvent: createEvent(),
      onDetach: createEvent()
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 99 }),
      onUpdated: createEvent(),
      onRemoved: createEvent()
    },
    storage: {
      onChanged: createEvent()
    },
    offscreen: {
      createDocument: vi.fn(),
      closeDocument: vi.fn(),
      Reason: {
        BLOBS: "BLOBS"
      }
    },
    alarms: {
      create: vi.fn(),
      clear: vi.fn().mockResolvedValue(true),
      onAlarm: createEvent()
    },
    permissions: {
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true)
    },
    contextMenus: {
      create: vi.fn(),
      removeAll: vi.fn().mockResolvedValue(undefined),
      onClicked: createEvent()
    }
  };
}

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
