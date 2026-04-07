import { buildSessionSnapshot } from "./lib/background-helpers.js";
import {
  getNativeHostConfig as defaultGetNativeHostConfig,
  getPreferredEditorId as defaultGetPreferredEditorId,
  getSiteConfigs as defaultGetSiteConfigs,
  setLastSessionSnapshot as defaultSetLastSessionSnapshot
} from "./lib/chrome-storage.js";
import { DEFAULT_EDITOR_ID, DEFAULT_NATIVE_HOST_CONFIG, OFFSCREEN_REASONS, OFFSCREEN_URL } from "./lib/constants.js";
import {
  buildCursorPromptText,
  buildCursorPromptUrl,
  buildEditorAppUrl,
  buildEditorLaunchUrl,
  resolveEditorLaunch
} from "./lib/editor-launch.js";
import type { BackgroundMessage, BackgroundMessageResult, ErrorResult, NativeOpenResult, NativeVerifyResult, OffscreenMessage, RootReadyResult, RootReadySuccess } from "./lib/messages.js";
import { createRequestLifecycle as defaultCreateRequestLifecycle } from "./lib/request-lifecycle.js";
import { createSessionController as defaultCreateSessionController } from "./lib/session-controller.js";
import type {
  AttachedTabState,
  FixtureDescriptor,
  NativeHostConfig,
  RequestEntry,
  RequestPayload,
  ResponseMeta,
  RootSentinel,
  SessionSnapshot,
  SiteConfig,
  StoredFixture
} from "./lib/types.js";
import {
  createWraithWalkerServerClient as defaultCreateWraithWalkerServerClient,
  isServerCacheFresh,
  type WraithWalkerServerClient
} from "./lib/wraithwalker-server.js";

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
  localRootReady: boolean;
  localRootSentinel: RootSentinel | null;
  rootReady: boolean;
  rootSentinel: RootSentinel | null;
  nativeHostConfig: NativeHostConfig;
  serverInfo: {
    rootPath: string;
    sentinel: RootSentinel;
    baseUrl: string;
    mcpUrl: string;
    trpcUrl: string;
  } | null;
  serverCheckedAt: number;
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
  createWraithWalkerServerClient?: typeof defaultCreateWraithWalkerServerClient;
  createSessionController?: (dependencies: Parameters<typeof defaultCreateSessionController>[0]) => SessionControllerApi;
  createRequestLifecycle?: (dependencies: Parameters<typeof defaultCreateRequestLifecycle>[0]) => RequestLifecycleApi;
  initialState?: Partial<BackgroundState>;
}

function createUnavailableServerClient(): WraithWalkerServerClient {
  const unavailable = async (): Promise<never> => {
    throw new Error("Local WraithWalker server unavailable.");
  };

  return {
    getSystemInfo: unavailable,
    hasFixture: unavailable,
    readFixture: unavailable,
    writeFixtureIfAbsent: unavailable,
    generateContext: unavailable
  };
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
    "native.revealRoot",
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
  createWraithWalkerServerClient,
  createSessionController = defaultCreateSessionController,
  createRequestLifecycle = defaultCreateRequestLifecycle,
  initialState = {}
}: BackgroundDependencies = {}) {
  const resolvedCreateWraithWalkerServerClient = createWraithWalkerServerClient
    ?? (isTestMode() ? createUnavailableServerClient : defaultCreateWraithWalkerServerClient);
  const state: BackgroundState = {
    sessionActive: false,
    attachedTabs: new Map(),
    requests: new Map(),
    enabledOrigins: [],
    siteConfigsByOrigin: new Map(),
    preferredEditorId: DEFAULT_EDITOR_ID,
    lastError: "",
    localRootReady: false,
    localRootSentinel: null,
    rootReady: false,
    rootSentinel: null,
    nativeHostConfig: { ...DEFAULT_NATIVE_HOST_CONFIG },
    serverInfo: null,
    serverCheckedAt: 0,
    ...initialState
  };

  const serverClient = resolvedCreateWraithWalkerServerClient();
  let serverRefreshPromise: Promise<typeof state.serverInfo> | null = null;

  let listenersRegistered = false;

  function setLastError(message: string) {
    state.lastError = message || "";
  }

  function updateEffectiveRootState(): void {
    if (state.serverInfo) {
      state.rootReady = true;
      state.rootSentinel = state.serverInfo.sentinel;
      return;
    }

    state.rootReady = state.localRootReady;
    state.rootSentinel = state.localRootSentinel;
  }

  function markServerOffline(): void {
    state.serverInfo = null;
    state.serverCheckedAt = Date.now();
    updateEffectiveRootState();
  }

  async function refreshServerInfo({ force = false }: { force?: boolean } = {}): Promise<typeof state.serverInfo> {
    if (!force && isServerCacheFresh(state.serverCheckedAt)) {
      return state.serverInfo;
    }

    if (serverRefreshPromise) {
      return serverRefreshPromise;
    }

    serverRefreshPromise = (async () => {
      try {
        const info = await serverClient.getSystemInfo();
        state.serverInfo = {
          rootPath: info.rootPath,
          sentinel: info.sentinel,
          baseUrl: info.baseUrl,
          mcpUrl: info.mcpUrl,
          trpcUrl: info.trpcUrl
        };
        state.serverCheckedAt = Date.now();
        updateEffectiveRootState();
        return state.serverInfo;
      } catch {
        markServerOffline();
        return null;
      } finally {
        serverRefreshPromise = null;
      }
    })();

    return serverRefreshPromise;
  }

  function queueServerRefresh({ force = false }: { force?: boolean } = {}): void {
    if (!force && isServerCacheFresh(state.serverCheckedAt)) {
      return;
    }

    void refreshServerInfo({ force }).catch(() => undefined);
  }

  function getRequiredRootId(rootResult: RootReadySuccess): string | null {
    const rootId = (rootResult.sentinel as RootSentinel | undefined)?.rootId;
    return typeof rootId === "string" && rootId.trim() ? rootId : null;
  }

  async function refreshStoredConfig(): Promise<void> {
    const [sites, nativeHostConfig] = await Promise.all([
      getSiteConfigs(),
      getNativeHostConfig()
    ]);
    state.enabledOrigins = sites.map((site: SiteConfig) => site.origin);
    state.siteConfigsByOrigin = new Map(sites.map((site: SiteConfig) => [site.origin, site]));
    state.nativeHostConfig = { ...DEFAULT_NATIVE_HOST_CONFIG, ...nativeHostConfig };
    state.preferredEditorId = DEFAULT_EDITOR_ID;
  }

  async function snapshotState(): Promise<SessionSnapshot> {
    queueServerRefresh();

    return buildSessionSnapshot({
      sessionActive: state.sessionActive,
      attachedTabIds: [...state.attachedTabs.keys()],
      enabledOrigins: [...state.enabledOrigins],
      rootReady: state.rootReady,
      captureDestination: state.serverInfo
        ? "server"
        : state.localRootReady
          ? "local"
          : "none",
      captureRootPath: state.serverInfo?.rootPath || "",
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

  async function ensureLocalRootReady(
    { requestPermission = false, silent = false }: { requestPermission?: boolean; silent?: boolean } = {}
  ): Promise<RootReadyResult> {
    const result = await sendOffscreenMessage<RootReadyResult>("fs.ensureRoot", { requestPermission });
    state.localRootReady = Boolean(result.ok);
    state.localRootSentinel = result.ok ? result.sentinel : null;
    updateEffectiveRootState();
    if (!silent) {
      setLastError(result.ok ? "" : getErrorMessage(result as ErrorResult));
    }
    return result;
  }

  async function ensureRootReady({ requestPermission = false }: { requestPermission?: boolean } = {}): Promise<RootReadyResult> {
    const serverInfo = await refreshServerInfo({ force: true });
    if (serverInfo) {
      setLastError("");
      return {
        ok: true,
        sentinel: serverInfo.sentinel,
        permission: "granted"
      };
    }

    return ensureLocalRootReady({ requestPermission });
  }

  async function localFixtureExists(descriptor: FixtureDescriptor): Promise<boolean> {
    const fixtureCheck = await sendOffscreenMessage<{ ok: boolean; exists?: boolean; error?: string }>("fs.hasFixture", { descriptor } as Record<string, unknown>);
    if (!fixtureCheck.ok) {
      throw new Error(fixtureCheck.error || "Fixture lookup failed.");
    }

    return Boolean(fixtureCheck.exists);
  }

  async function localReadFixture(descriptor: FixtureDescriptor): Promise<StoredFixture | null> {
    const fixture = await sendOffscreenMessage<{
      ok: boolean;
      exists?: boolean;
      request?: RequestPayload;
      meta?: ResponseMeta;
      bodyBase64?: string;
      size?: number;
      error?: string;
    }>("fs.readFixture", { descriptor } as Record<string, unknown>);
    if (!fixture.ok) {
      throw new Error(fixture.error || "Fixture lookup failed.");
    }

    if (!fixture.exists || !fixture.meta || !fixture.bodyBase64 || !fixture.request) {
      return null;
    }

    return {
      request: fixture.request,
      meta: fixture.meta,
      bodyBase64: fixture.bodyBase64,
      size: fixture.size || 0
    };
  }

  async function localWriteFixture(payload: {
    descriptor: FixtureDescriptor;
    request: RequestPayload;
    response: {
      body: string;
      bodyEncoding: "utf8" | "base64";
      meta: ResponseMeta;
    };
  }): Promise<{ written: boolean; descriptor: FixtureDescriptor; sentinel: RootSentinel }> {
    const result = await sendOffscreenMessage<{
      ok: boolean;
      descriptor?: FixtureDescriptor;
      sentinel?: RootSentinel;
      error?: string;
    }>("fs.writeFixture", payload);
    if (!result.ok) {
      throw new Error(result.error || "Fixture write failed.");
    }

    return {
      written: true,
      descriptor: result.descriptor || payload.descriptor,
      sentinel: result.sentinel || state.rootSentinel || { rootId: "" }
    };
  }

  async function withServerFallback<T>({
    remoteOperation,
    localOperation
  }: {
    remoteOperation: (info: NonNullable<typeof state.serverInfo>) => Promise<T>;
    localOperation: () => Promise<T>;
  }): Promise<T> {
    const serverInfo = await refreshServerInfo();
    if (!serverInfo) {
      return localOperation();
    }

    try {
      return await remoteOperation(serverInfo);
    } catch (error) {
      markServerOffline();
      const localRoot = await ensureLocalRootReady({ silent: true });
      if (localRoot.ok) {
        return localOperation();
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Local WraithWalker server is unavailable and no fallback root is ready. ${message}`);
    }
  }

  async function resolveActiveLaunchTarget({
    requestPermission = false
  }: {
    requestPermission?: boolean;
  } = {}): Promise<
    | { ok: true; rootId: string; launchPath: string; source: "server" | "local" }
    | { ok: false; error: string }
  > {
    const serverInfo = await refreshServerInfo({ force: true });
    if (serverInfo) {
      const rootId = getRequiredRootId({
        ok: true,
        sentinel: serverInfo.sentinel,
        permission: "granted"
      });
      if (!rootId) {
        return { ok: false, error: "Root sentinel is missing a rootId." };
      }

      return {
        ok: true,
        rootId,
        launchPath: serverInfo.rootPath,
        source: "server"
      };
    }

    const rootResult: RootReadyResult = !requestPermission && state.localRootReady && state.localRootSentinel
      ? {
          ok: true,
          sentinel: state.localRootSentinel,
          permission: "granted"
        }
      : await ensureLocalRootReady({ requestPermission });
    if (!rootResult.ok) {
      return { ok: false, error: getErrorMessage(rootResult as ErrorResult) };
    }

    const rootId = getRequiredRootId(rootResult);
    if (!rootId) {
      return { ok: false, error: "Root sentinel is missing a rootId." };
    }

    const launchPath = state.nativeHostConfig.launchPath.trim();
    if (!launchPath) {
      return { ok: false, error: "Configure the shared editor launch path in the options page first." };
    }

    return {
      ok: true,
      rootId,
      launchPath,
      source: "local"
    };
  }

  async function verifyNativeHostRoot({
    requestPermission = false,
    rootResult,
    launchPathOverride
  }: {
    requestPermission?: boolean;
    rootResult?: RootReadySuccess;
    launchPathOverride?: string;
  } = {}): Promise<NativeVerifyResult> {
    await refreshStoredConfig();
    if (!state.nativeHostConfig.hostName.trim()) {
      const error = "Configure the native host name and shared editor launch path in the options page first.";
      return { ok: false, error };
    }

    let resolvedTarget: Awaited<ReturnType<typeof resolveActiveLaunchTarget>>;
    if (rootResult) {
      const rootId = getRequiredRootId(rootResult);
      if (!rootId) {
        return { ok: false, error: "Root sentinel is missing a rootId." };
      }

      resolvedTarget = {
        ok: true,
        rootId,
        launchPath: launchPathOverride ?? state.nativeHostConfig.launchPath.trim(),
        source: "local"
      };
    } else {
      resolvedTarget = await resolveActiveLaunchTarget({ requestPermission });
    }
    if (resolvedTarget.ok === false) {
      return { ok: false, error: resolvedTarget.error };
    }

    if (!resolvedTarget.launchPath) {
      return { ok: false, error: "Configure the shared editor launch path in the options page first." };
    }

    try {
      const response = await chromeApi.runtime.sendNativeMessage(state.nativeHostConfig.hostName, {
        type: "verifyRoot",
        path: resolvedTarget.launchPath,
        expectedRootId: resolvedTarget.rootId
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
      const payload = {
        siteConfigs: [...state.siteConfigsByOrigin.values()],
        editorId
      };

      await withServerFallback({
        remoteOperation: () => serverClient.generateContext(payload),
        localOperation: () => sendOffscreenMessage("fs.generateContext", payload)
      });
    } catch {
      // Context generation failure should not block editor open
    }
  }

  async function openEditorViaUrl(url: string): Promise<NativeOpenResult> {
    try {
      await chromeApi.tabs.create({
        url
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function openEditorViaUrls(urls: string[]): Promise<NativeOpenResult> {
    for (const url of urls) {
      const result = await openEditorViaUrl(url);
      if (!result.ok) {
        return result;
      }
    }

    return { ok: true };
  }

  async function openDirectoryInEditor(commandTemplate?: string, editorId?: string): Promise<NativeOpenResult> {
    await refreshStoredConfig();
    const serverInfo = await refreshServerInfo({ force: true });
    const resolvedEditorId = editorId || state.preferredEditorId;
    const launch = resolveEditorLaunch(state.nativeHostConfig, resolvedEditorId);
    const urlTemplate = launch.urlTemplate.trim();
    const appUrl = launch.appUrl.trim();
    const canLaunchEditorApp = Boolean(appUrl && !launch.hasCustomUrlOverride);
    const launchPath = serverInfo?.rootPath || state.nativeHostConfig.launchPath.trim();
    const isCursorLaunch = launch.editorId === DEFAULT_EDITOR_ID;
    const cursorPromptUrl = isCursorLaunch
      ? buildCursorPromptUrl(buildCursorPromptText(state.enabledOrigins))
      : "";

    await generateContext(resolvedEditorId);

    if (isCursorLaunch) {
      const urls: string[] = [];

      if (launchPath && urlTemplate) {
        const target = await resolveActiveLaunchTarget({ requestPermission: true });
        if (target.ok === false) {
          return { ok: false, error: target.error };
        }
        urls.push(buildEditorLaunchUrl(urlTemplate, target.launchPath, target.rootId));
      }

      urls.push(cursorPromptUrl);
      return openEditorViaUrls(urls);
    }

    if (!launchPath && canLaunchEditorApp) {
      return openEditorViaUrl(buildEditorAppUrl(appUrl));
    }

    if (!launchPath) {
      const error = urlTemplate
        ? `Set the absolute editor launch path in Settings to open the remembered root in ${launch.preset.label}. Chrome does not expose local folder paths from the directory picker.`
        : "Configure the shared editor launch path in the options page first.";
      return { ok: false, error };
    }

    if (urlTemplate) {
      const target = await resolveActiveLaunchTarget({ requestPermission: true });
      if (target.ok === false) {
        return { ok: false, error: target.error };
      }
      return openEditorViaUrl(buildEditorLaunchUrl(urlTemplate, target.launchPath, target.rootId));
    }

    const target = await resolveActiveLaunchTarget({ requestPermission: true });
    if (target.ok === false) {
      return { ok: false, error: target.error };
    }

    const verification = await verifyNativeHostRoot({
      rootResult: {
        ok: true,
        sentinel: state.rootSentinel!,
        permission: "granted"
      },
      launchPathOverride: target.launchPath
    });
    if (!verification.ok) {
      return verification;
    }

    try {
      const response = await chromeApi.runtime.sendNativeMessage(state.nativeHostConfig.hostName, {
        type: "openDirectory",
        path: target.launchPath,
        expectedRootId: target.rootId,
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

  async function revealRootInOs(): Promise<NativeOpenResult> {
    await refreshStoredConfig();
    const target = await resolveActiveLaunchTarget({ requestPermission: true });
    if (target.ok === false) {
      return { ok: false, error: target.error };
    }

    if (!state.nativeHostConfig.hostName.trim()) {
      return { ok: false, error: "Configure the native host name and shared editor launch path in the options page first." };
    }

    try {
      const response = await chromeApi.runtime.sendNativeMessage(state.nativeHostConfig.hostName, {
        type: "revealDirectory",
        path: target.launchPath,
        expectedRootId: target.rootId
      });

      if (!response?.ok) {
        throw new Error(String(response?.error || "Reveal directory request failed."));
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
    repository: {
      exists: (descriptor) => withServerFallback({
        remoteOperation: () => serverClient.hasFixture(descriptor).then((result) => result.exists),
        localOperation: () => localFixtureExists(descriptor)
      }),
      read: (descriptor) => withServerFallback({
        remoteOperation: async () => {
          const result = await serverClient.readFixture(descriptor);
          if (!result.exists) {
            return null;
          }

          return {
            request: result.request,
            meta: result.meta,
            bodyBase64: result.bodyBase64,
            size: result.size
          };
        },
        localOperation: () => localReadFixture(descriptor)
      }),
      writeIfAbsent: (payload) => withServerFallback({
        remoteOperation: () => serverClient.writeFixtureIfAbsent(payload),
        localOperation: () => localWriteFixture(payload)
      })
    },
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
      case "native.revealRoot": {
        const result = await revealRootInOs();
        await persistSnapshot();
        return result;
      }
      case "scenario.list": {
        await refreshStoredConfig();
        const target = await resolveActiveLaunchTarget({ requestPermission: false });
        if (target.ok === false) {
          return { ok: false, error: target.error };
        }
        const result = await chromeApi.runtime.sendNativeMessage(state.nativeHostConfig.hostName, {
          type: "listScenarios",
          path: target.launchPath,
          expectedRootId: target.rootId
        });
        return result as { ok: true; scenarios: string[] };
      }
      case "scenario.save": {
        await refreshStoredConfig();
        const target = await resolveActiveLaunchTarget({ requestPermission: false });
        if (target.ok === false) {
          return { ok: false, error: target.error };
        }
        const result = await chromeApi.runtime.sendNativeMessage(state.nativeHostConfig.hostName, {
          type: "saveScenario",
          path: target.launchPath,
          expectedRootId: target.rootId,
          name: message.name
        });
        return result as { ok: true; name: string };
      }
      case "scenario.switch": {
        await refreshStoredConfig();
        const target = await resolveActiveLaunchTarget({ requestPermission: false });
        if (target.ok === false) {
          return { ok: false, error: target.error };
        }
        const result = await chromeApi.runtime.sendNativeMessage(state.nativeHostConfig.hostName, {
          type: "switchScenario",
          path: target.launchPath,
          expectedRootId: target.rootId,
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
      queueServerRefresh({ force: true });
    });
    chromeApi.runtime.onInstalled.addListener(() => {
      refreshStoredConfig().catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : String(error));
      });
      queueServerRefresh({ force: true });
    });
    listenersRegistered = true;
  }

  async function start(): Promise<void> {
    registerListeners();
    await refreshStoredConfig();
    queueServerRefresh({ force: true });
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
    revealRootInOs,
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
