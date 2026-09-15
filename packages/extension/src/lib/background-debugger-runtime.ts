import { extractOrigin } from "./background-helpers.js";
import type { ChromeApi, DebuggeeTarget, DetachReason } from "./chrome-api.js";
import type {
  BackgroundState,
  RequestLifecycleApi
} from "./background-runtime-shared.js";
import {
  debuggerTarget,
  DetachedDebuggerCommandError,
  isFetchResolutionCommand,
  isInvalidFetchRequestMessage,
  isDetachedDebuggerCommandMessage,
  MAX_RECENT_CONSOLE_ENTRIES,
  StaleFetchRequestCommandError,
  toBrowserConsoleEntry
} from "./background-runtime-shared.js";
import type { BackgroundTraceServiceApi } from "./background-trace-service.js";

const DEBUGGER_VERSION = "1.3";

function isAlreadyAttachedDebuggerMessage(
  message: string,
  tabId: number
): boolean {
  const normalized = message.toLowerCase();
  const tabIdPattern = new RegExp(`\\b${tabId}\\b`);
  return (
    tabIdPattern.test(normalized) &&
    normalized.includes(
      "another debugger is already attached to the tab with id:"
    )
  );
}

interface BackgroundDebuggerRuntimeDependencies {
  state: BackgroundState;
  chromeApi: ChromeApi;
  setLastError: (message: string) => void;
  persistSnapshot: () => Promise<void>;
  stopSession: () => Promise<void>;
  requestLifecycle: () => RequestLifecycleApi;
  traceService: Pick<
    BackgroundTraceServiceApi,
    "handleBindingCalled" | "disarmTraceForTab" | "syncTraceBindings"
  >;
}

export interface BackgroundDebuggerRuntimeApi {
  clearTrackedTabState(tabId: number): void;
  sendDebuggerCommand<T = unknown>(
    tabId: number,
    method: string,
    params?: Record<string, unknown>
  ): Promise<T>;
  attachTab(tabId: number, topOrigin: string): Promise<void>;
  detachTab(tabId: number): Promise<void>;
  handleDebuggerEvent(
    source: DebuggeeTarget,
    method: string,
    params: unknown
  ): Promise<void>;
  handleDebuggerDetach(
    source: DebuggeeTarget,
    reason: DetachReason
  ): Promise<void>;
}

export function createBackgroundDebuggerRuntime({
  state,
  chromeApi,
  setLastError,
  persistSnapshot,
  stopSession,
  requestLifecycle,
  traceService
}: BackgroundDebuggerRuntimeDependencies): BackgroundDebuggerRuntimeApi {
  const pendingAttachTabs = new Map<number, Promise<void>>();

  function clearTrackedTabState(tabId: number): void {
    state.attachedTabs.delete(tabId);
    for (const key of [...state.requests.keys()]) {
      if (key.startsWith(`${tabId}:`)) {
        state.requests.delete(key);
      }
    }
  }

  async function sendDebuggerCommand<T = unknown>(
    tabId: number,
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    try {
      if (typeof params === "undefined") {
        return await chromeApi.debugger.sendCommand<T>(
          debuggerTarget(tabId),
          method
        );
      }

      return await chromeApi.debugger.sendCommand<T>(
        debuggerTarget(tabId),
        method,
        params
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isDetachedDebuggerCommandMessage(message, tabId)) {
        clearTrackedTabState(tabId);
        throw new DetachedDebuggerCommandError(tabId, method, message);
      }
      if (
        isFetchResolutionCommand(method) &&
        isInvalidFetchRequestMessage(message)
      ) {
        throw new StaleFetchRequestCommandError(tabId, method, message);
      }

      throw error;
    }
  }

  function recordConsoleEntry(tabId: number, params: unknown): void {
    const entry = toBrowserConsoleEntry(
      tabId,
      params,
      extractOrigin,
      state.attachedTabs.get(tabId)
    );
    if (!entry) {
      return;
    }

    state.recentConsoleEntries = [...state.recentConsoleEntries, entry].slice(
      -MAX_RECENT_CONSOLE_ENTRIES
    );
  }

  async function attachTab(tabId: number, topOrigin: string): Promise<void> {
    if (state.attachedTabs.has(tabId)) {
      const existing = state.attachedTabs.get(tabId)!;
      existing.topOrigin = topOrigin;
      await traceService.syncTraceBindings();
      return;
    }

    const pendingAttach = pendingAttachTabs.get(tabId);
    if (pendingAttach) {
      await pendingAttach;
      const existing = state.attachedTabs.get(tabId);
      if (existing) {
        existing.topOrigin = topOrigin;
        await traceService.syncTraceBindings();
      }
      return;
    }

    const attachPromise = (async () => {
      try {
        await chromeApi.debugger.attach(debuggerTarget(tabId), DEBUGGER_VERSION);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isDetachedDebuggerCommandMessage(message, tabId)) {
          clearTrackedTabState(tabId);
          return;
        }
        if (!isAlreadyAttachedDebuggerMessage(message, tabId)) {
          throw error;
        }
      }

      try {
        await sendDebuggerCommand(tabId, "Network.enable");
        await sendDebuggerCommand(tabId, "Runtime.enable");
        await sendDebuggerCommand(tabId, "Log.enable");
        await sendDebuggerCommand(tabId, "Page.enable");
        await sendDebuggerCommand(tabId, "Network.setCacheDisabled", {
          cacheDisabled: true
        });
        await sendDebuggerCommand(tabId, "Fetch.enable", {
          patterns: [{ urlPattern: "*" }]
        });
      } catch (error) {
        if (error instanceof DetachedDebuggerCommandError) {
          return;
        }

        throw error;
      }
      state.attachedTabs.set(tabId, {
        topOrigin,
        traceScriptIdentifier: null,
        traceArmedForTraceId: null
      });
      await traceService.syncTraceBindings();
    })();
    pendingAttachTabs.set(tabId, attachPromise);

    try {
      await attachPromise;
    } finally {
      if (pendingAttachTabs.get(tabId) === attachPromise) {
        pendingAttachTabs.delete(tabId);
      }
    }
  }

  async function detachTab(tabId: number): Promise<void> {
    const pendingAttach = pendingAttachTabs.get(tabId);
    if (pendingAttach) {
      await pendingAttach.catch(() => undefined);
    }

    if (!state.attachedTabs.has(tabId)) {
      return;
    }

    await traceService.disarmTraceForTab(tabId);
    clearTrackedTabState(tabId);

    try {
      await chromeApi.debugger.detach(debuggerTarget(tabId));
    } catch {
      // Ignore detach errors caused by already-detached or closed tabs.
    }
  }

  async function handleDebuggerEvent(
    source: DebuggeeTarget,
    method: string,
    params: unknown
  ): Promise<void> {
    try {
      if (method === "Runtime.bindingCalled" && source.tabId) {
        if (await traceService.handleBindingCalled(source.tabId, params)) {
          return;
        }
      }

      if (method === "Log.entryAdded" && source.tabId) {
        recordConsoleEntry(source.tabId, params);
        return;
      }

      const lifecycle = requestLifecycle();
      if (method === "Fetch.requestPaused") {
        await lifecycle.handleFetchRequestPaused(source, params);
        return;
      }

      if (method === "Network.requestWillBeSent") {
        lifecycle.handleNetworkRequestWillBeSent(source, params);
        return;
      }

      if (method === "Network.responseReceived") {
        lifecycle.handleNetworkResponseReceived(source, params);
        return;
      }

      if (method === "Network.loadingFinished") {
        await lifecycle.handleNetworkLoadingFinished(source, params);
        return;
      }

      if (method === "Network.loadingFailed") {
        lifecycle.handleNetworkLoadingFailed(source, params);
      }
    } catch (error) {
      if (
        error instanceof DetachedDebuggerCommandError ||
        error instanceof StaleFetchRequestCommandError
      ) {
        return;
      }

      setLastError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDebuggerDetach(
    source: DebuggeeTarget,
    reason: DetachReason
  ): Promise<void> {
    if (!source.tabId) {
      return;
    }

    if (reason === "canceled_by_user" && state.sessionActive) {
      await stopSession();
      setLastError(
        "Debugger session was canceled by the user. Session stopped."
      );
      await persistSnapshot();
      return;
    }

    clearTrackedTabState(source.tabId);
  }

  return {
    clearTrackedTabState,
    sendDebuggerCommand,
    attachTab,
    detachTab,
    handleDebuggerEvent,
    handleDebuggerDetach
  };
}
