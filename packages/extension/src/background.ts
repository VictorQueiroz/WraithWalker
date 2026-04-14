import {
  getLegacySiteConfigsMigrated as defaultGetLegacySiteConfigsMigrated,
  getOrCreateExtensionClientId as defaultGetOrCreateExtensionClientId,
  getNativeHostConfig as defaultGetNativeHostConfig,
  getPreferredEditorId as defaultGetPreferredEditorId,
  getSiteConfigs as defaultGetLegacySiteConfigs,
  setLegacySiteConfigsMigrated as defaultSetLegacySiteConfigsMigrated,
  setLastSessionSnapshot as defaultSetLastSessionSnapshot
} from "./lib/chrome-storage.js";
import {
  DEFAULT_EDITOR_ID,
  DEFAULT_NATIVE_HOST_CONFIG
} from "./lib/constants.js";
import type {
  BackgroundMessage,
  BackgroundMessageResult
} from "./lib/messages.js";
import { createRequestLifecycle as defaultCreateRequestLifecycle } from "./lib/request-lifecycle.js";
import { createSessionController as defaultCreateSessionController } from "./lib/session-controller.js";
import { normalizeSiteConfigs as defaultNormalizeSiteConfigs } from "./lib/site-config.js";
import type { SiteConfig } from "./lib/types.js";
import {
  createWraithWalkerServerClient as defaultCreateWraithWalkerServerClient,
  type WraithWalkerServerClient
} from "./lib/wraithwalker-server.js";
import type {
  BackgroundState,
  ChromeApi,
  RequestLifecycleApi,
  SessionControllerApi
} from "./lib/background-runtime-shared.js";
import { isBackgroundMessage } from "./lib/background-runtime-shared.js";
import {
  createBackgroundAuthority,
  getRequiredRootId
} from "./lib/background-authority.js";
import type { BackgroundAuthorityApi } from "./lib/background-authority.js";
import { createBackgroundTraceService } from "./lib/background-trace-service.js";
import type { BackgroundTraceServiceApi } from "./lib/background-trace-service.js";
import { createBackgroundDebuggerRuntime } from "./lib/background-debugger-runtime.js";
import type { BackgroundDebuggerRuntimeApi } from "./lib/background-debugger-runtime.js";
import { createBackgroundNativeActions } from "./lib/background-native-actions.js";
import type { BackgroundNativeActionsApi } from "./lib/background-native-actions.js";
import { createBackgroundContextMenu } from "./lib/background-context-menu.js";
import type { BackgroundContextMenuApi } from "./lib/background-context-menu.js";

interface BackgroundDependencies {
  chromeApi?: ChromeApi;
  getSiteConfigs?: () => Promise<SiteConfig[]>;
  getLegacySiteConfigs?: typeof defaultGetLegacySiteConfigs;
  getLegacySiteConfigsMigrated?: typeof defaultGetLegacySiteConfigsMigrated;
  getNativeHostConfig?: typeof defaultGetNativeHostConfig;
  getPreferredEditorId?: typeof defaultGetPreferredEditorId;
  getOrCreateExtensionClientId?: typeof defaultGetOrCreateExtensionClientId;
  setLegacySiteConfigsMigrated?: typeof defaultSetLegacySiteConfigsMigrated;
  setLastSessionSnapshot?: typeof defaultSetLastSessionSnapshot;
  createWraithWalkerServerClient?: typeof defaultCreateWraithWalkerServerClient;
  createSessionController?: (
    dependencies: Parameters<typeof defaultCreateSessionController>[0]
  ) => SessionControllerApi;
  createRequestLifecycle?: (
    dependencies: Parameters<typeof defaultCreateRequestLifecycle>[0]
  ) => RequestLifecycleApi;
  normalizeSiteConfigs?: typeof defaultNormalizeSiteConfigs;
  initialState?: Partial<BackgroundState>;
}

function createUnavailableServerClient(): WraithWalkerServerClient {
  const unavailable = async (): Promise<never> => {
    throw new Error("Local WraithWalker server unavailable.");
  };

  return {
    getSystemInfo: unavailable,
    revealRoot: unavailable,
    listScenarios: unavailable,
    saveScenario: unavailable,
    switchScenario: unavailable,
    diffScenarios: unavailable,
    saveScenarioFromTrace: unavailable,
    heartbeat: unavailable,
    hasFixture: unavailable,
    readConfiguredSiteConfigs: unavailable,
    readEffectiveSiteConfigs: unavailable,
    writeConfiguredSiteConfigs: unavailable,
    readFixture: unavailable,
    writeFixtureIfAbsent: unavailable,
    generateContext: unavailable,
    recordTraceClick: unavailable,
    linkTraceFixture: unavailable
  };
}

function isTestMode(): boolean {
  return Boolean(
    (globalThis as typeof globalThis & { __WRAITHWALKER_TEST__?: boolean })
      .__WRAITHWALKER_TEST__
  );
}

export function createBackgroundRuntime({
  chromeApi = chrome as unknown as ChromeApi,
  getSiteConfigs,
  getLegacySiteConfigs = defaultGetLegacySiteConfigs,
  getLegacySiteConfigsMigrated = defaultGetLegacySiteConfigsMigrated,
  getNativeHostConfig = defaultGetNativeHostConfig,
  getPreferredEditorId = defaultGetPreferredEditorId,
  getOrCreateExtensionClientId = defaultGetOrCreateExtensionClientId,
  setLegacySiteConfigsMigrated = defaultSetLegacySiteConfigsMigrated,
  setLastSessionSnapshot = defaultSetLastSessionSnapshot,
  createWraithWalkerServerClient,
  createSessionController = defaultCreateSessionController,
  createRequestLifecycle = defaultCreateRequestLifecycle,
  normalizeSiteConfigs = defaultNormalizeSiteConfigs,
  initialState = {}
}: BackgroundDependencies = {}) {
  void getPreferredEditorId;

  const resolvedCreateWraithWalkerServerClient =
    createWraithWalkerServerClient ??
    (isTestMode()
      ? createUnavailableServerClient
      : defaultCreateWraithWalkerServerClient);
  const state: BackgroundState = {
    sessionActive: false,
    attachedTabs: new Map(),
    requests: new Map(),
    recentConsoleEntries: [],
    enabledOrigins: [],
    siteConfigsByOrigin: new Map(),
    localEnabledOrigins: [],
    localSiteConfigsByOrigin: new Map(),
    preferredEditorId: DEFAULT_EDITOR_ID,
    lastError: "",
    localRootReady: false,
    localRootSentinel: null,
    rootReady: false,
    rootSentinel: null,
    nativeHostConfig: { ...DEFAULT_NATIVE_HOST_CONFIG },
    extensionClientId: "",
    extensionVersion: chromeApi.runtime.getManifest?.().version || "0.0.0",
    serverInfo: null,
    activeTrace: null,
    serverCheckedAt: 0,
    legacySiteConfigsMigrated: false,
    ...initialState
  };

  const serverClient = resolvedCreateWraithWalkerServerClient();

  function setLastError(message: string) {
    state.lastError = message || "";
  }

  let sessionController!: SessionControllerApi;
  let debuggerRuntime!: BackgroundDebuggerRuntimeApi;
  let traceService!: BackgroundTraceServiceApi;

  const authority: BackgroundAuthorityApi = createBackgroundAuthority({
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
    setLastError,
    syncTraceBindings: () => traceService.syncTraceBindings(),
    reconcileTabs: () => sessionController.reconcileTabs()
  });

  traceService = createBackgroundTraceService({
    state,
    serverClient,
    sendDebuggerCommand: (tabId, method, params) =>
      debuggerRuntime.sendDebuggerCommand(tabId, method, params),
    scheduleHeartbeat: () => authority.scheduleHeartbeat(),
    markServerOffline: () => authority.markServerOffline()
  });

  sessionController = createSessionController({
    state,
    listTabs: () => chromeApi.tabs.query({}),
    attachTab: (tabId, topOrigin) =>
      debuggerRuntime.attachTab(tabId, topOrigin),
    detachTab: (tabId) => debuggerRuntime.detachTab(tabId),
    refreshStoredConfig: authority.refreshStoredConfig,
    ensureRootReady: authority.ensureRootReady,
    closeOffscreenDocument: authority.closeOffscreenDocument,
    persistSnapshot: authority.persistSnapshot,
    setLastError,
    snapshotState: authority.snapshotState
  });

  const requestLifecycle: RequestLifecycleApi = createRequestLifecycle({
    state,
    sendDebuggerCommand: (tabId, method, params) =>
      debuggerRuntime.sendDebuggerCommand(tabId, method, params),
    sendOffscreenMessage: ((type: string, payload?: Record<string, unknown>) =>
      authority.sendOffscreenMessage(type as never, payload)) as <T = unknown>(
      type: string,
      payload?: Record<string, unknown>
    ) => Promise<T>,
    setLastError,
    repository: authority.repository,
    getSiteConfigForOrigin: (topOrigin: string) =>
      state.siteConfigsByOrigin.get(topOrigin),
    onFixturePersisted: traceService.linkTraceFixtureIfNeeded
  });

  debuggerRuntime = createBackgroundDebuggerRuntime({
    state,
    chromeApi,
    setLastError,
    persistSnapshot: authority.persistSnapshot,
    stopSession: () => sessionController.stopSession().then(() => undefined),
    requestLifecycle: () => requestLifecycle,
    traceService
  });

  const nativeActions: BackgroundNativeActionsApi =
    createBackgroundNativeActions({
      state,
      chromeApi,
      serverClient,
      authority,
      getRequiredRootId
    });

  const contextMenu: BackgroundContextMenuApi = createBackgroundContextMenu({
    chromeApi,
    authority,
    setLastError
  });

  let listenersRegistered = false;

  function refreshContextMenus(): void {
    void contextMenu.registerContextMenus().catch((error: unknown) => {
      setLastError(error instanceof Error ? error.message : String(error));
    });
  }

  function handleTabUpdated(
    tabId: number,
    _changeInfo: Record<string, unknown>,
    tab: { id?: number; url?: string }
  ): void {
    sessionController
      .handleTabStateChange(tabId, tab)
      .catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : String(error));
      });
  }

  function handleTabRemoved(tabId: number): void {
    debuggerRuntime.detachTab(tabId).catch(() => {});
  }

  function handleAlarm(alarm: { name: string }): void {
    if (alarm.name !== "wraithwalker-server-heartbeat") {
      return;
    }

    void authority.refreshServerInfo({ force: true }).catch(() => undefined);
  }

  function handleStorageChanged(
    changes: Record<string, unknown>,
    areaName: string
  ): void {
    if (areaName !== "local") {
      return;
    }

    Promise.resolve()
      .then(async () => {
        if (changes.nativeHostConfig || changes.preferredEditorId) {
          await authority.refreshStoredConfig();
        }
      })
      .catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : String(error));
      });
  }

  async function handleRuntimeMessage(
    message: BackgroundMessage
  ): Promise<BackgroundMessageResult> {
    switch (message.type) {
      case "session.getState":
        return authority.snapshotState();
      case "diagnostics.getReport": {
        const report = await authority.getDiagnosticsReport();
        return {
          ok: true,
          report
        };
      }
      case "config.readConfiguredSiteConfigs":
        return authority.readConfiguredSiteConfigsForAuthority();
      case "config.readEffectiveSiteConfigs":
        return authority.readEffectiveSiteConfigsForAuthority();
      case "config.writeConfiguredSiteConfigs":
        return authority.writeConfiguredSiteConfigsForAuthority(
          message.siteConfigs
        );
      case "session.start": {
        state.recentConsoleEntries = [];
        await authority.refreshServerInfo({ force: true });
        const result = await sessionController.startSession();
        authority.queueServerRefresh({ force: true });
        authority.scheduleHeartbeat();
        return result;
      }
      case "session.stop": {
        const result = await sessionController.stopSession();
        authority.queueServerRefresh({ force: true });
        authority.scheduleHeartbeat();
        return result;
      }
      case "root.verify": {
        const result = await authority.ensureRootReady({
          requestPermission: true
        });
        await authority.persistSnapshot();
        return result;
      }
      case "native.verify": {
        const result = await nativeActions.verifyNativeHostRoot({
          requestPermission: true
        });
        await authority.persistSnapshot();
        return result;
      }
      case "native.open": {
        const result = await nativeActions.openDirectoryInEditor(
          message.commandTemplate,
          message.editorId
        );
        await authority.persistSnapshot();
        return result;
      }
      case "native.revealRoot": {
        const result = await nativeActions.revealRootInOs();
        await authority.persistSnapshot();
        return result;
      }
      case "scenario.list":
        return nativeActions.listScenariosForActiveTarget();
      case "scenario.save":
        return nativeActions.saveScenarioForActiveTarget(
          message.name,
          message.description
        );
      case "scenario.switch":
        return nativeActions.switchScenarioForActiveTarget(message.name);
      case "scenario.diff":
        return nativeActions.diffScenariosForActiveTarget(
          message.scenarioA,
          message.scenarioB
        );
      case "scenario.saveFromTrace":
        return nativeActions.saveScenarioFromTraceForActiveTarget(
          message.name,
          message.description
        );
    }
  }

  function handleRuntimeListener(
    message: unknown,
    _sender: unknown,
    sendResponse: (response: unknown) => void
  ): boolean | void {
    if (!isBackgroundMessage(message)) {
      return undefined;
    }

    handleRuntimeMessage(message)
      .then((result) => sendResponse(result))
      .catch((error: unknown) => {
        const messageText =
          error instanceof Error ? error.message : String(error);
        setLastError(messageText);
        sendResponse({ ok: false, error: messageText });
      });

    return true;
  }

  function registerListeners(): void {
    if (listenersRegistered) {
      return;
    }

    chromeApi.debugger.onEvent.addListener((source, method, params) => {
      void debuggerRuntime.handleDebuggerEvent(source, method, params);
    });
    chromeApi.debugger.onDetach.addListener((source, reason) => {
      void debuggerRuntime
        .handleDebuggerDetach(source, reason)
        .catch((error: unknown) => {
          setLastError(error instanceof Error ? error.message : String(error));
        });
    });
    chromeApi.tabs.onUpdated.addListener(handleTabUpdated);
    chromeApi.tabs.onRemoved.addListener(handleTabRemoved);
    chromeApi.storage.onChanged.addListener(handleStorageChanged);
    chromeApi.runtime.onMessage.addListener(handleRuntimeListener);
    chromeApi.alarms?.onAlarm.addListener(handleAlarm);
    chromeApi.contextMenus?.onClicked.addListener((info, tab) => {
      void contextMenu
        .handleContextMenuClicked(info, tab)
        .catch((error: unknown) => {
          setLastError(error instanceof Error ? error.message : String(error));
        });
    });
    chromeApi.runtime.onStartup.addListener(() => {
      authority.refreshStoredConfig().catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : String(error));
      });
      authority.queueServerRefresh({ force: true });
      refreshContextMenus();
    });
    chromeApi.runtime.onInstalled.addListener(() => {
      authority.refreshStoredConfig().catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : String(error));
      });
      authority.queueServerRefresh({ force: true });
      refreshContextMenus();
    });
    listenersRegistered = true;
  }

  async function start(): Promise<void> {
    registerListeners();
    await authority.refreshStoredConfig();
    await contextMenu.registerContextMenus().catch((error: unknown) => {
      setLastError(error instanceof Error ? error.message : String(error));
    });
    authority.queueServerRefresh({ force: true });
    authority.scheduleHeartbeat();
  }

  return {
    state,
    sessionController,
    requestLifecycle,
    refreshStoredConfig: authority.refreshStoredConfig,
    snapshotState: authority.snapshotState,
    ensureRootReady: authority.ensureRootReady,
    verifyNativeHostRoot: nativeActions.verifyNativeHostRoot,
    openDirectoryInEditor: nativeActions.openDirectoryInEditor,
    revealRootInOs: nativeActions.revealRootInOs,
    handleDebuggerEvent: debuggerRuntime.handleDebuggerEvent,
    handleStorageChanged,
    handleRuntimeMessage,
    registerListeners,
    start
  };
}

export async function bootstrapBackground(): Promise<void> {
  await createBackgroundRuntime().start();
}

if (!isTestMode()) {
  void bootstrapBackground();
}
