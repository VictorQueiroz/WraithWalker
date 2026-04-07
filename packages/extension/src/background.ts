import { buildSessionSnapshot } from "./lib/background-helpers.js";
import {
  getNativeHostConfig as defaultGetNativeHostConfig,
  getPreferredEditorId as defaultGetPreferredEditorId,
  getSiteConfigs as defaultGetSiteConfigs,
  setLastSessionSnapshot as defaultSetLastSessionSnapshot
} from "./lib/chrome-storage.js";
import { DEFAULT_EDITOR_ID, DEFAULT_NATIVE_HOST_CONFIG, OFFSCREEN_REASONS, OFFSCREEN_URL } from "./lib/constants.js";
import { buildEditorLaunchUrl, resolveEditorLaunch } from "./lib/editor-launch.js";
import type { BackgroundMessage, BackgroundMessageResult, ErrorResult, NativeOpenResult, NativeVerifyResult, OffscreenMessage, RootReadyResult, RootReadySuccess } from "./lib/messages.js";
import { createRequestLifecycle as defaultCreateRequestLifecycle } from "./lib/request-lifecycle.js";
import { createSessionController as defaultCreateSessionController } from "./lib/session-controller.js";
import type { AttachedTabState, NativeHostConfig, RequestEntry, RootSentinel, SessionSnapshot, SiteConfig } from "./lib/types.js";

const DEBUGGER_VERSION = "1.3";
type DetachReason = "target_closed" | "canceled_by_user";

interface DebuggeeTarget {
  tabId?: number;
}

interface RuntimeApi {
  getURL(path: string): string;
  sendMessage(message: unknown): Promise<unknown>;
  sendNativeMessage(hostName: string, message: Record<string, unknown>): Promise<Record<string, unknown>>;
  onMessage: {
    addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void): void;
  };
  onStartup: {
    addListener(listener: () => void): void;
  };
  onInstalled: {
    addListener(listener: () => void): void;
  };
  getContexts?: (filter: { contextTypes: string[]; documentUrls: string[] }) => Promise<unknown[]>;
}

interface DebuggerApi {
  attach(target: DebuggeeTarget, version: string): Promise<void>;
  sendCommand<T = unknown>(target: DebuggeeTarget, method: string, params?: Record<string, unknown>): Promise<T>;
  detach(target: DebuggeeTarget): Promise<void>;
  onEvent: {
    addListener(listener: (source: DebuggeeTarget, method: string, params: unknown) => void): void;
  };
  onDetach: {
    addListener(listener: (source: DebuggeeTarget, reason: DetachReason) => void): void;
  };
}

interface TabsApi {
  query(queryInfo: Record<string, unknown>): Promise<Array<{ id?: number; url?: string }>>;
  create(createProperties: { url: string }): Promise<{ id?: number }>;
  onUpdated: {
    addListener(listener: (tabId: number, changeInfo: Record<string, unknown>, tab: { id?: number; url?: string }) => void): void;
  };
  onRemoved: {
    addListener(listener: (tabId: number) => void): void;
  };
}

interface StorageApi {
  onChanged: {
    addListener(listener: (changes: Record<string, unknown>, areaName: string) => void): void;
  };
}

interface OffscreenApi {
  createDocument(config: {
    url: string;
    reasons: string[];
    justification: string;
  }): Promise<void>;
  closeDocument(): Promise<void>;
  Reason?: Record<string, string>;
}

interface ChromeApi {
  runtime: RuntimeApi;
  debugger: DebuggerApi;
  tabs: TabsApi;
  storage: StorageApi;
  offscreen: OffscreenApi;
}

interface BackgroundState {
  sessionActive: boolean;
  attachedTabs: Map<number, AttachedTabState>;
  requests: Map<string, RequestEntry>;
  enabledOrigins: string[];
  siteConfigsByOrigin: Map<string, SiteConfig>;
  preferredEditorId: string;
  lastError: string;
  rootReady: boolean;
  rootSentinel: RootSentinel | null;
  nativeHostConfig: NativeHostConfig;
}

interface SessionControllerApi {
  reconcileTabs(): Promise<void>;
  startSession(): Promise<SessionSnapshot>;
  stopSession(): Promise<SessionSnapshot>;
  handleTabStateChange(tabId: number, tab?: { id?: number; url?: string }): Promise<void>;
}

interface RequestLifecycleApi {
  ensureRequestEntry?(tabId: number, requestId: string): unknown;
  populatePostData?(tabId: number, requestId: string, fallbackRequest?: { postData?: string }): Promise<unknown>;
  ensureDescriptor?(entry: unknown): Promise<unknown>;
  handleFetchRequestPaused(source: DebuggeeTarget, params: unknown): Promise<void>;
  handleNetworkRequestWillBeSent(source: DebuggeeTarget, params: unknown): void;
  handleNetworkResponseReceived(source: DebuggeeTarget, params: unknown): void;
  handleNetworkLoadingFinished(source: DebuggeeTarget, params: unknown): Promise<void>;
  handleNetworkLoadingFailed(source: DebuggeeTarget, params: unknown): void;
}

interface BackgroundDependencies {
  chromeApi?: ChromeApi;
  getSiteConfigs?: typeof defaultGetSiteConfigs;
  getNativeHostConfig?: typeof defaultGetNativeHostConfig;
  getPreferredEditorId?: typeof defaultGetPreferredEditorId;
  setLastSessionSnapshot?: typeof defaultSetLastSessionSnapshot;
  createSessionController?: (dependencies: Parameters<typeof defaultCreateSessionController>[0]) => SessionControllerApi;
  createRequestLifecycle?: (dependencies: Parameters<typeof defaultCreateRequestLifecycle>[0]) => RequestLifecycleApi;
  initialState?: Partial<BackgroundState>;
}

function debuggerTarget(tabId: number): DebuggeeTarget {
  return { tabId };
}

function isBackgroundMessage(message: unknown): message is BackgroundMessage {
  if (!message || typeof message !== "object") {
    return false;
  }

  const type = (message as { type?: string; target?: string }).type;
  const target = (message as { target?: string }).target;
  if (target === "offscreen") {
    return false;
  }

  return [
    "session.getState",
    "session.start",
    "session.stop",
    "root.verify",
    "native.verify",
    "native.open",
    "scenario.list",
    "scenario.save",
    "scenario.switch"
  ].includes(type || "");
}

function getErrorMessage(result: { error?: string }): string {
  return result.error || "Unknown error.";
}

function isTestMode(): boolean {
  return Boolean((globalThis as typeof globalThis & { __WRAITHWALKER_TEST__?: boolean }).__WRAITHWALKER_TEST__);
}

export function createBackgroundRuntime({
  chromeApi = chrome as unknown as ChromeApi,
  getSiteConfigs = defaultGetSiteConfigs,
  getNativeHostConfig = defaultGetNativeHostConfig,
  getPreferredEditorId = defaultGetPreferredEditorId,
  setLastSessionSnapshot = defaultSetLastSessionSnapshot,
  createSessionController = defaultCreateSessionController,
  createRequestLifecycle = defaultCreateRequestLifecycle,
  initialState = {}
}: BackgroundDependencies = {}) {
  const state: BackgroundState = {
    sessionActive: false,
    attachedTabs: new Map(),
    requests: new Map(),
    enabledOrigins: [],
    siteConfigsByOrigin: new Map(),
    preferredEditorId: DEFAULT_EDITOR_ID,
    lastError: "",
    rootReady: false,
    rootSentinel: null,
    nativeHostConfig: { ...DEFAULT_NATIVE_HOST_CONFIG },
    ...initialState
  };

  let listenersRegistered = false;

  function setLastError(message: string) {
    state.lastError = message || "";
  }

  async function refreshStoredConfig(): Promise<void> {
    const [sites, nativeHostConfig, preferredEditorId] = await Promise.all([
      getSiteConfigs(),
      getNativeHostConfig(),
      getPreferredEditorId()
    ]);
    state.enabledOrigins = sites.map((site: SiteConfig) => site.origin);
    state.siteConfigsByOrigin = new Map(sites.map((site: SiteConfig) => [site.origin, site]));
    state.nativeHostConfig = { ...DEFAULT_NATIVE_HOST_CONFIG, ...nativeHostConfig };
    state.preferredEditorId = preferredEditorId || DEFAULT_EDITOR_ID;
  }

  async function snapshotState(): Promise<SessionSnapshot> {
    return buildSessionSnapshot({
      sessionActive: state.sessionActive,
      attachedTabIds: [...state.attachedTabs.keys()],
      enabledOrigins: [...state.enabledOrigins],
      rootReady: state.rootReady,
      lastError: state.lastError
    });
  }

  async function persistSnapshot(): Promise<void> {
    await setLastSessionSnapshot(await snapshotState());
  }

  async function ensureOffscreenDocument(): Promise<void> {
    const documentUrl = chromeApi.runtime.getURL(OFFSCREEN_URL);
    const contexts = chromeApi.runtime.getContexts
      ? await chromeApi.runtime.getContexts({
          contextTypes: ["OFFSCREEN_DOCUMENT"],
          documentUrls: [documentUrl]
        })
      : [];

    if (contexts.length) {
      return;
    }

    await chromeApi.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: OFFSCREEN_REASONS.map((reason) => chromeApi.offscreen.Reason?.[reason] ?? reason),
      justification: "File System Access requires a DOM document to persist and read local fixtures."
    });
  }

  async function closeOffscreenDocument(): Promise<void> {
    const contexts = chromeApi.runtime.getContexts
      ? await chromeApi.runtime.getContexts({
          contextTypes: ["OFFSCREEN_DOCUMENT"],
          documentUrls: [chromeApi.runtime.getURL(OFFSCREEN_URL)]
        })
      : [];

    if (contexts.length) {
      await chromeApi.offscreen.closeDocument();
    }
  }

  async function sendOffscreenMessage<T>(type: OffscreenMessage["type"], payload: Record<string, unknown> = {}): Promise<T> {
    await ensureOffscreenDocument();
    return chromeApi.runtime.sendMessage({
      target: "offscreen",
      type,
      payload
    } as OffscreenMessage) as Promise<T>;
  }

  async function ensureRootReady({ requestPermission = false }: { requestPermission?: boolean } = {}): Promise<RootReadyResult> {
    const result = await sendOffscreenMessage<RootReadyResult>("fs.ensureRoot", { requestPermission });
    state.rootReady = Boolean(result.ok);
    state.rootSentinel = result.ok ? result.sentinel : null;
    setLastError(result.ok ? "" : getErrorMessage(result as ErrorResult));
    return result;
  }

  async function verifyNativeHostRoot({
    requestPermission = false,
    rootResult
  }: {
    requestPermission?: boolean;
    rootResult?: RootReadySuccess;
  } = {}): Promise<NativeVerifyResult> {
    await refreshStoredConfig();
    const resolvedRoot = rootResult || await ensureRootReady({ requestPermission });
    if (!resolvedRoot.ok) {
      return { ok: false, error: getErrorMessage(resolvedRoot as ErrorResult) };
    }

    if (!state.nativeHostConfig.hostName || !state.nativeHostConfig.launchPath) {
      const error = "Configure the native host name and shared editor launch path in the options page first.";
      return { ok: false, error };
    }

    try {
      const response = await chromeApi.runtime.sendNativeMessage(state.nativeHostConfig.hostName, {
        type: "verifyRoot",
        path: state.nativeHostConfig.launchPath,
        expectedRootId: resolvedRoot.sentinel.rootId
      });

      if (!response?.ok) {
        throw new Error(String(response?.error || "Native host verification failed."));
      }

      return { ok: true, verifiedAt: new Date().toISOString() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function generateContext(editorId?: string): Promise<void> {
    try {
      await sendOffscreenMessage("fs.generateContext", {
        siteConfigs: [...state.siteConfigsByOrigin.values()],
        editorId
      });
    } catch {
      // Context generation failure should not block editor open
    }
  }

  async function openDirectoryViaUrlTemplate(urlTemplate: string, rootPath: string, rootSentinel: RootSentinel): Promise<NativeOpenResult> {
    try {
      await chromeApi.tabs.create({
        url: buildEditorLaunchUrl(urlTemplate, rootPath, rootSentinel.rootId)
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function openDirectoryInEditor(commandTemplate?: string, editorId?: string): Promise<NativeOpenResult> {
    await refreshStoredConfig();
    const resolvedEditorId = editorId || state.preferredEditorId;
    await generateContext(resolvedEditorId);
    const launch = resolveEditorLaunch(state.nativeHostConfig, resolvedEditorId);
    const urlTemplate = launch.urlTemplate.trim();

    const rootResult = await ensureRootReady({ requestPermission: true });
    if (!rootResult.ok) {
      return { ok: false, error: getErrorMessage(rootResult as ErrorResult) };
    }

    const launchPath = state.nativeHostConfig.launchPath.trim();
    if (!launchPath) {
      const error = urlTemplate
        ? `Set the absolute editor launch path in Settings before opening ${launch.preset.label}. Chrome does not expose local folder paths from the directory picker.`
        : "Configure the shared editor launch path in the options page first.";
      return { ok: false, error };
    }

    if (urlTemplate) {
      return openDirectoryViaUrlTemplate(urlTemplate, launchPath, rootResult.sentinel);
    }

    const verification = await verifyNativeHostRoot({ rootResult });
    if (!verification.ok) {
      return verification;
    }

    try {
      const response = await chromeApi.runtime.sendNativeMessage(state.nativeHostConfig.hostName, {
        type: "openDirectory",
        path: launchPath,
        expectedRootId: rootResult.sentinel.rootId,
        commandTemplate: commandTemplate || launch.commandTemplate
      });

      if (!response?.ok) {
        throw new Error(String(response?.error || "Open directory request failed."));
      }

      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function attachTab(tabId: number, topOrigin: string): Promise<void> {
    if (state.attachedTabs.has(tabId)) {
      state.attachedTabs.set(tabId, { topOrigin });
      return;
    }

    await chromeApi.debugger.attach(debuggerTarget(tabId), DEBUGGER_VERSION);
    await chromeApi.debugger.sendCommand(debuggerTarget(tabId), "Network.enable");
    await chromeApi.debugger.sendCommand(debuggerTarget(tabId), "Network.setCacheDisabled", { cacheDisabled: true });
    await chromeApi.debugger.sendCommand(debuggerTarget(tabId), "Fetch.enable", {
      patterns: [{ urlPattern: "*" }]
    });
    state.attachedTabs.set(tabId, { topOrigin });
  }

  async function detachTab(tabId: number): Promise<void> {
    if (!state.attachedTabs.has(tabId)) {
      return;
    }

    state.attachedTabs.delete(tabId);
    for (const key of [...state.requests.keys()]) {
      if (key.startsWith(`${tabId}:`)) {
        state.requests.delete(key);
      }
    }

    try {
      await chromeApi.debugger.detach(debuggerTarget(tabId));
    } catch {
      // Ignore detach errors caused by already-detached or closed tabs.
    }
  }

  const sessionController = createSessionController({
    state,
    listTabs: () => chromeApi.tabs.query({}),
    attachTab,
    detachTab,
    refreshStoredConfig,
    ensureRootReady,
    closeOffscreenDocument,
    persistSnapshot,
    setLastError,
    snapshotState
  });

  const requestLifecycle = createRequestLifecycle({
    state,
    sendDebuggerCommand: (tabId: number, method: string, params?: Record<string, unknown>) =>
      chromeApi.debugger.sendCommand(debuggerTarget(tabId), method, params),
    sendOffscreenMessage: ((type: string, payload?: Record<string, unknown>) =>
      sendOffscreenMessage(type as OffscreenMessage["type"], payload)) as <T = unknown>(
      type: string,
      payload?: Record<string, unknown>
    ) => Promise<T>,
    setLastError,
    getSiteConfigForOrigin: (topOrigin: string) => state.siteConfigsByOrigin.get(topOrigin)
  });

  async function handleDebuggerEvent(source: DebuggeeTarget, method: string, params: unknown): Promise<void> {
    try {
      if (method === "Fetch.requestPaused") {
        await requestLifecycle.handleFetchRequestPaused(source, params as never);
        return;
      }

      if (method === "Network.requestWillBeSent") {
        requestLifecycle.handleNetworkRequestWillBeSent(source, params as never);
        return;
      }

      if (method === "Network.responseReceived") {
        requestLifecycle.handleNetworkResponseReceived(source, params as never);
        return;
      }

      if (method === "Network.loadingFinished") {
        await requestLifecycle.handleNetworkLoadingFinished(source, params as never);
        return;
      }

      if (method === "Network.loadingFailed") {
        requestLifecycle.handleNetworkLoadingFailed(source, params as never);
      }
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDebuggerDetach(source: DebuggeeTarget, reason: DetachReason): Promise<void> {
    if (!source.tabId) {
      return;
    }

    if (reason === "canceled_by_user" && state.sessionActive) {
      await sessionController.stopSession();
      setLastError("Debugger session was canceled by the user. Session stopped.");
      await persistSnapshot();
      return;
    }

    state.attachedTabs.delete(source.tabId);
  }

  function handleTabUpdated(tabId: number, _changeInfo: Record<string, unknown>, tab: { id?: number; url?: string }): void {
    sessionController.handleTabStateChange(tabId, tab).catch((error: unknown) => {
      setLastError(error instanceof Error ? error.message : String(error));
    });
  }

  function handleTabRemoved(tabId: number): void {
    detachTab(tabId).catch(() => {});
  }

  function handleStorageChanged(changes: Record<string, unknown>, areaName: string): void {
    if (areaName !== "local") {
      return;
    }

    Promise.resolve()
      .then(async () => {
        if (changes.siteConfigs || changes.nativeHostConfig || changes.preferredEditorId) {
          await refreshStoredConfig();
        }
        if (changes.siteConfigs && state.sessionActive) {
          await sessionController.reconcileTabs();
        }
      })
      .catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : String(error));
      });
  }

  async function handleRuntimeMessage(message: BackgroundMessage): Promise<BackgroundMessageResult> {
    switch (message.type) {
      case "session.getState":
        return snapshotState();
      case "session.start":
        return sessionController.startSession();
      case "session.stop":
        return sessionController.stopSession();
      case "root.verify": {
        const result = await ensureRootReady({ requestPermission: true });
        await persistSnapshot();
        return result;
      }
      case "native.verify": {
        const result = await verifyNativeHostRoot({ requestPermission: true });
        await persistSnapshot();
        return result;
      }
      case "native.open": {
        const result = await openDirectoryInEditor(message.commandTemplate, message.editorId);
        await persistSnapshot();
        return result;
      }
      case "scenario.list": {
        await refreshStoredConfig();
        const result = await chromeApi.runtime.sendNativeMessage(state.nativeHostConfig.hostName, {
          type: "listScenarios",
          path: state.nativeHostConfig.launchPath,
          expectedRootId: state.rootSentinel?.rootId
        });
        return result as { ok: true; scenarios: string[] };
      }
      case "scenario.save": {
        await refreshStoredConfig();
        const result = await chromeApi.runtime.sendNativeMessage(state.nativeHostConfig.hostName, {
          type: "saveScenario",
          path: state.nativeHostConfig.launchPath,
          expectedRootId: state.rootSentinel?.rootId,
          name: message.name
        });
        return result as { ok: true; name: string };
      }
      case "scenario.switch": {
        await refreshStoredConfig();
        const result = await chromeApi.runtime.sendNativeMessage(state.nativeHostConfig.hostName, {
          type: "switchScenario",
          path: state.nativeHostConfig.launchPath,
          expectedRootId: state.rootSentinel?.rootId,
          name: message.name
        });
        return result as { ok: true; name: string };
      }
    }
  }

  function handleRuntimeListener(message: unknown, _sender: unknown, sendResponse: (response: unknown) => void): boolean | void {
    if (!isBackgroundMessage(message)) {
      return undefined;
    }

    handleRuntimeMessage(message)
      .then((result) => sendResponse(result))
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : String(error);
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
      void handleDebuggerEvent(source, method, params);
    });
    chromeApi.debugger.onDetach.addListener((source, reason) => {
      void handleDebuggerDetach(source, reason).catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : String(error));
      });
    });
    chromeApi.tabs.onUpdated.addListener(handleTabUpdated);
    chromeApi.tabs.onRemoved.addListener(handleTabRemoved);
    chromeApi.storage.onChanged.addListener(handleStorageChanged);
    chromeApi.runtime.onMessage.addListener(handleRuntimeListener);
    chromeApi.runtime.onStartup.addListener(() => {
      refreshStoredConfig().catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : String(error));
      });
    });
    chromeApi.runtime.onInstalled.addListener(() => {
      refreshStoredConfig().catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : String(error));
      });
    });
    listenersRegistered = true;
  }

  async function start(): Promise<void> {
    registerListeners();
    await refreshStoredConfig();
  }

  return {
    state,
    sessionController,
    requestLifecycle,
    refreshStoredConfig,
    snapshotState,
    ensureRootReady,
    verifyNativeHostRoot,
    openDirectoryInEditor,
    handleDebuggerEvent,
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
