import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_NATIVE_HOST_CONFIG } from "../src/lib/constants.js";

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
  return {
    runtime: {
      getURL: vi.fn((path) => path),
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
    }
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
      setNativeHostConfig: vi.fn(),
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
      setNativeHostConfig: vi.fn(),
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
      setNativeHostConfig: vi.fn(),
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
      helperReady: false,
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
      setNativeHostConfig: vi.fn(),
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
      setNativeHostConfig: vi.fn(),
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
    const setNativeHostConfig = vi.fn().mockResolvedValue(undefined);

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        rootPath: "/tmp/fixtures"
      }),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      setNativeHostConfig,
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

    expect(chromeApi.offscreen.createDocument).toHaveBeenCalled();
    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenNthCalledWith(1, "com.example.host", {
      type: "verifyRoot",
      path: "/tmp/fixtures",
      expectedRootId: "root-1"
    });
    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenNthCalledWith(2, "com.example.host", {
      type: "openDirectory",
      path: "/tmp/fixtures",
      expectedRootId: "root-1",
      commandTemplate: 'code "$DIR"'
    });
    expect(setNativeHostConfig).toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("surfaces native verification failures and root-sentinel errors", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    const setNativeHostConfig = vi.fn().mockResolvedValue(undefined);

    const blockedRuntime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        rootPath: "/tmp/fixtures"
      }),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      setNativeHostConfig,
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
        rootPath: "/tmp/fixtures"
      }),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      setNativeHostConfig,
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

    chromeApi.runtime.sendMessage.mockResolvedValueOnce({ ok: true, permission: "granted" });
    await expect(sentinelRuntime.openDirectoryInEditor()).resolves.toEqual({
      ok: false,
      error: "Cannot read properties of undefined (reading 'rootId')"
    });
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
      setNativeHostConfig: vi.fn().mockResolvedValue(undefined),
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
      setNativeHostConfig: vi.fn().mockResolvedValue(undefined),
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
      setNativeHostConfig: vi.fn().mockResolvedValue(undefined),
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

  it("refreshes configuration and reconciles tabs on relevant storage changes", async () => {
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
      setNativeHostConfig: vi.fn(),
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

    expect(getSiteConfigs).toHaveBeenCalledTimes(2);
    expect(sessionController.reconcileTabs).toHaveBeenCalled();
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
      setNativeHostConfig: vi.fn(),
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

  it("bootstraps with the default chrome dependencies", async () => {
    const { bootstrapBackground } = await loadBackgroundModule();
    const chromeApi = createChromeApi();
    chromeApi.storage.local.get
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    globalThis.chrome = chromeApi as any;

    await bootstrapBackground();

    expect(chromeApi.runtime.onMessage.addListener).toHaveBeenCalled();
    expect(chromeApi.storage.local.get).toHaveBeenCalledTimes(2);
  });
});
