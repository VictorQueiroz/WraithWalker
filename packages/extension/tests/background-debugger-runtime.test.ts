import { describe, expect, it, vi } from "vitest";

import { createBackgroundDebuggerRuntime } from "../src/lib/background-debugger-runtime.js";
import type { RequestLifecycleApi } from "../src/lib/background-runtime-shared.js";
import {
  createBackgroundState,
  createChromeApi
} from "./helpers/background-service-test-helpers.js";

describe("background debugger runtime", () => {
  it("attaches tabs with debugger domains enabled and detaches while clearing tracked requests", async () => {
    const state = createBackgroundState();
    const chromeApi = createChromeApi();
    const traceService = {
      handleBindingCalled: vi.fn().mockResolvedValue(false),
      disarmTraceForTab: vi.fn().mockResolvedValue(undefined),
      syncTraceBindings: vi.fn().mockResolvedValue(undefined)
    };
    const runtime = createBackgroundDebuggerRuntime({
      state,
      chromeApi,
      setLastError: vi.fn(),
      persistSnapshot: vi.fn().mockResolvedValue(undefined),
      stopSession: vi.fn().mockResolvedValue(undefined),
      requestLifecycle: () => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }),
      traceService
    });

    await runtime.attachTab(7, "https://app.example.com");
    state.requests.set("7:req-1", { requestId: "req-1" } as any);
    await runtime.detachTab(7);

    expect(chromeApi.debugger.attach).toHaveBeenCalledWith({ tabId: 7 }, "1.3");
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Network.enable"
    );
    expect(chromeApi.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      "Log.enable"
    );
    expect(traceService.syncTraceBindings).toHaveBeenCalled();
    expect(traceService.disarmTraceForTab).toHaveBeenCalledWith(7);
    expect(chromeApi.debugger.detach).toHaveBeenCalledWith({ tabId: 7 });
    expect(state.attachedTabs.has(7)).toBe(false);
    expect(state.requests.size).toBe(0);
  });

  it("swallows detached-tab debugger races from request lifecycle work", async () => {
    const state = createBackgroundState({
      sessionActive: true,
      attachedTabs: new Map([
        [
          9,
          {
            topOrigin: "https://app.example.com",
            traceScriptIdentifier: null,
            traceArmedForTraceId: null
          }
        ]
      ])
    });
    state.requests.set("9:req-1", { requestId: "req-1" } as any);
    const chromeApi = createChromeApi();
    chromeApi.debugger.sendCommand.mockRejectedValueOnce(
      new Error("Debugger is not attached to the tab with id: 9.")
    );
    const traceService = {
      handleBindingCalled: vi.fn().mockResolvedValue(false),
      disarmTraceForTab: vi.fn().mockResolvedValue(undefined),
      syncTraceBindings: vi.fn().mockResolvedValue(undefined)
    };

    let runtime: ReturnType<typeof createBackgroundDebuggerRuntime>;
    const lifecycle: RequestLifecycleApi = {
      handleFetchRequestPaused: vi.fn(async () => {
        await runtime.sendDebuggerCommand(9, "Fetch.continueRequest", {
          requestId: "fetch-9"
        });
      }),
      handleNetworkRequestWillBeSent: vi.fn(),
      handleNetworkResponseReceived: vi.fn(),
      handleNetworkLoadingFinished: vi.fn(),
      handleNetworkLoadingFailed: vi.fn()
    };

    const setLastError = vi.fn();
    runtime = createBackgroundDebuggerRuntime({
      state,
      chromeApi,
      setLastError,
      persistSnapshot: vi.fn().mockResolvedValue(undefined),
      stopSession: vi.fn().mockResolvedValue(undefined),
      requestLifecycle: () => lifecycle,
      traceService
    });

    await runtime.handleDebuggerEvent({ tabId: 9 }, "Fetch.requestPaused", {
      requestId: "fetch-9"
    });

    expect(setLastError).not.toHaveBeenCalled();
    expect(state.attachedTabs.has(9)).toBe(false);
    expect(state.requests.has("9:req-1")).toBe(false);
  });

  it("stops the session and persists a snapshot when the debugger is canceled by the user", async () => {
    const stopSession = vi.fn().mockResolvedValue(undefined);
    const persistSnapshot = vi.fn().mockResolvedValue(undefined);
    const setLastError = vi.fn();
    const runtime = createBackgroundDebuggerRuntime({
      state: createBackgroundState({ sessionActive: true }),
      chromeApi: createChromeApi(),
      setLastError,
      persistSnapshot,
      stopSession,
      requestLifecycle: () => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }),
      traceService: {
        handleBindingCalled: vi.fn().mockResolvedValue(false),
        disarmTraceForTab: vi.fn().mockResolvedValue(undefined),
        syncTraceBindings: vi.fn().mockResolvedValue(undefined)
      }
    });

    await runtime.handleDebuggerDetach({ tabId: 5 }, "canceled_by_user");

    expect(stopSession).toHaveBeenCalled();
    expect(setLastError).toHaveBeenCalledWith(
      "Debugger session was canceled by the user. Session stopped."
    );
    expect(persistSnapshot).toHaveBeenCalled();
  });

  it("captures recent console entries from debugger log events", async () => {
    const state = createBackgroundState({
      attachedTabs: new Map([
        [
          4,
          {
            topOrigin: "https://app.example.com",
            traceScriptIdentifier: null,
            traceArmedForTraceId: null
          }
        ]
      ])
    });
    const runtime = createBackgroundDebuggerRuntime({
      state,
      chromeApi: createChromeApi(),
      setLastError: vi.fn(),
      persistSnapshot: vi.fn().mockResolvedValue(undefined),
      stopSession: vi.fn().mockResolvedValue(undefined),
      requestLifecycle: () => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }),
      traceService: {
        handleBindingCalled: vi.fn().mockResolvedValue(false),
        disarmTraceForTab: vi.fn().mockResolvedValue(undefined),
        syncTraceBindings: vi.fn().mockResolvedValue(undefined)
      }
    });

    await runtime.handleDebuggerEvent({ tabId: 4 }, "Log.entryAdded", {
      entry: {
        source: "javascript",
        level: "error",
        text: "Unhandled exception: boom",
        timestamp: 1_775_692_800
      }
    });

    expect(state.recentConsoleEntries).toEqual([
      expect.objectContaining({
        tabId: 4,
        topOrigin: "https://app.example.com",
        source: "javascript",
        level: "error",
        text: "Unhandled exception: boom"
      })
    ]);
  });

  it("ignores malformed debugger console payloads", async () => {
    const state = createBackgroundState({
      attachedTabs: new Map([
        [
          4,
          {
            topOrigin: "https://app.example.com",
            traceScriptIdentifier: null,
            traceArmedForTraceId: null
          }
        ]
      ])
    });
    const runtime = createBackgroundDebuggerRuntime({
      state,
      chromeApi: createChromeApi(),
      setLastError: vi.fn(),
      persistSnapshot: vi.fn().mockResolvedValue(undefined),
      stopSession: vi.fn().mockResolvedValue(undefined),
      requestLifecycle: () => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }),
      traceService: {
        handleBindingCalled: vi.fn().mockResolvedValue(false),
        disarmTraceForTab: vi.fn().mockResolvedValue(undefined),
        syncTraceBindings: vi.fn().mockResolvedValue(undefined)
      }
    });

    await runtime.handleDebuggerEvent({ tabId: 4 }, "Log.entryAdded", {});

    expect(state.recentConsoleEntries).toEqual([]);
  });

  it("rethrows non-detached setup errors while attaching tabs", async () => {
    const state = createBackgroundState();
    const chromeApi = createChromeApi();
    chromeApi.debugger.sendCommand.mockRejectedValueOnce(
      new Error("Network enable failed.")
    );
    const runtime = createBackgroundDebuggerRuntime({
      state,
      chromeApi,
      setLastError: vi.fn(),
      persistSnapshot: vi.fn().mockResolvedValue(undefined),
      stopSession: vi.fn().mockResolvedValue(undefined),
      requestLifecycle: () => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }),
      traceService: {
        handleBindingCalled: vi.fn().mockResolvedValue(false),
        disarmTraceForTab: vi.fn().mockResolvedValue(undefined),
        syncTraceBindings: vi.fn().mockResolvedValue(undefined)
      }
    });

    await expect(
      runtime.attachTab(3, "https://app.example.com")
    ).rejects.toThrow("Network enable failed.");
    expect(state.attachedTabs.has(3)).toBe(false);
  });
});
