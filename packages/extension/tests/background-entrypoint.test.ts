import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DUMP_ALLOWLIST_PATTERNS, DEFAULT_NATIVE_HOST_CONFIG, STORAGE_KEYS } from "../src/lib/constants.js";

function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener: vi.fn((listener) => {
      listeners.push(listener);
    })
  };
}

function createChromeApi() {
  const chromeApi = {
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
      onChanged: createEvent(),
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined)
      }
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
    }
  };

  globalThis.chrome = chromeApi as any;
  return chromeApi;
}

function createMockServerClient(overrides: Record<string, any> = {}) {
  const fallbackInfo = {
    version: "0.6.1",
    rootPath: "/tmp/server-root",
    sentinel: { rootId: "server-root" },
    baseUrl: "http://127.0.0.1:4319",
    mcpUrl: "http://127.0.0.1:4319/mcp",
    trpcUrl: "http://127.0.0.1:4319/trpc",
    siteConfigs: [{
      origin: "https://app.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.js$"]
    }]
  };
  const getSystemInfo = overrides.getSystemInfo ?? vi.fn().mockResolvedValue(fallbackInfo);
  const heartbeat = overrides.heartbeat ?? vi.fn(async () => ({
    ...(await getSystemInfo()),
    activeTrace: overrides.activeTrace ?? null
  }));

  return {
    getSystemInfo,
    heartbeat,
    hasFixture: vi.fn().mockResolvedValue({
      exists: false,
      sentinel: fallbackInfo.sentinel
    }),
    readConfiguredSiteConfigs: vi.fn().mockResolvedValue({
      siteConfigs: fallbackInfo.siteConfigs,
      sentinel: fallbackInfo.sentinel
    }),
    readEffectiveSiteConfigs: vi.fn().mockResolvedValue({
      siteConfigs: fallbackInfo.siteConfigs,
      sentinel: fallbackInfo.sentinel
    }),
    writeConfiguredSiteConfigs: vi.fn().mockImplementation(async (siteConfigs) => ({
      siteConfigs,
      sentinel: fallbackInfo.sentinel
    })),
    readFixture: vi.fn().mockResolvedValue({
      exists: false,
      sentinel: fallbackInfo.sentinel
    }),
    writeFixtureIfAbsent: vi.fn().mockResolvedValue({
      written: true,
      descriptor: { bodyPath: "cdn.example.com/assets/app.js" },
      sentinel: fallbackInfo.sentinel
    }),
    generateContext: vi.fn().mockResolvedValue({ ok: true }),
    recordTraceClick: vi.fn().mockResolvedValue({
      recorded: false,
      activeTrace: overrides.activeTrace ?? null
    }),
    linkTraceFixture: vi.fn().mockResolvedValue({
      linked: false,
      trace: overrides.activeTrace ?? null
    }),
    ...overrides
  };
}

function createActiveTrace(overrides: Record<string, any> = {}) {
  return {
    schemaVersion: 1,
    traceId: "trace-1",
    status: "armed" as const,
    createdAt: "2026-04-08T00:00:00.000Z",
    rootId: "server-root",
    selectedOrigins: ["https://app.example.com"],
    extensionClientId: "client-1",
    steps: [],
    ...overrides
  };
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadBackgroundModule() {
  vi.resetModules();
  globalThis.__WRAITHWALKER_TEST__ = true;
  return import("../src/background.ts");
}

async function loadBackgroundModuleOutsideTestMode() {
  vi.resetModules();
  delete globalThis.__WRAITHWALKER_TEST__;
  return import("../src/background.ts");
}

afterEach(() => {
  delete globalThis.__WRAITHWALKER_TEST__;
  delete globalThis.chrome;
  vi.restoreAllMocks();
});

describe("background entrypoint", () => {
  it("registers listeners and loads stored configuration on start", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const getSiteConfigs = vi.fn().mockResolvedValue([
      { origin: "https://app.example.com", createdAt: "2026-04-03T00:00:00.000Z" }
    ]);
    const getNativeHostConfig = vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG);
    const sessionController = {
      startSession: vi.fn(),
      stopSession: vi.fn(),
      reconcileTabs: vi.fn(),
      handleTabStateChange: vi.fn()
    };
    const requestLifecycle = {
      handleFetchRequestPaused: vi.fn(),
      handleNetworkRequestWillBeSent: vi.fn(),
      handleNetworkResponseReceived: vi.fn(),
      handleNetworkLoadingFinished: vi.fn(),
      handleNetworkLoadingFailed: vi.fn()
    };

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs,
      getNativeHostConfig,
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => sessionController),
      createRequestLifecycle: vi.fn(() => requestLifecycle)
    });

    await runtime.start();

    expect(chromeApi.debugger.onEvent.addListener).toHaveBeenCalled();
    expect(chromeApi.runtime.onMessage.addListener).toHaveBeenCalled();
    expect(chromeApi.storage.onChanged.addListener).toHaveBeenCalled();
    expect(getSiteConfigs).toHaveBeenCalled();
    expect(runtime.state.enabledOrigins).toEqual(["https://app.example.com"]);
  });

  it("does not block session.getState while the local server probe is still pending", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const never = new Promise<never>(() => undefined);

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({
        getSystemInfo: vi.fn(() => never)
      })),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();

    const stateResult = await Promise.race([
      runtime.handleRuntimeMessage({ type: "session.getState" }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("session.getState timed out")), 50))
    ]);

    expect(stateResult).toMatchObject({
      sessionActive: false,
      captureDestination: "none",
      captureRootPath: ""
    });
  });

  it("keeps retrying server detection and switches to the server root once it responds", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const getSystemInfo = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        version: "0.6.1",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc"
      });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({
        getSystemInfo
      })),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await flushPromises();

    expect(runtime.state.serverInfo).toBeNull();

    runtime.state.serverCheckedAt = 0;
    const firstState = await runtime.handleRuntimeMessage({ type: "session.getState" });
    expect(firstState).toMatchObject({
      captureDestination: "none",
      captureRootPath: ""
    });

    await flushPromises();

    const secondState = await runtime.handleRuntimeMessage({ type: "session.getState" });
    expect(secondState).toMatchObject({
      captureDestination: "server",
      captureRootPath: "/tmp/server-root",
      rootReady: true
    });
  });

  it("prefers the local WraithWalker server over a ready local root for capture and editor open", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const serverSentinel = { rootId: "server-root" };
    const localSentinel = { rootId: "local-root" };
    const serverClient = createMockServerClient({
      getSystemInfo: vi.fn().mockResolvedValue({
        version: "0.6.1",
        rootPath: "/tmp/server-root",
        sentinel: serverSentinel,
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc"
      }),
      hasFixture: vi.fn().mockResolvedValue({
        exists: true,
        sentinel: serverSentinel
      }),
      readFixture: vi.fn().mockResolvedValue({
        exists: true,
        request: {
          topOrigin: "https://app.example.com",
          url: "https://cdn.example.com/assets/app.js",
          method: "GET",
          headers: [],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: "",
          queryHash: "",
          capturedAt: "2026-04-07T00:00:00.000Z"
        },
        meta: {
          status: 200,
          statusText: "OK",
          headers: [{ name: "Content-Type", value: "application/javascript" }],
          mimeType: "application/javascript",
          resourceType: "Script",
          url: "https://cdn.example.com/assets/app.js",
          method: "GET",
          capturedAt: "2026-04-07T00:00:00.000Z",
          bodyEncoding: "utf8",
          bodySuggestedExtension: "js"
        },
        bodyBase64: "Y29uc29sZS5sb2coJ3NlcnZlcicpOw==",
        size: 22,
        sentinel: serverSentinel
      }),
      writeFixtureIfAbsent: vi.fn().mockResolvedValue({
        written: true,
        descriptor: { bodyPath: "cdn.example.com/assets/app.js" },
        sentinel: serverSentinel
      }),
      generateContext: vi.fn().mockResolvedValue({ ok: true })
    });
    let requestLifecycleDependencies:
      | Parameters<Exclude<Parameters<typeof createBackgroundRuntime>[0], undefined>["createRequestLifecycle"]>[0]
      | undefined;

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([
        { origin: "https://app.example.com", createdAt: "2026-04-07T00:00:00.000Z", dumpAllowlistPatterns: ["\\.js$"] }
      ]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        launchPath: "/tmp/local-root"
      }),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => serverClient),
      initialState: {
        localRootReady: true,
        localRootSentinel: localSentinel,
        rootReady: true,
        rootSentinel: localSentinel
      },
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn((dependencies) => {
        requestLifecycleDependencies = dependencies;
        return {
          handleFetchRequestPaused: vi.fn(),
          handleNetworkRequestWillBeSent: vi.fn(),
          handleNetworkResponseReceived: vi.fn(),
          handleNetworkLoadingFinished: vi.fn(),
          handleNetworkLoadingFailed: vi.fn()
        };
      })
    });

    await runtime.start();
    await flushPromises();

    const stateResult = await runtime.handleRuntimeMessage({ type: "session.getState" });
    expect(stateResult).toMatchObject({
      captureDestination: "server",
      captureRootPath: "/tmp/server-root",
      rootReady: true
    });
    expect(runtime.state.rootSentinel).toEqual(serverSentinel);
    expect(runtime.state.enabledOrigins).toEqual(["https://app.example.com"]);

    expect(requestLifecycleDependencies).toBeTruthy();
    const fixtureExists = await requestLifecycleDependencies!.repository.exists({} as never);
    expect(fixtureExists).toBe(true);
    expect(serverClient.hasFixture).toHaveBeenCalledTimes(1);
    await expect(requestLifecycleDependencies!.repository.read({} as never)).resolves.toEqual({
      request: expect.objectContaining({
        topOrigin: "https://app.example.com",
        url: "https://cdn.example.com/assets/app.js"
      }),
      meta: expect.objectContaining({
        status: 200,
        mimeType: "application/javascript"
      }),
      bodyBase64: "Y29uc29sZS5sb2coJ3NlcnZlcicpOw==",
      size: 22
    });
    await expect(requestLifecycleDependencies!.repository.writeIfAbsent({
      descriptor: {} as never,
      request: {} as never,
      response: {} as never
    })).resolves.toEqual({
      written: true,
      descriptor: { bodyPath: "cdn.example.com/assets/app.js" },
      sentinel: serverSentinel
    });
    expect(serverClient.readFixture).toHaveBeenCalledTimes(1);
    expect(serverClient.writeFixtureIfAbsent).toHaveBeenCalledTimes(1);
    expect(chromeApi.runtime.sendMessage).not.toHaveBeenCalledWith({
      target: "offscreen",
      type: "fs.hasFixture",
      payload: expect.anything()
    });

    const openResult = await runtime.openDirectoryInEditor(undefined, "cursor");
    expect(openResult).toEqual({ ok: true });
    expect(serverClient.generateContext).toHaveBeenCalledWith({
      siteConfigs: [{
        origin: "https://app.example.com",
        createdAt: "2026-04-07T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }],
      editorId: "cursor"
    });
    expect(chromeApi.runtime.sendMessage).not.toHaveBeenCalledWith({
      target: "offscreen",
      type: "fs.generateContext",
      payload: expect.anything()
    });
    expect(chromeApi.tabs.create).toHaveBeenNthCalledWith(1, {
      url: "cursor://file//tmp/server-root/"
    });
    expect(chromeApi.tabs.create).toHaveBeenNthCalledWith(2, {
      url: expect.stringContaining("cursor://anysphere.cursor-deeplink/prompt?text=")
    });
  });

  it("replaces local fallback site configs with server-backed site configs when connected", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([
        {
          origin: "https://local.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.json$"]
        }
      ]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({
        heartbeat: vi.fn().mockResolvedValue({
          version: "0.6.1",
          rootPath: "/tmp/server-root",
          sentinel: { rootId: "server-root" },
          baseUrl: "http://127.0.0.1:4319",
          mcpUrl: "http://127.0.0.1:4319/mcp",
          trpcUrl: "http://127.0.0.1:4319/trpc",
          siteConfigs: [{
            origin: "https://server.example.com",
            createdAt: "2026-04-08T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.svg$"]
          }],
          activeTrace: null
        })
      })),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await flushPromises();

    expect(runtime.state.enabledOrigins).toEqual(["https://server.example.com"]);
    expect(runtime.state.siteConfigsByOrigin.get("https://server.example.com")).toEqual(
      expect.objectContaining({
        dumpAllowlistPatterns: ["\\.svg$"]
      })
    );
    expect(runtime.state.localSiteConfigsByOrigin.get("https://local.example.com")).toEqual(
      expect.objectContaining({
        dumpAllowlistPatterns: ["\\.json$"]
      })
    );
  });

  it("reads configured site configs from the server when connected", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const serverClient = createMockServerClient({
      readConfiguredSiteConfigs: vi.fn().mockResolvedValue({
        siteConfigs: [{
          origin: "https://server.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.svg$"]
        }],
        sentinel: { rootId: "server-root" }
      })
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => serverClient),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await flushPromises();

    const result = await runtime.handleRuntimeMessage({ type: "config.readConfiguredSiteConfigs" });

    expect(serverClient.readConfiguredSiteConfigs).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      sentinel: { rootId: "server-root" },
      siteConfigs: [{
        origin: "https://server.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.svg$"]
      }]
    });
    expect(chromeApi.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      target: "offscreen"
    }));
  });

  it("returns an empty configured site config list when the local offscreen payload is malformed", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockImplementation(async (message: {
      target?: string;
      type?: string;
    }) => {
      if (message.target !== "offscreen") {
        return undefined;
      }

      switch (message.type) {
        case "fs.ensureRoot":
          return { ok: true, sentinel: { rootId: "local-root" }, permission: "granted" };
        case "fs.readConfiguredSiteConfigs":
          return { ok: true, sentinel: { rootId: "local-root" }, siteConfigs: { origin: "broken" } } as any;
        case "fs.readEffectiveSiteConfigs":
          return { ok: true, sentinel: { rootId: "local-root" }, siteConfigs: [] };
        default:
          return { ok: false, error: `Unhandled offscreen message: ${String(message.type)}` };
      }
    });
    const serverClient = createMockServerClient({
      heartbeat: vi.fn().mockRejectedValue(new Error("server unavailable"))
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => serverClient),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await flushPromises();

    await expect(runtime.handleRuntimeMessage({ type: "config.readConfiguredSiteConfigs" })).resolves.toEqual({
      ok: true,
      sentinel: { rootId: "local-root" },
      siteConfigs: []
    });
  });

  it("reads effective site configs from the server when connected", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const serverClient = createMockServerClient({
      readEffectiveSiteConfigs: vi.fn().mockResolvedValue({
        siteConfigs: [{
          origin: "https://effective.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }],
        sentinel: { rootId: "server-root" }
      })
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => serverClient),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await flushPromises();

    const result = await runtime.handleRuntimeMessage({ type: "config.readEffectiveSiteConfigs" });

    expect(serverClient.readEffectiveSiteConfigs).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      sentinel: { rootId: "server-root" },
      siteConfigs: [{
        origin: "https://effective.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }]
    });
    expect(chromeApi.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      target: "offscreen"
    }));
  });

  it("returns an empty effective site config list when the local offscreen payload is malformed", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockImplementation(async (message: {
      target?: string;
      type?: string;
    }) => {
      if (message.target !== "offscreen") {
        return undefined;
      }

      switch (message.type) {
        case "fs.ensureRoot":
          return { ok: true, sentinel: { rootId: "local-root" }, permission: "granted" };
        case "fs.readConfiguredSiteConfigs":
          return { ok: true, sentinel: { rootId: "local-root" }, siteConfigs: [] };
        case "fs.readEffectiveSiteConfigs":
          return { ok: true, sentinel: { rootId: "local-root" }, siteConfigs: { origin: "broken" } } as any;
        default:
          return { ok: false, error: `Unhandled offscreen message: ${String(message.type)}` };
      }
    });
    const serverClient = createMockServerClient({
      heartbeat: vi.fn().mockRejectedValue(new Error("server unavailable"))
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => serverClient),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await flushPromises();

    await expect(runtime.handleRuntimeMessage({ type: "config.readEffectiveSiteConfigs" })).resolves.toEqual({
      ok: true,
      sentinel: { rootId: "local-root" },
      siteConfigs: []
    });
  });

  it("writes configured site configs to the server when connected without dual-writing locally", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    let serverConfiguredSites = [{
      origin: "https://server.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.svg$"]
    }];
    const serverClient = createMockServerClient({
      heartbeat: vi.fn().mockImplementation(async () => ({
        version: "0.6.1",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        siteConfigs: serverConfiguredSites,
        activeTrace: null
      })),
      writeConfiguredSiteConfigs: vi.fn().mockImplementation(async (siteConfigs) => {
        serverConfiguredSites = siteConfigs;
        return {
          siteConfigs,
          sentinel: { rootId: "server-root" }
        };
      })
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([
        {
          origin: "https://local.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.json$"]
        }
      ]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => serverClient),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await flushPromises();

    const result = await runtime.handleRuntimeMessage({
      type: "config.writeConfiguredSiteConfigs",
      siteConfigs: [{
        origin: "https://server-only.example.com",
        createdAt: "2026-04-08T12:00:00.000Z",
        dumpAllowlistPatterns: ["\\.css$"]
      }]
    });

    expect(serverClient.writeConfiguredSiteConfigs).toHaveBeenCalledWith([{
      origin: "https://server-only.example.com",
      createdAt: "2026-04-08T12:00:00.000Z",
      dumpAllowlistPatterns: ["\\.css$"]
    }]);
    expect(result).toEqual({
      ok: true,
      sentinel: { rootId: "server-root" },
      siteConfigs: [{
        origin: "https://server-only.example.com",
        createdAt: "2026-04-08T12:00:00.000Z",
        dumpAllowlistPatterns: ["\\.css$"]
      }]
    });
    expect(runtime.state.enabledOrigins).toEqual(["https://server-only.example.com"]);
    expect(chromeApi.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      target: "offscreen",
      type: "fs.writeConfiguredSiteConfigs"
    }));
  });

  it("falls back to the local root when a server-backed config write fails", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    let localConfiguredSites = [{
      origin: "https://local.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.json$"]
    }];
    chromeApi.runtime.sendMessage.mockImplementation(async (message: {
      target?: string;
      type?: string;
      payload?: { siteConfigs?: typeof localConfiguredSites };
    }) => {
      if (message.target !== "offscreen") {
        return undefined;
      }

      switch (message.type) {
        case "fs.ensureRoot":
          return { ok: true, sentinel: { rootId: "local-root" }, permission: "granted" };
        case "fs.readConfiguredSiteConfigs":
        case "fs.readEffectiveSiteConfigs":
          return { ok: true, sentinel: { rootId: "local-root" }, siteConfigs: localConfiguredSites };
        case "fs.writeConfiguredSiteConfigs":
          localConfiguredSites = message.payload?.siteConfigs ?? [];
          return { ok: true, sentinel: { rootId: "local-root" }, siteConfigs: localConfiguredSites };
        default:
          return { ok: false, error: `Unhandled offscreen message: ${String(message.type)}` };
      }
    });
    const serverClient = createMockServerClient({
      writeConfiguredSiteConfigs: vi.fn().mockRejectedValue(new Error("server write failed"))
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => serverClient),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await flushPromises();

    const result = await runtime.handleRuntimeMessage({
      type: "config.writeConfiguredSiteConfigs",
      siteConfigs: [{
        origin: "https://fallback.example.com",
        createdAt: "2026-04-08T12:00:00.000Z",
        dumpAllowlistPatterns: ["\\.css$"]
      }]
    });

    expect(serverClient.writeConfiguredSiteConfigs).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      sentinel: { rootId: "local-root" },
      siteConfigs: [{
        origin: "https://fallback.example.com",
        createdAt: "2026-04-08T12:00:00.000Z",
        dumpAllowlistPatterns: ["\\.css$"]
      }]
    });
    expect(runtime.state.serverInfo).toBeNull();
    expect(runtime.state.enabledOrigins).toEqual(["https://fallback.example.com"]);
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      target: "offscreen",
      type: "fs.writeConfiguredSiteConfigs",
      payload: {
        siteConfigs: [{
          origin: "https://fallback.example.com",
          createdAt: "2026-04-08T12:00:00.000Z",
          dumpAllowlistPatterns: ["\\.css$"]
        }]
      }
    });
  });

  it("surfaces a combined error when a server-backed config write fails and no fallback root is ready", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockImplementation(async (message: {
      target?: string;
      type?: string;
    }) => {
      if (message.target !== "offscreen") {
        return undefined;
      }

      if (message.type === "fs.ensureRoot") {
        return { ok: false, error: "No root directory selected." };
      }

      return { ok: false, error: `Unhandled offscreen message: ${String(message.type)}` };
    });
    const serverClient = createMockServerClient({
      writeConfiguredSiteConfigs: vi.fn().mockRejectedValue(new Error("server write failed"))
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => serverClient),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await flushPromises();

    const result = await runtime.handleRuntimeMessage({
      type: "config.writeConfiguredSiteConfigs",
      siteConfigs: [{
        origin: "https://no-fallback.example.com",
        createdAt: "2026-04-08T12:00:00.000Z",
        dumpAllowlistPatterns: ["\\.css$"]
      }]
    });

    expect(serverClient.writeConfiguredSiteConfigs).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      error: "Local WraithWalker server is unavailable and no fallback root is ready. server write failed"
    });
    expect(chromeApi.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      target: "offscreen",
      type: "fs.writeConfiguredSiteConfigs"
    }));
  });

  it("preserves server authority when local config refresh reads malformed site config data", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockImplementation(async (message: {
      target?: string;
      type?: string;
    }) => {
      if (message.target !== "offscreen") {
        return undefined;
      }

      if (message.type === "fs.readEffectiveSiteConfigs") {
        return {
          ok: true,
          sentinel: { rootId: "local-root" },
          siteConfigs: { origin: "broken" }
        } as any;
      }

      return { ok: false, error: `Unhandled offscreen message: ${String(message.type)}` };
    });
    const serverClient = createMockServerClient({
      heartbeat: vi.fn().mockResolvedValue({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        siteConfigs: [{
          origin: "https://server.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.svg$"]
        }],
        activeTrace: null
      })
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => serverClient),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await flushPromises();

    expect(runtime.state.enabledOrigins).toEqual(["https://server.example.com"]);
    expect(runtime.state.localSiteConfigsByOrigin.size).toBe(0);

    chromeApi.storage.onChanged.listeners[0]({
      preferredEditorId: {
        oldValue: "cursor",
        newValue: "windsurf"
      }
    }, "local");
    await flushPromises();

    expect(runtime.state.enabledOrigins).toEqual(["https://server.example.com"]);
    expect(runtime.state.siteConfigsByOrigin.has("https://server.example.com")).toBe(true);
    expect(runtime.state.localSiteConfigsByOrigin.size).toBe(0);
  });

  it("falls back to the local root when a server-backed effective config read fails", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    let localEffectiveSites = [{
      origin: "https://local-effective.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.css$"]
    }];
    chromeApi.runtime.sendMessage.mockImplementation(async (message: {
      target?: string;
      type?: string;
    }) => {
      if (message.target !== "offscreen") {
        return undefined;
      }

      switch (message.type) {
        case "fs.ensureRoot":
          return { ok: true, sentinel: { rootId: "local-root" }, permission: "granted" };
        case "fs.readEffectiveSiteConfigs":
          return { ok: true, sentinel: { rootId: "local-root" }, siteConfigs: localEffectiveSites };
        default:
          return { ok: false, error: `Unhandled offscreen message: ${String(message.type)}` };
      }
    });
    const serverClient = createMockServerClient({
      readEffectiveSiteConfigs: vi.fn().mockRejectedValue(new Error("server read failed"))
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => serverClient),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await flushPromises();

    const result = await runtime.handleRuntimeMessage({ type: "config.readEffectiveSiteConfigs" });

    expect(serverClient.readEffectiveSiteConfigs).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      sentinel: { rootId: "local-root" },
      siteConfigs: [{
        origin: "https://local-effective.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.css$"]
      }]
    });
    expect(runtime.state.serverInfo).toBeNull();
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      target: "offscreen",
      type: "fs.readEffectiveSiteConfigs"
    }));
  });

  it("surfaces a combined error when a server-backed effective config read fails and no fallback root is ready", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockImplementation(async (message: {
      target?: string;
      type?: string;
    }) => {
      if (message.target !== "offscreen") {
        return undefined;
      }

      if (message.type === "fs.ensureRoot") {
        return { ok: false, error: "No root directory selected." };
      }

      return { ok: false, error: `Unhandled offscreen message: ${String(message.type)}` };
    });
    const serverClient = createMockServerClient({
      readEffectiveSiteConfigs: vi.fn().mockRejectedValue(new Error("server read failed"))
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => serverClient),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await flushPromises();

    const result = await runtime.handleRuntimeMessage({ type: "config.readEffectiveSiteConfigs" });

    expect(serverClient.readEffectiveSiteConfigs).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      error: "Local WraithWalker server is unavailable and no fallback root is ready. server read failed"
    });
    expect(chromeApi.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      target: "offscreen",
      type: "fs.readEffectiveSiteConfigs"
    }));
  });

  it("heartbeats with a persisted client id and arms debugger-based tracing when the server reports an active trace", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.tabs.query.mockResolvedValue([{ id: 7, url: "https://app.example.com/settings" }]);
    const activeTrace = createActiveTrace();
    const heartbeat = vi.fn().mockResolvedValue({
      version: "1.0.0",
      rootPath: "/tmp/server-root",
      sentinel: { rootId: "server-root" },
      baseUrl: "http://127.0.0.1:4319",
      mcpUrl: "http://127.0.0.1:4319/mcp",
      trpcUrl: "http://127.0.0.1:4319/trpc",
      activeTrace
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([
        { origin: "https://app.example.com", createdAt: "2026-04-08T00:00:00.000Z", dumpAllowlistPatterns: ["\\.js$"] }
      ]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({
        heartbeat,
        activeTrace
      }))
    });

    await runtime.start();
    await runtime.handleRuntimeMessage({ type: "session.start" });
    await flushPromises();

    expect(heartbeat).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "client-1",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"]
    }));
    expect(runtime.state.activeTrace).toEqual(expect.objectContaining({ traceId: "trace-1" }));
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 7 }, "Runtime.enable");
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 7 }, "Page.enable");
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 7 }, "Runtime.addBinding", {
      name: "__wraithwalkerTraceBinding"
    });
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Page.addScriptToEvaluateOnNewDocument",
      expect.objectContaining({
        source: expect.stringContaining("__wraithwalkerTraceBinding")
      })
    );
    expect(chromeApi.alarms.create).toHaveBeenCalledWith("wraithwalker-server-heartbeat", expect.any(Object));
  });

  it("does not re-arm trace bindings for tabs that are already armed for the active trace", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const activeTrace = createActiveTrace();

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([
        { origin: "https://app.example.com", createdAt: "2026-04-08T00:00:00.000Z", dumpAllowlistPatterns: ["\\.js$"] }
      ]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn()
    });

    await runtime.start();
    runtime.state.sessionActive = true;
    runtime.state.enabledOrigins = ["https://app.example.com"];
    runtime.state.activeTrace = activeTrace;
    runtime.state.serverInfo = {
      rootPath: "/tmp/server-root",
      sentinel: { rootId: "server-root" },
      baseUrl: "http://127.0.0.1:4319",
      mcpUrl: "http://127.0.0.1:4319/mcp",
      trpcUrl: "http://127.0.0.1:4319/trpc"
    };
    runtime.state.attachedTabs.set(7, {
      topOrigin: "https://app.example.com",
      traceScriptIdentifier: "trace-script-1",
      traceArmedForTraceId: "trace-1"
    });

    chromeApi.debugger.sendCommand.mockClear();
    chromeApi.tabs.onUpdated.listeners[0](7, {}, { id: 7, url: "https://app.example.com/profile" });
    await flushPromises();

    expect(runtime.state.attachedTabs.get(7)).toMatchObject({
      topOrigin: "https://app.example.com",
      traceArmedForTraceId: "trace-1"
    });
    expect(chromeApi.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 7 },
      "Runtime.addBinding",
      expect.anything()
    );
    expect(chromeApi.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 7 },
      "Page.addScriptToEvaluateOnNewDocument",
      expect.anything()
    );
  });

  it("continues arming trace bindings when Runtime.addBinding is already registered", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.tabs.query.mockResolvedValue([{ id: 7, url: "https://app.example.com/settings" }]);
    chromeApi.debugger.sendCommand.mockImplementation(async (_target, method) => {
      if (method === "Runtime.addBinding") {
        throw new Error("binding already registered");
      }

      if (method === "Page.addScriptToEvaluateOnNewDocument") {
        return { identifier: "trace-script-1" };
      }

      return undefined;
    });
    const activeTrace = createActiveTrace();

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([
        { origin: "https://app.example.com", createdAt: "2026-04-08T00:00:00.000Z", dumpAllowlistPatterns: ["\\.js$"] }
      ]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({
        heartbeat: vi.fn().mockResolvedValue({
          version: "1.0.0",
          rootPath: "/tmp/server-root",
          sentinel: { rootId: "server-root" },
          baseUrl: "http://127.0.0.1:4319",
          mcpUrl: "http://127.0.0.1:4319/mcp",
          trpcUrl: "http://127.0.0.1:4319/trpc",
          activeTrace
        }),
        activeTrace
      }))
    });

    await runtime.start();
    await runtime.handleRuntimeMessage({ type: "session.start" });
    await flushPromises();

    expect(runtime.state.attachedTabs.get(7)).toMatchObject({
      traceScriptIdentifier: "trace-script-1",
      traceArmedForTraceId: "trace-1"
    });
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 7 }, "Runtime.addBinding", {
      name: "__wraithwalkerTraceBinding"
    });
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Page.addScriptToEvaluateOnNewDocument",
      expect.objectContaining({
        source: expect.stringContaining("__wraithwalkerTraceBinding")
      })
    );
  });

  it("re-arms traced tabs when the active trace changes", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.tabs.query.mockResolvedValue([{ id: 7, url: "https://app.example.com/settings" }]);
    const firstTrace = createActiveTrace();
    const secondTrace = createActiveTrace({ traceId: "trace-2" });
    let nextTrace = firstTrace;
    let injectedCount = 0;
    const heartbeat = vi.fn().mockImplementation(async () => ({
      version: "1.0.0",
      rootPath: "/tmp/server-root",
      sentinel: { rootId: "server-root" },
      baseUrl: "http://127.0.0.1:4319",
      mcpUrl: "http://127.0.0.1:4319/mcp",
      trpcUrl: "http://127.0.0.1:4319/trpc",
      activeTrace: nextTrace
    }));
    chromeApi.debugger.sendCommand.mockImplementation(async (_target, method) => {
      if (method === "Page.addScriptToEvaluateOnNewDocument") {
        injectedCount += 1;
        return { identifier: `trace-script-${injectedCount}` };
      }

      return undefined;
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([
        { origin: "https://app.example.com", createdAt: "2026-04-08T00:00:00.000Z", dumpAllowlistPatterns: ["\\.js$"] }
      ]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({ heartbeat, activeTrace: firstTrace }))
    });

    await runtime.start();
    await runtime.handleRuntimeMessage({ type: "session.start" });
    await flushPromises();

    expect(runtime.state.attachedTabs.get(7)?.traceScriptIdentifier).toBe("trace-script-1");

    nextTrace = secondTrace;
    chromeApi.alarms.onAlarm.listeners[0]({ name: "wraithwalker-server-heartbeat" });
    await flushPromises();

    expect(runtime.state.activeTrace?.traceId).toBe("trace-2");
    expect(runtime.state.attachedTabs.get(7)?.traceScriptIdentifier).toBe("trace-script-2");
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Page.removeScriptToEvaluateOnNewDocument",
      { identifier: "trace-script-1" }
    );
  });

  it("re-arms traced tabs even when removing the previous trace script fails", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.tabs.query.mockResolvedValue([{ id: 7, url: "https://app.example.com/settings" }]);
    const firstTrace = createActiveTrace();
    const secondTrace = createActiveTrace({ traceId: "trace-2" });
    let nextTrace = firstTrace;
    let injectedCount = 0;
    const heartbeat = vi.fn().mockImplementation(async () => ({
      version: "1.0.0",
      rootPath: "/tmp/server-root",
      sentinel: { rootId: "server-root" },
      baseUrl: "http://127.0.0.1:4319",
      mcpUrl: "http://127.0.0.1:4319/mcp",
      trpcUrl: "http://127.0.0.1:4319/trpc",
      activeTrace: nextTrace
    }));
    chromeApi.debugger.sendCommand.mockImplementation(async (_target, method) => {
      if (method === "Page.removeScriptToEvaluateOnNewDocument") {
        throw new Error("stale trace script");
      }

      if (method === "Page.addScriptToEvaluateOnNewDocument") {
        injectedCount += 1;
        return { identifier: `trace-script-${injectedCount}` };
      }

      return undefined;
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([
        { origin: "https://app.example.com", createdAt: "2026-04-08T00:00:00.000Z", dumpAllowlistPatterns: ["\\.js$"] }
      ]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({ heartbeat, activeTrace: firstTrace }))
    });

    await runtime.start();
    await runtime.handleRuntimeMessage({ type: "session.start" });
    await flushPromises();

    expect(runtime.state.attachedTabs.get(7)?.traceScriptIdentifier).toBe("trace-script-1");

    nextTrace = secondTrace;
    chromeApi.alarms.onAlarm.listeners[0]({ name: "wraithwalker-server-heartbeat" });
    await flushPromises();

    expect(runtime.state.activeTrace?.traceId).toBe("trace-2");
    expect(runtime.state.attachedTabs.get(7)?.traceScriptIdentifier).toBe("trace-script-2");
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Page.removeScriptToEvaluateOnNewDocument",
      { identifier: "trace-script-1" }
    );
  });

  it("keeps tabs attached without arming trace scripts when no active trace is available", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.tabs.query.mockResolvedValue([{ id: 7, url: "https://app.example.com/settings" }]);
    const heartbeat = vi.fn().mockResolvedValue({
      version: "1.0.0",
      rootPath: "/tmp/server-root",
      sentinel: { rootId: "server-root" },
      baseUrl: "http://127.0.0.1:4319",
      mcpUrl: "http://127.0.0.1:4319/mcp",
      trpcUrl: "http://127.0.0.1:4319/trpc",
      activeTrace: null
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([
        { origin: "https://app.example.com", createdAt: "2026-04-08T00:00:00.000Z", dumpAllowlistPatterns: ["\\.js$"] }
      ]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({ heartbeat, activeTrace: null }))
    });

    await runtime.start();
    await runtime.handleRuntimeMessage({ type: "session.start" });
    await flushPromises();

    expect(runtime.state.attachedTabs.get(7)?.traceScriptIdentifier).toBeNull();
    expect(chromeApi.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 7 },
      "Runtime.addBinding",
      expect.anything()
    );
    expect(chromeApi.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 7 },
      "Page.addScriptToEvaluateOnNewDocument",
      expect.anything()
    );
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Runtime.evaluate",
      {
        expression: "globalThis.__wraithwalkerDisableTrace?.()",
        awaitPromise: false,
        returnByValue: false
      }
    );
  });

  it("ignores tabs that disappear before trace disarm runs", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.tabs.query.mockResolvedValue([{ id: 7, url: "https://app.example.com/settings" }]);
    const activeTrace = createActiveTrace();
    const heartbeat = vi.fn()
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace
      })
      .mockResolvedValueOnce({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        activeTrace
      })
      .mockRejectedValueOnce(new Error("server offline"));
    let injectedCount = 0;
    chromeApi.debugger.sendCommand.mockImplementation(async (_target, method) => {
      if (method === "Page.addScriptToEvaluateOnNewDocument") {
        injectedCount += 1;
        return { identifier: `trace-script-${injectedCount}` };
      }

      return undefined;
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([
        { origin: "https://app.example.com", createdAt: "2026-04-08T00:00:00.000Z", dumpAllowlistPatterns: ["\\.js$"] }
      ]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({ heartbeat, activeTrace }))
    });

    await runtime.start();
    await runtime.handleRuntimeMessage({ type: "session.start" });
    await flushPromises();

    const originalKeys = runtime.state.attachedTabs.keys.bind(runtime.state.attachedTabs);
    const attachedTabs = runtime.state.attachedTabs as Map<number, unknown> & { keys: typeof runtime.state.attachedTabs.keys };
    attachedTabs.keys = function* () {
      for (const tabId of originalKeys()) {
        yield tabId;
        runtime.state.attachedTabs.delete(tabId);
      }
    };
    chromeApi.debugger.sendCommand.mockClear();

    chromeApi.alarms.onAlarm.listeners[0]({ name: "wraithwalker-server-heartbeat" });
    await flushPromises();

    expect(runtime.state.serverInfo).toBeNull();
    expect(runtime.state.activeTrace).toBeNull();
    expect(runtime.state.attachedTabs.size).toBe(0);
    expect(chromeApi.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 7 },
      "Page.removeScriptToEvaluateOnNewDocument",
      expect.anything()
    );
    expect(chromeApi.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 7 },
      "Runtime.evaluate",
      expect.objectContaining({
        expression: "globalThis.__wraithwalkerDisableTrace?.()"
      })
    );
  });

  it("disarms trace bindings during session stop even when debugger cleanup commands fail", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.tabs.query.mockResolvedValue([{ id: 7, url: "https://app.example.com/settings" }]);
    chromeApi.debugger.sendCommand.mockImplementation(async (_target, method, params) => {
      if (method === "Page.addScriptToEvaluateOnNewDocument") {
        return { identifier: "trace-script-1" };
      }

      if (method === "Page.removeScriptToEvaluateOnNewDocument") {
        throw new Error("stale trace script");
      }

      if (method === "Runtime.evaluate" && (params as { expression?: string } | undefined)?.expression === "globalThis.__wraithwalkerDisableTrace?.()") {
        throw new Error("execution context missing");
      }

      return undefined;
    });
    const activeTrace = createActiveTrace();

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([
        { origin: "https://app.example.com", createdAt: "2026-04-08T00:00:00.000Z", dumpAllowlistPatterns: ["\\.js$"] }
      ]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({
        heartbeat: vi.fn().mockResolvedValue({
          version: "1.0.0",
          rootPath: "/tmp/server-root",
          sentinel: { rootId: "server-root" },
          baseUrl: "http://127.0.0.1:4319",
          mcpUrl: "http://127.0.0.1:4319/mcp",
          trpcUrl: "http://127.0.0.1:4319/trpc",
          activeTrace
        }),
        activeTrace
      }))
    });

    await runtime.start();
    await runtime.handleRuntimeMessage({ type: "session.start" });
    await flushPromises();

    expect(runtime.state.attachedTabs.get(7)?.traceScriptIdentifier).toBe("trace-script-1");

    const snapshot = await runtime.handleRuntimeMessage({ type: "session.stop" });

    expect("sessionActive" in snapshot && snapshot.sessionActive).toBe(false);
    expect(runtime.state.attachedTabs.has(7)).toBe(false);
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Page.removeScriptToEvaluateOnNewDocument",
      { identifier: "trace-script-1" }
    );
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Runtime.evaluate",
      {
        expression: "globalThis.__wraithwalkerDisableTrace?.()",
        awaitPromise: false,
        returnByValue: false
      }
    );
    expect(chromeApi.debugger.detach).toHaveBeenCalledWith({ tabId: 7 });
  });

  it("forwards debugger binding payloads to the server and links persisted fixtures to the active trace", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const activeTrace = createActiveTrace();
    const recordTraceClick = vi.fn().mockResolvedValue({
      recorded: true,
      activeTrace: createActiveTrace({
        status: "recording",
        steps: [{
          stepId: "step-1",
          tabId: 3,
          recordedAt: "2026-04-08T00:00:01.000Z",
          pageUrl: "https://app.example.com/settings",
          topOrigin: "https://app.example.com",
          selector: "#save-button",
          tagName: "button",
          textSnippet: "Save",
          linkedFixtures: []
        }]
      })
    });
    const linkTraceFixture = vi.fn().mockResolvedValue({
      linked: true,
      trace: createActiveTrace({
        status: "recording",
        steps: [{
          stepId: "step-1",
          tabId: 3,
          recordedAt: "2026-04-08T00:00:01.000Z",
          pageUrl: "https://app.example.com/settings",
          topOrigin: "https://app.example.com",
          selector: "#save-button",
          tagName: "button",
          textSnippet: "Save",
          linkedFixtures: [{
            bodyPath: "cdn.example.com/assets/app.js",
            requestUrl: "https://cdn.example.com/assets/app.js",
            resourceType: "Script",
            capturedAt: "2026-04-08T00:00:02.500Z"
          }]
        }]
      })
    });
    let requestLifecycleDependencies: any;

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({
        activeTrace,
        heartbeat: vi.fn().mockResolvedValue({
          version: "1.0.0",
          rootPath: "/tmp/server-root",
          sentinel: { rootId: "server-root" },
          baseUrl: "http://127.0.0.1:4319",
          mcpUrl: "http://127.0.0.1:4319/mcp",
          trpcUrl: "http://127.0.0.1:4319/trpc",
          activeTrace
        }),
        recordTraceClick,
        linkTraceFixture
      })),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn((dependencies) => {
        requestLifecycleDependencies = dependencies;
        return {
          handleFetchRequestPaused: vi.fn(),
          handleNetworkRequestWillBeSent: vi.fn(),
          handleNetworkResponseReceived: vi.fn(),
          handleNetworkLoadingFinished: vi.fn(),
          handleNetworkLoadingFailed: vi.fn()
        };
      })
    });

    await runtime.start();
    await flushPromises();
    runtime.state.serverInfo = {
      rootPath: "/tmp/server-root",
      sentinel: { rootId: "server-root" },
      baseUrl: "http://127.0.0.1:4319",
      mcpUrl: "http://127.0.0.1:4319/mcp",
      trpcUrl: "http://127.0.0.1:4319/trpc"
    };
    runtime.state.activeTrace = activeTrace;
    runtime.state.attachedTabs.set(3, { topOrigin: "https://app.example.com" });

    await runtime.handleDebuggerEvent(
      { tabId: 3 },
      "Runtime.bindingCalled",
      {
        name: "__wraithwalkerTraceBinding",
        payload: JSON.stringify({
          pageUrl: "https://app.example.com/settings",
          topOrigin: "https://app.example.com",
          selector: "#save-button",
          tagName: "button",
          textSnippet: "Save",
          recordedAt: "2026-04-08T00:00:01.000Z"
        })
      }
    );

    expect(recordTraceClick).toHaveBeenCalledWith(expect.objectContaining({
      traceId: "trace-1",
      step: expect.objectContaining({
        tabId: 3,
        selector: "#save-button"
      })
    }));

    await requestLifecycleDependencies.onFixturePersisted({
      descriptor: {
        bodyPath: "cdn.example.com/assets/app.js",
        requestUrl: "https://cdn.example.com/assets/app.js"
      },
      entry: {
        tabId: 3,
        requestId: "request-1",
        requestedAt: "2026-04-08T00:00:02.000Z",
        topOrigin: "https://app.example.com",
        method: "GET",
        url: "https://cdn.example.com/assets/app.js",
        requestHeaders: [],
        requestBody: "",
        requestBodyEncoding: "utf8",
        descriptor: null,
        resourceType: "Script",
        mimeType: "application/javascript",
        replayed: false,
        responseStatus: 200,
        responseStatusText: "OK",
        responseHeaders: []
      },
      capturedAt: "2026-04-08T00:00:02.500Z"
    });

    expect(linkTraceFixture).toHaveBeenCalledWith({
      traceId: "trace-1",
      tabId: 3,
      requestedAt: "2026-04-08T00:00:02.000Z",
      fixture: {
        bodyPath: "cdn.example.com/assets/app.js",
        requestUrl: "https://cdn.example.com/assets/app.js",
        resourceType: "Script",
        capturedAt: "2026-04-08T00:00:02.500Z"
      }
    });
  });

  it("marks the server offline when linking a persisted fixture to an active trace fails", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const activeTrace = createActiveTrace();
    let requestLifecycleDependencies: any;

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([{
        origin: "https://local.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.json$"]
      }]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({
        activeTrace,
        heartbeat: vi.fn().mockResolvedValue({
          version: "1.0.0",
          rootPath: "/tmp/server-root",
          sentinel: { rootId: "server-root" },
          baseUrl: "http://127.0.0.1:4319",
          mcpUrl: "http://127.0.0.1:4319/mcp",
          trpcUrl: "http://127.0.0.1:4319/trpc",
          siteConfigs: [{
            origin: "https://server.example.com",
            createdAt: "2026-04-08T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.svg$"]
          }],
          activeTrace
        }),
        linkTraceFixture: vi.fn().mockRejectedValue(new Error("link failed"))
      })),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn((dependencies) => {
        requestLifecycleDependencies = dependencies;
        return {
          handleFetchRequestPaused: vi.fn(),
          handleNetworkRequestWillBeSent: vi.fn(),
          handleNetworkResponseReceived: vi.fn(),
          handleNetworkLoadingFinished: vi.fn(),
          handleNetworkLoadingFailed: vi.fn()
        };
      })
    });

    await runtime.start();
    await flushPromises();

    expect(runtime.state.enabledOrigins).toEqual(["https://server.example.com"]);

    await requestLifecycleDependencies.onFixturePersisted({
      descriptor: {
        bodyPath: "cdn.example.com/assets/app.js",
        requestUrl: "https://cdn.example.com/assets/app.js"
      },
      entry: {
        tabId: 3,
        requestId: "request-1",
        requestedAt: "2026-04-08T00:00:02.000Z",
        topOrigin: "https://app.example.com",
        method: "GET",
        url: "https://cdn.example.com/assets/app.js",
        requestHeaders: [],
        requestBody: "",
        requestBodyEncoding: "utf8",
        descriptor: null,
        resourceType: "Script",
        mimeType: "application/javascript",
        replayed: false,
        responseStatus: 200,
        responseStatusText: "OK",
        responseHeaders: []
      },
      capturedAt: "2026-04-08T00:00:02.500Z"
    });

    expect(runtime.state.serverInfo).toBeNull();
    expect(runtime.state.activeTrace).toBeNull();
    expect(runtime.state.enabledOrigins).toEqual(["https://local.example.com"]);
  });

  it("returns null when the server reports that a fixture does not exist", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const serverSentinel = { rootId: "server-root" };
    let requestLifecycleDependencies: any;

    const serverClient = createMockServerClient({
      getSystemInfo: vi.fn().mockResolvedValue({
        version: "0.6.1",
        rootPath: "/tmp/server-root",
        sentinel: serverSentinel,
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc"
      }),
      hasFixture: vi.fn(),
      readFixture: vi.fn().mockResolvedValue({
        exists: false,
        sentinel: serverSentinel
      }),
      writeFixtureIfAbsent: vi.fn(),
      generateContext: vi.fn()
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        launchPath: "/tmp/local-root"
      }),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => serverClient),
      initialState: {
        localRootReady: true,
        localRootSentinel: { rootId: "local-root" },
        rootReady: true,
        rootSentinel: { rootId: "local-root" }
      },
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn((dependencies) => {
        requestLifecycleDependencies = dependencies;
        return {
          handleFetchRequestPaused: vi.fn(),
          handleNetworkRequestWillBeSent: vi.fn(),
          handleNetworkResponseReceived: vi.fn(),
          handleNetworkLoadingFinished: vi.fn(),
          handleNetworkLoadingFailed: vi.fn()
        };
      })
    });

    await runtime.start();
    await flushPromises();

    const descriptor = {
      bodyPath: "cdn.example.com/assets/missing.js",
      requestPath: "cdn.example.com/assets/missing.js.__request.json",
      metaPath: "cdn.example.com/assets/missing.js.__response.json"
    } as any;

    await expect(requestLifecycleDependencies.repository.read(descriptor)).resolves.toBeNull();
    expect(serverClient.readFixture).toHaveBeenCalledWith(descriptor);
    expect(chromeApi.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("falls back to the local root when a server-backed fixture read fails", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const serverSentinel = { rootId: "server-root" };
    const localSentinel = { rootId: "local-root" };
    let requestLifecycleDependencies: any;

    const descriptor = {
      bodyPath: "cdn.example.com/assets/app.js",
      requestPath: "cdn.example.com/assets/app.js.__request.json",
      metaPath: "cdn.example.com/assets/app.js.__response.json"
    } as any;

    const serverClient = createMockServerClient({
      getSystemInfo: vi.fn().mockResolvedValue({
        version: "0.6.1",
        rootPath: "/tmp/server-root",
        sentinel: serverSentinel,
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc"
      }),
      hasFixture: vi.fn(),
      readFixture: vi.fn().mockRejectedValue(new Error("Server read failed.")),
      writeFixtureIfAbsent: vi.fn(),
      generateContext: vi.fn()
    });

    chromeApi.runtime.sendMessage
      .mockResolvedValueOnce({
        ok: true,
        sentinel: localSentinel,
        permission: "granted"
      })
      .mockResolvedValueOnce({
        ok: true,
        exists: true,
        request: {
          topOrigin: "https://app.example.com",
          url: "https://cdn.example.com/assets/app.js",
          method: "GET",
          headers: [],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: "",
          queryHash: "",
          capturedAt: "2026-04-07T00:00:00.000Z"
        },
        meta: {
          status: 200,
          statusText: "OK",
          headers: [{ name: "Content-Type", value: "application/javascript" }],
          mimeType: "application/javascript",
          resourceType: "Script",
          url: "https://cdn.example.com/assets/app.js",
          method: "GET",
          capturedAt: "2026-04-07T00:00:00.000Z",
          bodyEncoding: "utf8",
          bodySuggestedExtension: "js"
        },
        bodyBase64: "Y29uc29sZS5sb2coJ2xvY2FsJyk7",
        size: 21,
        sentinel: localSentinel
      });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        launchPath: "/tmp/local-root"
      }),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => serverClient),
      initialState: {
        localRootReady: true,
        localRootSentinel: localSentinel,
        rootReady: true,
        rootSentinel: localSentinel
      },
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn((dependencies) => {
        requestLifecycleDependencies = dependencies;
        return {
          handleFetchRequestPaused: vi.fn(),
          handleNetworkRequestWillBeSent: vi.fn(),
          handleNetworkResponseReceived: vi.fn(),
          handleNetworkLoadingFinished: vi.fn(),
          handleNetworkLoadingFailed: vi.fn()
        };
      })
    });

    await runtime.start();
    await flushPromises();

    await expect(requestLifecycleDependencies.repository.read(descriptor)).resolves.toEqual({
      request: expect.objectContaining({
        topOrigin: "https://app.example.com",
        url: "https://cdn.example.com/assets/app.js"
      }),
      meta: expect.objectContaining({
        status: 200,
        mimeType: "application/javascript"
      }),
      bodyBase64: "Y29uc29sZS5sb2coJ2xvY2FsJyk7",
      size: 21
    });
    expect(runtime.state.serverInfo).toBeNull();
    expect(runtime.state.rootSentinel).toEqual(localSentinel);
    expect(chromeApi.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
      target: "offscreen",
      type: "fs.ensureRoot",
      payload: { requestPermission: false }
    });
    expect(chromeApi.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      target: "offscreen",
      type: "fs.readFixture",
      payload: { descriptor }
    });
  });

  it("falls back to the local root when a server-backed fixture write fails", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const serverSentinel = { rootId: "server-root" };
    const localSentinel = { rootId: "local-root" };
    let requestLifecycleDependencies: any;

    const payload = {
      descriptor: {
        bodyPath: "cdn.example.com/assets/app.js",
        requestPath: "cdn.example.com/assets/app.js.__request.json",
        metaPath: "cdn.example.com/assets/app.js.__response.json"
      },
      request: {
        topOrigin: "https://app.example.com",
        url: "https://cdn.example.com/assets/app.js",
        method: "GET",
        headers: [],
        body: "",
        bodyEncoding: "utf8",
        bodyHash: "",
        queryHash: "",
        capturedAt: "2026-04-07T00:00:00.000Z"
      },
      response: {
        body: "console.log('local');",
        bodyEncoding: "utf8" as const,
        meta: {
          status: 200,
          statusText: "OK",
          headers: [{ name: "Content-Type", value: "application/javascript" }],
          mimeType: "application/javascript",
          resourceType: "Script",
          url: "https://cdn.example.com/assets/app.js",
          method: "GET",
          capturedAt: "2026-04-07T00:00:00.000Z",
          bodyEncoding: "utf8" as const,
          bodySuggestedExtension: "js"
        }
      }
    };

    const serverClient = createMockServerClient({
      getSystemInfo: vi.fn().mockResolvedValue({
        version: "0.6.1",
        rootPath: "/tmp/server-root",
        sentinel: serverSentinel,
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc"
      }),
      hasFixture: vi.fn(),
      readFixture: vi.fn(),
      writeFixtureIfAbsent: vi.fn().mockRejectedValue(new Error("Server write failed.")),
      generateContext: vi.fn()
    });

    chromeApi.runtime.sendMessage
      .mockResolvedValueOnce({
        ok: true,
        sentinel: localSentinel,
        permission: "granted"
      })
      .mockResolvedValueOnce({
        ok: true,
        descriptor: payload.descriptor,
        sentinel: localSentinel
      });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        launchPath: "/tmp/local-root"
      }),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => serverClient),
      initialState: {
        localRootReady: true,
        localRootSentinel: localSentinel,
        rootReady: true,
        rootSentinel: localSentinel
      },
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn((dependencies) => {
        requestLifecycleDependencies = dependencies;
        return {
          handleFetchRequestPaused: vi.fn(),
          handleNetworkRequestWillBeSent: vi.fn(),
          handleNetworkResponseReceived: vi.fn(),
          handleNetworkLoadingFinished: vi.fn(),
          handleNetworkLoadingFailed: vi.fn()
        };
      })
    });

    await runtime.start();
    await flushPromises();

    await expect(requestLifecycleDependencies.repository.writeIfAbsent(payload)).resolves.toEqual({
      written: true,
      descriptor: payload.descriptor,
      sentinel: localSentinel
    });
    expect(runtime.state.serverInfo).toBeNull();
    expect(runtime.state.rootSentinel).toEqual(localSentinel);
    expect(chromeApi.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
      target: "offscreen",
      type: "fs.ensureRoot",
      payload: { requestPermission: false }
    });
    expect(chromeApi.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      target: "offscreen",
      type: "fs.writeFixture",
      payload
    });
  });

  it("surfaces a combined error when the server is unavailable and no fallback root is ready", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const serverSentinel = { rootId: "server-root" };
    let requestLifecycleDependencies: any;

    const payload = {
      descriptor: {
        bodyPath: "cdn.example.com/assets/app.js",
        requestPath: "cdn.example.com/assets/app.js.__request.json",
        metaPath: "cdn.example.com/assets/app.js.__response.json"
      },
      request: {
        topOrigin: "https://app.example.com",
        url: "https://cdn.example.com/assets/app.js",
        method: "GET",
        headers: [],
        body: "",
        bodyEncoding: "utf8",
        bodyHash: "",
        queryHash: "",
        capturedAt: "2026-04-07T00:00:00.000Z"
      },
      response: {
        body: "console.log('server');",
        bodyEncoding: "utf8" as const,
        meta: {
          status: 200,
          statusText: "OK",
          headers: [{ name: "Content-Type", value: "application/javascript" }],
          mimeType: "application/javascript",
          resourceType: "Script",
          url: "https://cdn.example.com/assets/app.js",
          method: "GET",
          capturedAt: "2026-04-07T00:00:00.000Z",
          bodyEncoding: "utf8" as const,
          bodySuggestedExtension: "js"
        }
      }
    };

    const serverClient = createMockServerClient({
      getSystemInfo: vi.fn().mockResolvedValue({
        version: "0.6.1",
        rootPath: "/tmp/server-root",
        sentinel: serverSentinel,
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc"
      }),
      hasFixture: vi.fn(),
      readFixture: vi.fn(),
      writeFixtureIfAbsent: vi.fn().mockRejectedValue(new Error("Server write failed.")),
      generateContext: vi.fn()
    });

    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: false,
      error: "Root directory access is not granted."
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => serverClient),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn((dependencies) => {
        requestLifecycleDependencies = dependencies;
        return {
          handleFetchRequestPaused: vi.fn(),
          handleNetworkRequestWillBeSent: vi.fn(),
          handleNetworkResponseReceived: vi.fn(),
          handleNetworkLoadingFinished: vi.fn(),
          handleNetworkLoadingFailed: vi.fn()
        };
      })
    });

    await runtime.start();
    await flushPromises();

    await expect(requestLifecycleDependencies.repository.writeIfAbsent(payload)).rejects.toThrow(
      "Local WraithWalker server is unavailable and no fallback root is ready. Server write failed."
    );
    expect(runtime.state.serverInfo).toBeNull();
    expect(runtime.state.rootReady).toBe(false);
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      target: "offscreen",
      type: "fs.ensureRoot",
      payload: { requestPermission: false }
    });
  });

  it("routes debugger events into the request lifecycle handlers", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const requestLifecycle = {
      handleFetchRequestPaused: vi.fn().mockResolvedValue(undefined),
      handleNetworkRequestWillBeSent: vi.fn(),
      handleNetworkResponseReceived: vi.fn(),
      handleNetworkLoadingFinished: vi.fn().mockResolvedValue(undefined),
      handleNetworkLoadingFailed: vi.fn()
    };

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => requestLifecycle)
    });

    await runtime.start();
    chromeApi.debugger.onEvent.listeners[0]({ tabId: 1 }, "Fetch.requestPaused", { requestId: "fetch-1" });
    chromeApi.debugger.onEvent.listeners[0]({ tabId: 1 }, "Network.loadingFinished", { requestId: "req-1" });
    chromeApi.debugger.onEvent.listeners[0]({ tabId: 1 }, "Network.loadingFailed", { requestId: "req-1" });
    await flushPromises();

    expect(requestLifecycle.handleFetchRequestPaused).toHaveBeenCalledWith({ tabId: 1 }, { requestId: "fetch-1" });
    expect(requestLifecycle.handleNetworkLoadingFinished).toHaveBeenCalledWith({ tabId: 1 }, { requestId: "req-1" });
    expect(requestLifecycle.handleNetworkLoadingFailed).toHaveBeenCalledWith({ tabId: 1 }, { requestId: "req-1" });
  });

  it("executes the debugger and offscreen wrappers exposed to the request lifecycle", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({ ok: true, sentinel: { rootId: "root-1" }, permission: "granted" });
    const requestLifecycleFactory = vi.fn((deps) => ({
      handleFetchRequestPaused: vi.fn(async () => {
        await deps.sendDebuggerCommand(9, "Fetch.continueRequest", { requestId: "fetch-9" });
      }),
      handleNetworkRequestWillBeSent: vi.fn(),
      handleNetworkResponseReceived: vi.fn(),
      handleNetworkLoadingFinished: vi.fn(async () => {
        await deps.sendOffscreenMessage("fs.ensureRoot", { requestPermission: true });
      }),
      handleNetworkLoadingFailed: vi.fn()
    }));

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: requestLifecycleFactory
    });

    await runtime.start();
    await runtime.handleDebuggerEvent({ tabId: 9 }, "Fetch.requestPaused", { requestId: "fetch-9" });
    await runtime.handleDebuggerEvent({ tabId: 9 }, "Network.loadingFinished", { requestId: "load-9" });

    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 9 }, "Fetch.continueRequest", { requestId: "fetch-9" });
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      target: "offscreen",
      type: "fs.ensureRoot",
      payload: { requestPermission: true }
    });
  });

  it("dispatches runtime session messages through the registered message listener", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const sessionSnapshot = {
      sessionActive: true,
      attachedTabIds: [1],
      enabledOrigins: ["https://app.example.com"],
      rootReady: true,
      lastError: ""
    };
    const sessionController = {
      startSession: vi.fn().mockResolvedValue(sessionSnapshot),
      stopSession: vi.fn().mockResolvedValue(sessionSnapshot),
      reconcileTabs: vi.fn(),
      handleTabStateChange: vi.fn()
    };

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => sessionController),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    const sendResponse = vi.fn();
    const handled = chromeApi.runtime.onMessage.listeners[0]({ type: "session.start" }, {}, sendResponse);
    await flushPromises();

    expect(handled).toBe(true);
    expect(sessionController.startSession).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(sessionSnapshot);
  });

  it("ignores unrelated runtime messages and returns listener errors to the sender", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const sessionController = {
      startSession: vi.fn().mockRejectedValue(new Error("Session failed.")),
      stopSession: vi.fn(),
      reconcileTabs: vi.fn(),
      handleTabStateChange: vi.fn()
    };

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => sessionController),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();

    expect(chromeApi.runtime.onMessage.listeners[0]({ target: "offscreen", type: "fs.ensureRoot" }, {}, vi.fn())).toBeUndefined();

    const sendResponse = vi.fn();
    const handled = chromeApi.runtime.onMessage.listeners[0]({ type: "session.start" }, {}, sendResponse);
    await flushPromises();

    expect(handled).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "Session failed." });
    expect(runtime.state.lastError).toBe("Session failed.");
  });

  it("verifies and opens the native directory through the runtime actions", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: true,
      sentinel: { rootId: "root-1" },
      permission: "granted"
    });
    chromeApi.runtime.sendNativeMessage
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      }),
      getPreferredEditorId: vi.fn().mockResolvedValue("windsurf"),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.handleRuntimeMessage({ type: "native.open", editorId: "windsurf" });

    expect(chromeApi.offscreen.createDocument).toHaveBeenCalled();
    expect(chromeApi.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
      target: "offscreen",
      type: "fs.generateContext",
      payload: {
        siteConfigs: [],
        editorId: "windsurf"
      }
    });
    expect(chromeApi.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      target: "offscreen",
      type: "fs.ensureRoot",
      payload: { requestPermission: true }
    });
    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenNthCalledWith(1, "com.example.host", {
      type: "verifyRoot",
      path: "/tmp/fixtures",
      expectedRootId: "root-1"
    });
    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenNthCalledWith(2, "com.example.host", {
      type: "openDirectory",
      path: "/tmp/fixtures",
      expectedRootId: "root-1",
      commandTemplate: 'windsurf "$DIR"'
    });
    expect(chromeApi.tabs.create).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("opens the directory through an editor URL template when one is available", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage
      .mockResolvedValueOnce({ ok: true }) // fs.generateContext
      .mockResolvedValueOnce({
        ok: true,
        sentinel: { rootId: "root-1" },
        permission: "granted"
      });
    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        launchPath: "/tmp/fixtures"
      }),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.handleRuntimeMessage({ type: "native.open", editorId: "vscode" });

    expect(chromeApi.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
      target: "offscreen",
      type: "fs.generateContext",
      payload: {
        siteConfigs: [],
        editorId: "vscode"
      }
    });
    expect(chromeApi.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      target: "offscreen",
      type: "fs.ensureRoot",
      payload: { requestPermission: true }
    });
    expect(chromeApi.tabs.create).toHaveBeenCalledWith({
      url: "vscode://file//tmp/fixtures/"
    });
    expect(chromeApi.runtime.sendNativeMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("uses Cursor URL launch by default when no editor id is provided", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage
      .mockResolvedValueOnce({ ok: true }) // fs.generateContext
      .mockResolvedValueOnce({
        ok: true,
        sentinel: { rootId: "root-1" },
        permission: "granted"
      });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([
        { origin: "https://app.example.com", createdAt: "2026-04-07T00:00:00.000Z", dumpAllowlistPatterns: ["\\.js$"] }
      ]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        launchPath: "/tmp/fixtures"
      }),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.handleRuntimeMessage({ type: "native.open" });

    expect(chromeApi.tabs.create).toHaveBeenNthCalledWith(1, {
      url: "cursor://file//tmp/fixtures/"
    });
    expect(chromeApi.tabs.create).toHaveBeenNthCalledWith(2, {
      url: expect.stringContaining("cursor://anysphere.cursor-deeplink/prompt?text=")
    });
    const promptUrl = chromeApi.tabs.create.mock.calls[1][0].url;
    expect(decodeURIComponent(promptUrl.split("text=")[1])).toContain("Selected origins: https://app.example.com.");
    expect(decodeURIComponent(promptUrl.split("text=")[1])).toContain("Prettify");
    expect(chromeApi.runtime.sendNativeMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("prefers a custom URL override over the editor's built-in URL template", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage
      .mockResolvedValueOnce({ ok: true }) // fs.generateContext
      .mockResolvedValueOnce({
        ok: true,
        sentinel: { rootId: "root-1" },
        permission: "granted"
      });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        launchPath: "/tmp/fixtures",
        editorLaunchOverrides: {
          vscode: {
            urlTemplate: "custom-vscode://open?folder=$DIR_COMPONENT"
          }
        }
      }),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.handleRuntimeMessage({ type: "native.open", editorId: "vscode" });

    expect(chromeApi.tabs.create).toHaveBeenCalledWith({
      url: "custom-vscode://open?folder=%2Ftmp%2Ffixtures"
    });
    expect(chromeApi.runtime.sendNativeMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("returns the URL-launch error instead of falling back to native messaging", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.tabs.create.mockRejectedValueOnce(new Error("External protocol handler failed."));
    chromeApi.runtime.sendMessage
      .mockResolvedValueOnce({ ok: true }) // fs.generateContext
      .mockResolvedValueOnce({
        ok: true,
        sentinel: { rootId: "root-1" },
        permission: "granted"
      });
    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures",
        editorLaunchOverrides: {
          cursor: {
            urlTemplate: "custom://open?folder=$DIR_COMPONENT"
          }
        }
      }),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.openDirectoryInEditor(undefined, "cursor");

    expect(chromeApi.tabs.create).toHaveBeenNthCalledWith(1, {
      url: "custom://open?folder=%2Ftmp%2Ffixtures"
    });
    expect(chromeApi.tabs.create).toHaveBeenCalledTimes(1);
    expect(chromeApi.runtime.sendNativeMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "External protocol handler failed." });
  });

  it("returns the URL-template launch error when no native fallback is configured", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.tabs.create.mockRejectedValueOnce(new Error("No application is registered for the URL."));
    chromeApi.runtime.sendMessage
      .mockResolvedValueOnce({ ok: true }) // fs.generateContext
      .mockResolvedValueOnce({
        ok: true,
        sentinel: { rootId: "root-1" },
        permission: "granted"
      });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "",
        launchPath: "/tmp/fixtures",
        editorLaunchOverrides: {
          cursor: {
            urlTemplate: "custom://open?folder=$DIR_COMPONENT"
          }
        }
      }),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.openDirectoryInEditor(undefined, "cursor");

    expect(chromeApi.runtime.sendNativeMessage).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: "No application is registered for the URL."
    });
  });

  it("opens Cursor itself when no absolute launch path is available", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage
      .mockResolvedValueOnce({ ok: true }) // fs.generateContext
      .mockResolvedValueOnce({
        ok: true,
        sentinel: { rootId: "root-1" },
        permission: "granted"
      });
    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: ""
      }),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.openDirectoryInEditor(undefined, "cursor");

    expect(chromeApi.tabs.create).toHaveBeenCalledWith({
      url: expect.stringContaining("cursor://anysphere.cursor-deeplink/prompt?text=")
    });
    expect(chromeApi.tabs.create).toHaveBeenCalledTimes(1);
    expect(chromeApi.runtime.sendNativeMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("reveals the configured launch root through the native host", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: true,
      sentinel: { rootId: "root-1" },
      permission: "granted"
    });
    chromeApi.runtime.sendNativeMessage.mockResolvedValue({ ok: true });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      }),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.handleRuntimeMessage({ type: "native.revealRoot" });

    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenCalledWith("com.example.host", {
      type: "revealDirectory",
      path: "/tmp/fixtures",
      expectedRootId: "root-1"
    });
    expect(result).toEqual({ ok: true });
  });

  it("requires a native host name before revealing the launch root", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: true,
      sentinel: { rootId: "root-1" },
      permission: "granted"
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "",
        launchPath: "/tmp/fixtures"
      }),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await expect(runtime.handleRuntimeMessage({ type: "native.revealRoot" })).resolves.toEqual({
      ok: false,
      error: "Configure the native host name and shared editor launch path in the options page first."
    });
    expect(chromeApi.runtime.sendNativeMessage).not.toHaveBeenCalled();
  });

  it("prefers the connected server root when revealing the active folder", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendNativeMessage.mockResolvedValue({ ok: true });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/local-launch"
      }),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({
        heartbeat: vi.fn().mockResolvedValue({
          version: "1.0.0",
          rootPath: "/tmp/server-root",
          sentinel: { rootId: "server-root" },
          baseUrl: "http://127.0.0.1:4319",
          mcpUrl: "http://127.0.0.1:4319/mcp",
          trpcUrl: "http://127.0.0.1:4319/trpc",
          siteConfigs: [],
          activeTrace: null
        })
      })),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await flushPromises();

    const result = await runtime.handleRuntimeMessage({ type: "native.revealRoot" });

    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenCalledWith("com.example.host", {
      type: "revealDirectory",
      path: "/tmp/server-root",
      expectedRootId: "server-root"
    });
    expect(result).toEqual({ ok: true });
  });

  it("surfaces reveal-root target resolution failures before calling the native host", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: false,
      error: "Root directory access is not granted."
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      }),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await expect(runtime.handleRuntimeMessage({ type: "native.revealRoot" })).resolves.toEqual({
      ok: false,
      error: "Root directory access is not granted."
    });
    expect(chromeApi.runtime.sendNativeMessage).not.toHaveBeenCalled();
  });

  it("returns a clear error when opening a native-host editor without a shared launch path", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: true,
      sentinel: { rootId: "root-1" },
      permission: "granted"
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: ""
      }),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.handleRuntimeMessage({ type: "native.open", editorId: "windsurf" });

    expect(result).toEqual({
      ok: false,
      error: "Configure the shared editor launch path in the options page first."
    });
    expect(chromeApi.runtime.sendNativeMessage).not.toHaveBeenCalled();
    expect(chromeApi.tabs.create).not.toHaveBeenCalled();
  });

  it("returns scenario action errors when no launch target can be resolved", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: false,
      error: "Root directory access is not granted."
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      }),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await expect(runtime.handleRuntimeMessage({ type: "scenario.list" })).resolves.toEqual({
      ok: false,
      error: "Root directory access is not granted."
    });
    await expect(runtime.handleRuntimeMessage({ type: "scenario.save", name: "release" })).resolves.toEqual({
      ok: false,
      error: "Root directory access is not granted."
    });
    await expect(runtime.handleRuntimeMessage({ type: "scenario.switch", name: "baseline" })).resolves.toEqual({
      ok: false,
      error: "Root directory access is not granted."
    });
    expect(chromeApi.runtime.sendNativeMessage).not.toHaveBeenCalled();
  });

  it("surfaces native reveal-root failures", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: true,
      sentinel: { rootId: "root-1" },
      permission: "granted"
    });
    chromeApi.runtime.sendNativeMessage.mockResolvedValue({ ok: false, error: "Reveal failed." });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      }),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await expect(runtime.handleRuntimeMessage({ type: "native.revealRoot" })).resolves.toEqual({
      ok: false,
      error: "Reveal failed."
    });
  });

  it("surfaces native verification failures and root-sentinel errors", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const blockedRuntime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      }),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    chromeApi.runtime.sendMessage.mockResolvedValueOnce({ ok: false, error: "Root directory access is not granted." });
    await expect(blockedRuntime.verifyNativeHostRoot()).resolves.toEqual({
      ok: false,
      error: "Root directory access is not granted."
    });
    expect(blockedRuntime.state.lastError).toBe("Root directory access is not granted.");

    const sentinelRuntime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      }),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    chromeApi.runtime.sendMessage
      .mockResolvedValueOnce({ ok: true })  // fs.generateContext
      .mockResolvedValueOnce({ ok: true, permission: "granted" });  // fs.ensureRoot
    await expect(sentinelRuntime.openDirectoryInEditor()).resolves.toEqual({
      ok: false,
      error: "Root sentinel is missing a rootId."
    });
  });

  it("requests root permission when handling explicit verify actions", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: true,
      sentinel: { rootId: "root-1" },
      permission: "granted"
    });
    chromeApi.runtime.sendNativeMessage.mockResolvedValue({ ok: true });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      }),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.handleRuntimeMessage({ type: "root.verify" });
    expect(chromeApi.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
      target: "offscreen",
      type: "fs.ensureRoot",
      payload: { requestPermission: true }
    });

    await runtime.handleRuntimeMessage({ type: "native.verify" });
    expect(chromeApi.runtime.sendMessage).toHaveBeenNthCalledWith(2, {
      target: "offscreen",
      type: "fs.ensureRoot",
      payload: { requestPermission: true }
    });
  });

  it("forwards scenario list, save, and switch actions to the native host", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendNativeMessage
      .mockResolvedValueOnce({ ok: true, scenarios: ["baseline"] })
      .mockResolvedValueOnce({ ok: true, name: "release" })
      .mockResolvedValueOnce({ ok: true, name: "baseline" });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      }),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      })),
      initialState: {
        localRootReady: true,
        localRootSentinel: {
          rootId: "root-scenarios",
          schemaVersion: 1,
          createdAt: "2026-04-03T00:00:00.000Z"
        },
        rootSentinel: {
          rootId: "root-scenarios",
          schemaVersion: 1,
          createdAt: "2026-04-03T00:00:00.000Z"
        }
      }
    });

    await expect(runtime.handleRuntimeMessage({ type: "scenario.list" })).resolves.toEqual({
      ok: true,
      scenarios: ["baseline"]
    });
    await expect(runtime.handleRuntimeMessage({ type: "scenario.save", name: "release" })).resolves.toEqual({
      ok: true,
      name: "release"
    });
    await expect(runtime.handleRuntimeMessage({ type: "scenario.switch", name: "baseline" })).resolves.toEqual({
      ok: true,
      name: "baseline"
    });

    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenNthCalledWith(1, "com.example.host", {
      type: "listScenarios",
      path: "/tmp/fixtures",
      expectedRootId: "root-scenarios"
    });
    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenNthCalledWith(2, "com.example.host", {
      type: "saveScenario",
      path: "/tmp/fixtures",
      expectedRootId: "root-scenarios",
      name: "release"
    });
    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenNthCalledWith(3, "com.example.host", {
      type: "switchScenario",
      path: "/tmp/fixtures",
      expectedRootId: "root-scenarios",
      name: "baseline"
    });
  });

  it("records refresh failures triggered by startup and install listeners", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const getSiteConfigs = vi.fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Startup refresh failed."))
      .mockRejectedValueOnce(new Error("Install refresh failed."));

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs,
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    chromeApi.runtime.onStartup.listeners[0]();
    await flushPromises();
    expect(runtime.state.lastError).toBe("Startup refresh failed.");

    chromeApi.runtime.onInstalled.listeners[0]();
    await flushPromises();
    expect(runtime.state.lastError).toBe("Install refresh failed.");
  });

  it("bootstraps automatically outside test mode", async () => {
    const chromeApi = createChromeApi();
    await loadBackgroundModuleOutsideTestMode();
    await flushPromises();

    expect(chromeApi.runtime.onMessage.addListener).toHaveBeenCalled();
    expect(chromeApi.storage.onChanged.addListener).toHaveBeenCalled();
  });

  it("uses the real session controller to attach, detach, and reconcile tabs", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.tabs.query.mockResolvedValue([{ id: 5, url: "https://app.example.com/dashboard" }]);
    chromeApi.runtime.sendMessage.mockResolvedValue({ ok: true, sentinel: { rootId: "root-1" }, permission: "granted" });
    chromeApi.runtime.getContexts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{}]);

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([{ origin: "https://app.example.com", createdAt: "2026-04-03T00:00:00.000Z" }]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await runtime.handleRuntimeMessage({ type: "session.start" });

    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      target: "offscreen",
      type: "fs.ensureRoot",
      payload: { requestPermission: true }
    });
    expect(chromeApi.debugger.attach).toHaveBeenCalledWith({ tabId: 5 }, "1.3");
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 5 }, "Network.enable");
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 5 }, "Network.setCacheDisabled", { cacheDisabled: true });
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 5 }, "Fetch.enable", {
      patterns: [{ urlPattern: "*" }]
    });

    chromeApi.tabs.onUpdated.listeners[0](5, {}, { id: 5, url: "https://app.example.com/settings" });
    await flushPromises();
    expect(chromeApi.debugger.attach).toHaveBeenCalledTimes(1);

    runtime.state.requests.set("5:req-1", { requestId: "req-1" } as any);
    chromeApi.tabs.onRemoved.listeners[0](5);
    await flushPromises();
    expect(chromeApi.debugger.detach).toHaveBeenCalledWith({ tabId: 5 });
    expect(runtime.state.requests.size).toBe(0);

    runtime.state.attachedTabs.set(5, { topOrigin: "https://app.example.com" });
    chromeApi.debugger.onDetach.listeners[0]({});
    chromeApi.debugger.onDetach.listeners[0]({ tabId: 5 });
    expect(runtime.state.attachedTabs.has(5)).toBe(false);

    await runtime.handleRuntimeMessage({ type: "session.stop" });
    expect(chromeApi.offscreen.closeDocument).toHaveBeenCalled();
  });

  it("reuses an existing offscreen document and skips closing when none remains on session stop", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.tabs.query.mockResolvedValue([]);
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: true,
      sentinel: { rootId: "root-1" },
      permission: "granted"
    });
    chromeApi.runtime.getContexts
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([]);

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([
        { origin: "https://app.example.com", createdAt: "2026-04-03T00:00:00.000Z" }
      ]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await runtime.handleRuntimeMessage({ type: "session.start" });
    await runtime.handleRuntimeMessage({ type: "session.stop" });

    expect(chromeApi.offscreen.createDocument).not.toHaveBeenCalled();
    expect(chromeApi.offscreen.closeDocument).not.toHaveBeenCalled();
  });

  it("cleans up tab state even when debugger detach fails during tab removal", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.debugger.detach.mockRejectedValue(new Error("Already detached."));

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    runtime.state.attachedTabs.set(5, { topOrigin: "https://app.example.com" });
    runtime.state.requests.set("5:req-1", { requestId: "req-1" } as any);

    chromeApi.tabs.onRemoved.listeners[0](5);
    await flushPromises();

    expect(chromeApi.debugger.detach).toHaveBeenCalledWith({ tabId: 5 });
    expect(runtime.state.attachedTabs.has(5)).toBe(false);
    expect(runtime.state.requests.size).toBe(0);
    expect(runtime.state.lastError).toBe("");
  });

  it("ignores tab-removal cleanup when the tab is not attached", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    chromeApi.tabs.onRemoved.listeners[0](9);
    await flushPromises();

    expect(chromeApi.debugger.detach).not.toHaveBeenCalled();
    expect(runtime.state.attachedTabs.size).toBe(0);
    expect(runtime.state.requests.size).toBe(0);
  });

  it("stops the global session when the debugger is canceled by the user", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.tabs.query.mockResolvedValue([{ id: 8, url: "https://app.example.com/dashboard" }]);
    chromeApi.runtime.sendMessage.mockResolvedValue({ ok: true, sentinel: { rootId: "root-1" }, permission: "granted" });
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([{ origin: "https://app.example.com", createdAt: "2026-04-03T00:00:00.000Z" }]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await runtime.handleRuntimeMessage({ type: "session.start" });

    expect(runtime.state.sessionActive).toBe(true);
    expect(runtime.state.attachedTabs.has(8)).toBe(true);
    expect(chromeApi.debugger.attach).toHaveBeenCalledTimes(1);

    chromeApi.debugger.onDetach.listeners[0]({ tabId: 8 }, "canceled_by_user");
    await flushPromises();

    expect(runtime.state.sessionActive).toBe(false);
    expect(runtime.state.attachedTabs.has(8)).toBe(false);
    expect(chromeApi.offscreen.closeDocument).toHaveBeenCalled();
    expect(runtime.state.lastError).toBe("Debugger session was canceled by the user. Session stopped.");
  });

  it("keeps the global session active when the debuggee target closes", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.tabs.query.mockResolvedValue([{ id: 8, url: "https://app.example.com/dashboard" }]);
    chromeApi.runtime.sendMessage.mockResolvedValue({ ok: true, sentinel: { rootId: "root-1" }, permission: "granted" });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([{ origin: "https://app.example.com", createdAt: "2026-04-03T00:00:00.000Z" }]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await runtime.handleRuntimeMessage({ type: "session.start" });

    chromeApi.debugger.onDetach.listeners[0]({ tabId: 8 }, "target_closed");
    await flushPromises();

    expect(runtime.state.sessionActive).toBe(true);
    expect(runtime.state.attachedTabs.has(8)).toBe(false);
    expect(chromeApi.offscreen.closeDocument).not.toHaveBeenCalled();

    chromeApi.tabs.onUpdated.listeners[0](8, {}, { id: 8, url: "https://app.example.com/dashboard" });
    await flushPromises();

    expect(runtime.state.sessionActive).toBe(true);
    expect(runtime.state.attachedTabs.has(8)).toBe(true);
    expect(chromeApi.debugger.attach).toHaveBeenCalledTimes(2);
  });

  it("removes only matching request entries on non-user debugger detach", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    runtime.state.sessionActive = true;
    runtime.state.attachedTabs.set(8, { topOrigin: "https://app.example.com" });
    runtime.state.attachedTabs.set(9, { topOrigin: "https://cdn.example.com" });
    runtime.state.requests.set("8:req-1", { requestId: "req-1" } as any);
    runtime.state.requests.set("8:req-2", { requestId: "req-2" } as any);
    runtime.state.requests.set("9:req-3", { requestId: "req-3" } as any);

    chromeApi.debugger.onDetach.listeners[0]({ tabId: 8 }, "target_closed");
    await flushPromises();

    expect(runtime.state.sessionActive).toBe(true);
    expect(runtime.state.attachedTabs.has(8)).toBe(false);
    expect(runtime.state.attachedTabs.has(9)).toBe(true);
    expect(runtime.state.requests.has("8:req-1")).toBe(false);
    expect(runtime.state.requests.has("8:req-2")).toBe(false);
    expect(runtime.state.requests.has("9:req-3")).toBe(true);
  });

  it("cleans up detached tabs even when there are no matching request entries", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    runtime.state.attachedTabs.set(12, { topOrigin: "https://app.example.com" });
    runtime.state.requests.set("99:req-1", { requestId: "req-1" } as any);

    chromeApi.debugger.onDetach.listeners[0]({ tabId: 12 }, "target_closed");
    await flushPromises();

    expect(runtime.state.attachedTabs.has(12)).toBe(false);
    expect(runtime.state.requests.has("99:req-1")).toBe(true);
  });

  it("migrates legacy chrome-local site config into the selected root once", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    let configuredSites = [{
      origin: "https://app.example.com",
      createdAt: "2026-04-07T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.svg$"]
    }];

    chromeApi.storage.local.get.mockImplementation(async (keys: string[]) => {
      if (keys.includes(STORAGE_KEYS.SITES)) {
        return {
          [STORAGE_KEYS.SITES]: [{
            origin: "admin.example.com",
            createdAt: "2026-04-08T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.json$"]
          }, {
            origin: "https://app.example.com",
            createdAt: "2026-04-06T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }]
        };
      }

      if (keys.includes(STORAGE_KEYS.LEGACY_SITES_MIGRATED)) {
        return {};
      }

      if (keys.includes(STORAGE_KEYS.EXTENSION_CLIENT_ID)) {
        return { [STORAGE_KEYS.EXTENSION_CLIENT_ID]: "client-1" };
      }

      if (keys.includes(STORAGE_KEYS.NATIVE_HOST) || keys.includes(STORAGE_KEYS.PREFERRED_EDITOR)) {
        return {};
      }

      return {};
    });
    chromeApi.runtime.sendMessage.mockImplementation(async (message: {
      target?: string;
      type?: string;
      payload?: { siteConfigs?: typeof configuredSites };
    }) => {
      if (message.target !== "offscreen") {
        return undefined;
      }

      switch (message.type) {
        case "fs.ensureRoot":
          return { ok: true, sentinel: { rootId: "root-1" }, permission: "granted" };
        case "fs.readConfiguredSiteConfigs":
        case "fs.readEffectiveSiteConfigs":
          return { ok: true, sentinel: { rootId: "root-1" }, siteConfigs: configuredSites };
        case "fs.writeConfiguredSiteConfigs":
          configuredSites = message.payload?.siteConfigs ?? [];
          return { ok: true, sentinel: { rootId: "root-1" }, siteConfigs: configuredSites };
        default:
          return { ok: false, error: `Unhandled offscreen message: ${String(message.type)}` };
      }
    });
    const sessionController = {
      startSession: vi.fn(),
      stopSession: vi.fn(),
      reconcileTabs: vi.fn().mockResolvedValue(undefined),
      handleTabStateChange: vi.fn()
    };

    const runtime = createBackgroundRuntime({
      chromeApi,
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => sessionController),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();

    expect(configuredSites).toEqual([
      {
        origin: "https://admin.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.json$"]
      },
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-07T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.svg$"]
      }
    ]);
    expect(runtime.state.enabledOrigins).toEqual(["https://admin.example.com", "https://app.example.com"]);
    expect(chromeApi.storage.local.set).toHaveBeenCalledWith({
      [STORAGE_KEYS.LEGACY_SITES_MIGRATED]: true
    });

    chromeApi.storage.local.set.mockClear();
    await runtime.refreshStoredConfig();
    expect(chromeApi.storage.local.set).not.toHaveBeenCalled();
  });

  it("ignores legacy site config storage changes after root-backed config becomes authoritative", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const getSiteConfigs = vi
      .fn()
      .mockResolvedValue([{ origin: "https://app.example.com", createdAt: "2026-04-03T00:00:00.000Z" }]);
    const sessionController = {
      startSession: vi.fn(),
      stopSession: vi.fn(),
      reconcileTabs: vi.fn().mockResolvedValue(undefined),
      handleTabStateChange: vi.fn()
    };

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs,
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => sessionController),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    runtime.state.sessionActive = true;
    chromeApi.storage.onChanged.listeners[0]({ siteConfigs: { newValue: [] } }, "local");
    await flushPromises();

    expect(getSiteConfigs).toHaveBeenCalledTimes(1);
    expect(sessionController.reconcileTabs).not.toHaveBeenCalled();
  });

  it("refreshes local fallback config without reconciling tabs while the server is connected", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const getSiteConfigs = vi
      .fn()
      .mockResolvedValueOnce([{ origin: "https://local.example.com", createdAt: "2026-04-03T00:00:00.000Z" }])
      .mockResolvedValueOnce([{ origin: "https://next-local.example.com", createdAt: "2026-04-03T00:00:00.000Z" }]);
    const sessionController = {
      startSession: vi.fn(),
      stopSession: vi.fn(),
      reconcileTabs: vi.fn().mockResolvedValue(undefined),
      handleTabStateChange: vi.fn()
    };

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs,
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({
        heartbeat: vi.fn().mockResolvedValue({
          version: "0.6.1",
          rootPath: "/tmp/server-root",
          sentinel: { rootId: "server-root" },
          baseUrl: "http://127.0.0.1:4319",
          mcpUrl: "http://127.0.0.1:4319/mcp",
          trpcUrl: "http://127.0.0.1:4319/trpc",
          siteConfigs: [{
            origin: "https://server.example.com",
            createdAt: "2026-04-08T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.svg$"]
          }],
          activeTrace: null
        })
      })),
      createSessionController: vi.fn(() => sessionController),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await flushPromises();
    runtime.state.sessionActive = true;
    sessionController.reconcileTabs.mockClear();

    chromeApi.storage.onChanged.listeners[0]({ nativeHostConfig: { newValue: {} } }, "local");
    await flushPromises();

    expect(runtime.state.enabledOrigins).toEqual(["https://server.example.com"]);
    expect(runtime.state.localEnabledOrigins).toEqual(["https://next-local.example.com"]);
    expect(sessionController.reconcileTabs).not.toHaveBeenCalled();
  });

  it("refreshes config for preferred editor changes without reconciling tabs", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const getSiteConfigs = vi.fn().mockResolvedValue([]);
    const getNativeHostConfig = vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG);
    const sessionController = {
      startSession: vi.fn(),
      stopSession: vi.fn(),
      reconcileTabs: vi.fn().mockResolvedValue(undefined),
      handleTabStateChange: vi.fn()
    };

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs,
      getNativeHostConfig,
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => sessionController),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    getSiteConfigs.mockClear();
    getNativeHostConfig.mockClear();
    runtime.state.sessionActive = true;

    runtime.handleStorageChanged({ preferredEditorId: { newValue: "cursor" } }, "local");
    await flushPromises();

    expect(getSiteConfigs).toHaveBeenCalledTimes(1);
    expect(getNativeHostConfig).toHaveBeenCalledTimes(1);
    expect(sessionController.reconcileTabs).not.toHaveBeenCalled();
  });

  it("ignores unrelated local storage changes", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const getSiteConfigs = vi.fn().mockResolvedValue([]);
    const getNativeHostConfig = vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG);

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs,
      getNativeHostConfig,
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    getSiteConfigs.mockClear();
    getNativeHostConfig.mockClear();

    runtime.handleStorageChanged({ randomKey: { newValue: 1 } }, "local");
    await flushPromises();

    expect(getSiteConfigs).not.toHaveBeenCalled();
    expect(getNativeHostConfig).not.toHaveBeenCalled();
  });

  it("updates tab state, startup state, and storage errors through registered listeners", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const getSiteConfigs = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Startup refresh failed."))
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Storage refresh failed."));
    const sessionController = {
      startSession: vi.fn(),
      stopSession: vi.fn(),
      reconcileTabs: vi.fn(),
      handleTabStateChange: vi.fn().mockRejectedValue(new Error("Tab update failed."))
    };

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs,
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => sessionController),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    runtime.state.sessionActive = true;

    chromeApi.tabs.onUpdated.listeners[0](3, {}, { id: 3, url: "https://app.example.com" });
    await flushPromises();
    expect(runtime.state.lastError).toBe("Tab update failed.");

    chromeApi.runtime.onStartup.listeners[0]();
    await flushPromises();
    expect(runtime.state.lastError).toBe("Startup refresh failed.");

    chromeApi.runtime.onInstalled.listeners[0]();
    await flushPromises();

    chromeApi.storage.onChanged.listeners[0]({ nativeHostConfig: { newValue: {} } }, "sync");
    await flushPromises();

    chromeApi.storage.onChanged.listeners[0]({ nativeHostConfig: { newValue: {} } }, "local");
    await flushPromises();
    expect(runtime.state.lastError).toBe("Storage refresh failed.");
  });

  it("only refreshes the server on heartbeat alarms", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const heartbeat = vi.fn().mockResolvedValue({
      version: "1.0.0",
      rootPath: "/tmp/server-root",
      sentinel: { rootId: "server-root" },
      baseUrl: "http://127.0.0.1:4319",
      mcpUrl: "http://127.0.0.1:4319/mcp",
      trpcUrl: "http://127.0.0.1:4319/trpc",
      activeTrace: null
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({ heartbeat })),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await flushPromises();
    heartbeat.mockClear();

    chromeApi.alarms.onAlarm.listeners[0]({ name: "different-alarm" });
    await flushPromises();
    expect(heartbeat).not.toHaveBeenCalled();

    chromeApi.alarms.onAlarm.listeners[0]({ name: "wraithwalker-server-heartbeat" });
    await flushPromises();
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it("keeps heartbeats running without chrome alarms support", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    delete (chromeApi as { alarms?: unknown }).alarms;
    const heartbeat = vi.fn().mockResolvedValue({
      version: "1.0.0",
      rootPath: "/tmp/server-root",
      sentinel: { rootId: "server-root" },
      baseUrl: "http://127.0.0.1:4319",
      mcpUrl: "http://127.0.0.1:4319/mcp",
      trpcUrl: "http://127.0.0.1:4319/trpc",
      activeTrace: null
    });

    const runtime = createBackgroundRuntime({
      chromeApi: chromeApi as any,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLastSessionSnapshot: vi.fn(),
      createWraithWalkerServerClient: vi.fn(() => createMockServerClient({ heartbeat })),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn().mockResolvedValue({
          sessionActive: true,
          attachedTabIds: [],
          enabledOrigins: [],
          rootReady: false,
          captureDestination: "none",
          captureRootPath: "",
          lastError: ""
        }),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    await runtime.handleRuntimeMessage({ type: "session.start" });
    await flushPromises();

    expect(heartbeat).toHaveBeenCalled();
  });

  it("routes Network.requestWillBeSent and Network.responseReceived events", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const requestLifecycle = {
      handleFetchRequestPaused: vi.fn(),
      handleNetworkRequestWillBeSent: vi.fn(),
      handleNetworkResponseReceived: vi.fn(),
      handleNetworkLoadingFinished: vi.fn(),
      handleNetworkLoadingFailed: vi.fn()
    };

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => requestLifecycle)
    });

    await runtime.start();
    await runtime.handleDebuggerEvent({ tabId: 1 }, "Network.requestWillBeSent", { requestId: "req-1" });
    await runtime.handleDebuggerEvent({ tabId: 1 }, "Network.responseReceived", { requestId: "req-1" });

    expect(requestLifecycle.handleNetworkRequestWillBeSent).toHaveBeenCalledWith({ tabId: 1 }, { requestId: "req-1" });
    expect(requestLifecycle.handleNetworkResponseReceived).toHaveBeenCalledWith({ tabId: 1 }, { requestId: "req-1" });
  });

  it("captures lifecycle handler errors into lastError", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const requestLifecycle = {
      handleFetchRequestPaused: vi.fn().mockRejectedValue(new Error("Fetch handler crashed.")),
      handleNetworkRequestWillBeSent: vi.fn(),
      handleNetworkResponseReceived: vi.fn(),
      handleNetworkLoadingFinished: vi.fn(),
      handleNetworkLoadingFailed: vi.fn()
    };

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => requestLifecycle)
    });

    await runtime.start();
    await runtime.handleDebuggerEvent({ tabId: 1 }, "Fetch.requestPaused", { requestId: "fetch-1" });

    expect(runtime.state.lastError).toBe("Fetch handler crashed.");
  });

  it("reports missing native host name or launch path during verification", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: true,
      sentinel: { rootId: "root-1" },
      permission: "granted"
    });
    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "",
        launchPath: ""
      }),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.verifyNativeHostRoot();

    expect(result).toEqual({
      ok: false,
      error: "Configure the native host name and shared editor launch path in the options page first."
    });
  });

  it("catches native message errors during verification", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: true,
      sentinel: { rootId: "root-1" },
      permission: "granted"
    });
    chromeApi.runtime.sendNativeMessage.mockRejectedValue(new Error("Host not found."));
    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      }),
      getPreferredEditorId: vi.fn().mockResolvedValue("windsurf"),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.verifyNativeHostRoot();

    expect(result).toEqual({ ok: false, error: "Host not found." });
  });

  it("handles native host returning an error response during verification", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: true,
      sentinel: { rootId: "root-1" },
      permission: "granted"
    });
    chromeApi.runtime.sendNativeMessage.mockResolvedValue({ ok: false, error: "Root mismatch." });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      }),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.verifyNativeHostRoot();
    expect(result).toEqual({ ok: false, error: "Root mismatch." });
  });

  it("handles native open directory failure response", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: true,
      sentinel: { rootId: "root-1" },
      permission: "granted"
    });
    chromeApi.runtime.sendNativeMessage
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "Editor not found." });
    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      }),
      getPreferredEditorId: vi.fn().mockResolvedValue("windsurf"),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.openDirectoryInEditor(undefined, "windsurf");
    expect(result).toEqual({ ok: false, error: "Editor not found." });
  });

  it("returns native verification failures before attempting to open the directory", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: true,
      sentinel: { rootId: "root-1" },
      permission: "granted"
    });
    chromeApi.runtime.sendNativeMessage.mockResolvedValueOnce({ ok: false, error: "Root mismatch." });
    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      }),
      getPreferredEditorId: vi.fn().mockResolvedValue("windsurf"),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.openDirectoryInEditor(undefined, "windsurf");

    expect(result).toEqual({ ok: false, error: "Root mismatch." });
    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenCalledTimes(1);
    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenCalledWith("com.example.host", {
      type: "verifyRoot",
      path: "/tmp/fixtures",
      expectedRootId: "root-1"
    });
  });

  it("handles native open directory throwing an error", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: true,
      sentinel: { rootId: "root-1" },
      permission: "granted"
    });
    chromeApi.runtime.sendNativeMessage
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("Connection refused."));
    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      }),
      getPreferredEditorId: vi.fn().mockResolvedValue("windsurf"),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.openDirectoryInEditor(undefined, "windsurf");
    expect(result).toEqual({ ok: false, error: "Connection refused." });
  });

  it("captures errors from debugger detach handler into lastError", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const sessionController = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockRejectedValue(new Error("Stop session failed.")),
      reconcileTabs: vi.fn(),
      handleTabStateChange: vi.fn()
    };

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => sessionController),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await runtime.start();
    runtime.state.sessionActive = true;
    runtime.state.attachedTabs.set(7, { topOrigin: "https://app.example.com" });

    chromeApi.debugger.onDetach.listeners[0]({ tabId: 7 }, "canceled_by_user");
    await flushPromises();

    expect(runtime.state.lastError).toBe("Stop session failed.");
  });

  it("does not register listeners twice", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    runtime.registerListeners();
    runtime.registerListeners();

    expect(chromeApi.debugger.onEvent.addListener).toHaveBeenCalledTimes(1);
    expect(chromeApi.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });

  it("handles session.getState, session.stop, and root.verify runtime messages", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: true,
      sentinel: { rootId: "root-1" },
      permission: "granted"
    });
    const setLastSessionSnapshot = vi.fn().mockResolvedValue(undefined);
    const sessionController = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockResolvedValue({
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: [],
        rootReady: false,
        lastError: ""
      }),
      reconcileTabs: vi.fn(),
      handleTabStateChange: vi.fn()
    };

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot,
      createSessionController: vi.fn(() => sessionController),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const stateResult = await runtime.handleRuntimeMessage({ type: "session.getState" });
    expect(stateResult).toHaveProperty("sessionActive", false);

    const stopResult = await runtime.handleRuntimeMessage({ type: "session.stop" });
    expect(sessionController.stopSession).toHaveBeenCalled();

    const rootResult = await runtime.handleRuntimeMessage({ type: "root.verify" });
    expect(rootResult).toHaveProperty("ok", true);
    expect(setLastSessionSnapshot).toHaveBeenCalled();

    const verifyResult = await runtime.handleRuntimeMessage({ type: "native.verify" });
    expect(verifyResult).toHaveProperty("ok", false);
    expect(setLastSessionSnapshot).toHaveBeenCalled();
  });

  it("falls back when getContexts is not available", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts = undefined;
    chromeApi.runtime.sendMessage.mockResolvedValue({
      ok: true,
      sentinel: { rootId: "root-1" },
      permission: "granted"
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const result = await runtime.ensureRootReady();
    expect(chromeApi.offscreen.createDocument).toHaveBeenCalled();
    expect(result).toHaveProperty("ok", true);
  });

  it("bootstraps with the default chrome dependencies", async () => {
    const { bootstrapBackground } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.storage.local.get
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    globalThis.chrome = chromeApi as any;

    await bootstrapBackground();

    expect(chromeApi.runtime.onMessage.addListener).toHaveBeenCalled();
    expect(chromeApi.storage.local.get).toHaveBeenCalledTimes(3);
    expect(chromeApi.storage.local.get).toHaveBeenNthCalledWith(2, [STORAGE_KEYS.EXTENSION_CLIENT_ID]);
    expect(chromeApi.storage.local.get).toHaveBeenNthCalledWith(3, [STORAGE_KEYS.LEGACY_SITES_MIGRATED]);
  });
});
