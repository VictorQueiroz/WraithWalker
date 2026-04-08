import { buildSessionSnapshot } from "./lib/background-helpers.js";
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
  DEFAULT_NATIVE_HOST_CONFIG,
  OFFSCREEN_REASONS,
  OFFSCREEN_URL,
  SERVER_HEARTBEAT_INTERVAL_MS
} from "./lib/constants.js";
import {
  buildCursorPromptText,
  buildCursorPromptUrl,
  buildEditorAppUrl,
  buildEditorLaunchUrl,
  resolveEditorLaunch
} from "./lib/editor-launch.js";
import type { BackgroundMessage, BackgroundMessageResult, ErrorResult, NativeOpenResult, NativeVerifyResult, OffscreenMessage, RootReadyResult, RootReadySuccess, SiteConfigsResult } from "./lib/messages.js";
import { createRequestLifecycle as defaultCreateRequestLifecycle } from "./lib/request-lifecycle.js";
import { createSessionController as defaultCreateSessionController } from "./lib/session-controller.js";
import { normalizeSiteConfigs as defaultNormalizeSiteConfigs } from "./lib/site-config.js";
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
  type ServerScenarioTraceRecord,
  type WraithWalkerServerClient
} from "./lib/wraithwalker-server.js";

const DEBUGGER_VERSION = "1.3";
const TRACE_BINDING_NAME = "__wraithwalkerTraceBinding";
const HEARTBEAT_ALARM_NAME = "wraithwalker-server-heartbeat";
type DetachReason = "target_closed" | "canceled_by_user";

interface DebuggeeTarget {
  tabId?: number;
}

interface RuntimeApi {
  getURL(path: string): string;
  getManifest?: () => { version?: string };
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

interface AlarmsApi {
  create(name: string, alarmInfo: { when?: number }): void;
  clear(name: string): Promise<boolean> | boolean;
  onAlarm: {
    addListener(listener: (alarm: { name: string }) => void): void;
  };
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
  alarms?: AlarmsApi;
}

interface BackgroundState {
  sessionActive: boolean;
  attachedTabs: Map<number, AttachedTabState>;
  requests: Map<string, RequestEntry>;
  enabledOrigins: string[];
  siteConfigsByOrigin: Map<string, SiteConfig>;
  localEnabledOrigins: string[];
  localSiteConfigsByOrigin: Map<string, SiteConfig>;
  preferredEditorId: string;
  lastError: string;
  localRootReady: boolean;
  localRootSentinel: RootSentinel | null;
  rootReady: boolean;
  rootSentinel: RootSentinel | null;
  nativeHostConfig: NativeHostConfig;
  extensionClientId: string;
  extensionVersion: string;
  serverInfo: {
    rootPath: string;
    sentinel: RootSentinel;
    baseUrl: string;
    mcpUrl: string;
    trpcUrl: string;
  } | null;
  activeTrace: ServerScenarioTraceRecord | null;
  serverCheckedAt: number;
  legacySiteConfigsMigrated: boolean;
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
  getSiteConfigs?: () => Promise<SiteConfig[]>;
  getLegacySiteConfigs?: typeof defaultGetLegacySiteConfigs;
  getLegacySiteConfigsMigrated?: typeof defaultGetLegacySiteConfigsMigrated;
  getNativeHostConfig?: typeof defaultGetNativeHostConfig;
  getPreferredEditorId?: typeof defaultGetPreferredEditorId;
  getOrCreateExtensionClientId?: typeof defaultGetOrCreateExtensionClientId;
  setLegacySiteConfigsMigrated?: typeof defaultSetLegacySiteConfigsMigrated;
  setLastSessionSnapshot?: typeof defaultSetLastSessionSnapshot;
  createWraithWalkerServerClient?: typeof defaultCreateWraithWalkerServerClient;
  createSessionController?: (dependencies: Parameters<typeof defaultCreateSessionController>[0]) => SessionControllerApi;
  createRequestLifecycle?: (dependencies: Parameters<typeof defaultCreateRequestLifecycle>[0]) => RequestLifecycleApi;
  normalizeSiteConfigs?: typeof defaultNormalizeSiteConfigs;
  initialState?: Partial<BackgroundState>;
}

function createUnavailableServerClient(): WraithWalkerServerClient {
  const unavailable = async (): Promise<never> => {
    throw new Error("Local WraithWalker server unavailable.");
  };

  return {
    getSystemInfo: unavailable,
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

interface TraceBindingPayload {
  pageUrl: string;
  topOrigin: string;
  selector: string;
  tagName: string;
  textSnippet: string;
  role?: string;
  ariaLabel?: string;
  href?: string;
  recordedAt?: string;
}

function buildTraceCollectorSource(bindingName: string): string {
  return `(() => {
    const BINDING_NAME = ${JSON.stringify(bindingName)};
    const STATE_KEY = "__wraithwalkerTraceState";
    const DISABLE_KEY = "__wraithwalkerDisableTrace";
    const esc = (value) => {
      if (globalThis.CSS && typeof globalThis.CSS.escape === "function") {
        return globalThis.CSS.escape(value);
      }
      return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
    };
    const clip = (value, limit = 160) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, limit);
    const indexInType = (el) => {
      let index = 1;
      let node = el;
      while ((node = node.previousElementSibling)) {
        if (node.tagName === el.tagName) index += 1;
      }
      return index;
    };
    const segmentFor = (el) => {
      const tag = el.tagName.toLowerCase();
      if (el.id) return "#" + esc(el.id);
      for (const attr of ["data-testid", "data-test", "data-qa"]) {
        const value = el.getAttribute(attr);
        if (value) return tag + "[" + attr + "=" + JSON.stringify(value) + "]";
      }
      let segment = tag;
      const role = el.getAttribute("role");
      if (role) segment += "[role=" + JSON.stringify(role) + "]";
      else {
        const classes = [...el.classList]
          .filter((name) => /^[a-zA-Z0-9_-]+$/.test(name))
          .slice(0, 2);
        if (classes.length) {
          segment += classes.map((name) => "." + esc(name)).join("");
        }
      }
      const parent = el.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((candidate) => candidate.tagName === el.tagName);
        if (siblings.length > 1) {
          segment += ":nth-of-type(" + indexInType(el) + ")";
        }
      }
      return segment;
    };
    const selectorFor = (element) => {
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
        const segment = segmentFor(current);
        parts.unshift(segment);
        if (segment.startsWith("#")) break;
        current = current.parentElement;
      }
      return parts.join(" > ");
    };
    const handler = (event) => {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
      const target = path.find((value) => value instanceof Element);
      if (!(target instanceof Element) || typeof globalThis[BINDING_NAME] !== "function") {
        return;
      }
      const payload = {
        recordedAt: new Date().toISOString(),
        pageUrl: globalThis.location?.href || "",
        topOrigin: globalThis.location?.origin || "",
        selector: selectorFor(target),
        tagName: target.tagName.toLowerCase(),
        textSnippet: clip(target.textContent || target.getAttribute("aria-label") || target.getAttribute("title") || ""),
        role: target.getAttribute("role") || undefined,
        ariaLabel: target.getAttribute("aria-label") || undefined,
        href: target instanceof HTMLAnchorElement ? target.href : (target.getAttribute("href") || undefined)
      };
      globalThis[BINDING_NAME](JSON.stringify(payload));
    };
    const previous = globalThis[STATE_KEY];
    if (previous && typeof previous.disable === "function") {
      previous.disable();
    }
    globalThis[STATE_KEY] = {
      disable() {
        globalThis.removeEventListener("click", handler, true);
      }
    };
    globalThis[DISABLE_KEY] = () => globalThis[STATE_KEY]?.disable?.();
    globalThis.addEventListener("click", handler, true);
  })();`;
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
    "config.readConfiguredSiteConfigs",
    "config.readEffectiveSiteConfigs",
    "config.writeConfiguredSiteConfigs",
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
  const resolvedCreateWraithWalkerServerClient = createWraithWalkerServerClient
    ?? (isTestMode() ? createUnavailableServerClient : defaultCreateWraithWalkerServerClient);
  const state: BackgroundState = {
    sessionActive: false,
    attachedTabs: new Map(),
    requests: new Map(),
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
  let serverRefreshPromise: Promise<typeof state.serverInfo> | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  let listenersRegistered = false;

  function setLastError(message: string) {
    state.lastError = message || "";
  }

  function normalizeEffectiveSiteConfigs(siteConfigs: SiteConfig[]): SiteConfig[] {
    return normalizeSiteConfigs(siteConfigs as Array<Partial<SiteConfig> & { origin: string }>);
  }

  function haveSameSiteConfigs(left: SiteConfig[], right: SiteConfig[]): boolean {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((siteConfig, index) => (
      siteConfig.origin === right[index]?.origin
      && siteConfig.createdAt === right[index]?.createdAt
      && siteConfig.dumpAllowlistPatterns.length === right[index]?.dumpAllowlistPatterns.length
      && siteConfig.dumpAllowlistPatterns.every(
        (pattern, patternIndex) => pattern === right[index]?.dumpAllowlistPatterns[patternIndex]
      )
    ));
  }

  function currentEffectiveSiteConfigs(): SiteConfig[] {
    return normalizeEffectiveSiteConfigs([...state.siteConfigsByOrigin.values()]);
  }

  function applyEffectiveSiteConfigs(siteConfigs: SiteConfig[]): boolean {
    const normalized = normalizeEffectiveSiteConfigs(siteConfigs);
    if (haveSameSiteConfigs(currentEffectiveSiteConfigs(), normalized)) {
      return false;
    }

    state.enabledOrigins = normalized.map((siteConfig) => siteConfig.origin);
    state.siteConfigsByOrigin = new Map(normalized.map((siteConfig) => [siteConfig.origin, siteConfig]));
    return true;
  }

  function restoreLocalEffectiveSiteConfigs(): boolean {
    return applyEffectiveSiteConfigs([...state.localSiteConfigsByOrigin.values()]);
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
    state.activeTrace = null;
    state.serverCheckedAt = Date.now();
    const siteConfigsChanged = restoreLocalEffectiveSiteConfigs();
    updateEffectiveRootState();
    scheduleHeartbeat();
    void syncTraceBindings().catch(() => undefined);
    if (siteConfigsChanged && state.sessionActive) {
      void sessionController.reconcileTabs().catch(() => undefined);
    }
  }

  function shouldKeepHeartbeatAlive(): boolean {
    return state.sessionActive || Boolean(state.activeTrace);
  }

  function clearHeartbeatTimer(): void {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function scheduleHeartbeatAlarm(): void {
    if (!chromeApi.alarms) {
      return;
    }

    chromeApi.alarms.create(HEARTBEAT_ALARM_NAME, {
      when: Date.now() + SERVER_HEARTBEAT_INTERVAL_MS
    });
  }

  async function clearHeartbeatAlarm(): Promise<void> {
    if (!chromeApi.alarms) {
      return;
    }

    await chromeApi.alarms.clear(HEARTBEAT_ALARM_NAME);
  }

  function scheduleHeartbeat(): void {
    clearHeartbeatTimer();
    void clearHeartbeatAlarm().catch(() => undefined);

    if (!shouldKeepHeartbeatAlive()) {
      return;
    }

    heartbeatTimer = setTimeout(() => {
      void refreshServerInfo({ force: true }).catch(() => undefined);
    }, SERVER_HEARTBEAT_INTERVAL_MS);
    scheduleHeartbeatAlarm();
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
        if (!state.extensionClientId) {
          state.extensionClientId = await getOrCreateExtensionClientId();
        }
        const info = await serverClient.heartbeat({
          clientId: state.extensionClientId,
          extensionVersion: state.extensionVersion,
          sessionActive: state.sessionActive,
          enabledOrigins: [...state.enabledOrigins]
        });
        const previousTraceId = state.activeTrace?.traceId || null;
        const siteConfigsChanged = applyEffectiveSiteConfigs(
          info.siteConfigs ?? [...state.localSiteConfigsByOrigin.values()]
        );
        state.serverInfo = {
          rootPath: info.rootPath,
          sentinel: info.sentinel,
          baseUrl: info.baseUrl,
          mcpUrl: info.mcpUrl,
          trpcUrl: info.trpcUrl
        };
        state.activeTrace = info.activeTrace;
        state.serverCheckedAt = Date.now();
        updateEffectiveRootState();
        scheduleHeartbeat();
        if (previousTraceId !== (info.activeTrace?.traceId || null)) {
          await syncTraceBindings();
        }
        if (siteConfigsChanged && state.sessionActive) {
          await sessionController.reconcileTabs();
        }
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
    const [nativeHostConfig, extensionClientId, legacySiteConfigsMigrated] = await Promise.all([
      getNativeHostConfig(),
      getOrCreateExtensionClientId(),
      state.legacySiteConfigsMigrated
        ? Promise.resolve(true)
        : getLegacySiteConfigsMigrated()
    ]);
    state.legacySiteConfigsMigrated ||= legacySiteConfigsMigrated;

    if (!getSiteConfigs) {
      await ensureLegacySiteConfigsMigrated();
    }

    const sites = await (getSiteConfigs ? getSiteConfigs() : readLocalEffectiveSiteConfigs());
    const normalizedSites = normalizeEffectiveSiteConfigs(sites);
    state.localEnabledOrigins = normalizedSites.map((site: SiteConfig) => site.origin);
    state.localSiteConfigsByOrigin = new Map(normalizedSites.map((site: SiteConfig) => [site.origin, site]));
    if (!state.serverInfo) {
      applyEffectiveSiteConfigs(normalizedSites);
    }
    state.nativeHostConfig = { ...DEFAULT_NATIVE_HOST_CONFIG, ...nativeHostConfig };
    state.preferredEditorId = DEFAULT_EDITOR_ID;
    state.extensionClientId = extensionClientId;
    state.extensionVersion = chromeApi.runtime.getManifest?.().version || state.extensionVersion || "0.0.0";
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

  function isLocalRootConfigUnavailable(result: ErrorResult): boolean {
    return result.error === "No root directory selected."
      || result.error === "Root directory access is not granted.";
  }

  async function readLocalEffectiveSiteConfigs(): Promise<SiteConfig[]> {
    const result = await sendOffscreenMessage<SiteConfigsResult>("fs.readEffectiveSiteConfigs");
    if (!result) {
      return [];
    }

    if (result.ok === true) {
      if (!Array.isArray(result.siteConfigs)) {
        return [];
      }

      return normalizeEffectiveSiteConfigs(result.siteConfigs);
    }

    if (isLocalRootConfigUnavailable(result)) {
      return [];
    }

    throw new Error(getErrorMessage(result));
  }

  async function readLocalConfiguredSiteConfigs(): Promise<SiteConfig[]> {
    const result = await sendOffscreenMessage<SiteConfigsResult>("fs.readConfiguredSiteConfigs");
    if (!result) {
      return [];
    }

    if (result.ok === true) {
      if (!Array.isArray(result.siteConfigs)) {
        return [];
      }

      return normalizeEffectiveSiteConfigs(result.siteConfigs);
    }

    if (isLocalRootConfigUnavailable(result)) {
      return [];
    }

    throw new Error(getErrorMessage(result));
  }

  async function writeLocalConfiguredSiteConfigs(siteConfigs: SiteConfig[]): Promise<SiteConfig[]> {
    const result = await sendOffscreenMessage<SiteConfigsResult>("fs.writeConfiguredSiteConfigs", { siteConfigs });
    if (!result) {
      throw new Error("Failed to update root config.");
    }

    if (result.ok === true) {
      return normalizeEffectiveSiteConfigs(result.siteConfigs ?? []);
    }

    throw new Error(getErrorMessage(result));
  }

  function toSiteConfigsResult(
    siteConfigs: SiteConfig[],
    sentinel: RootSentinel
  ): SiteConfigsResult {
    return {
      ok: true,
      siteConfigs: normalizeEffectiveSiteConfigs(siteConfigs),
      sentinel
    };
  }

  function mergeLegacySiteConfigs(configuredSiteConfigs: SiteConfig[], legacySiteConfigs: SiteConfig[]): SiteConfig[] {
    const merged = new Map<string, SiteConfig>();

    for (const siteConfig of legacySiteConfigs) {
      merged.set(siteConfig.origin, {
        ...siteConfig,
        dumpAllowlistPatterns: [...siteConfig.dumpAllowlistPatterns]
      });
    }

    for (const siteConfig of configuredSiteConfigs) {
      merged.set(siteConfig.origin, {
        ...siteConfig,
        dumpAllowlistPatterns: [...siteConfig.dumpAllowlistPatterns]
      });
    }

    return normalizeEffectiveSiteConfigs([...merged.values()]);
  }

  async function ensureLegacySiteConfigsMigrated(): Promise<void> {
    if (state.legacySiteConfigsMigrated) {
      return;
    }

    const rootResult = await ensureLocalRootReady({ silent: true });
    if (!rootResult.ok) {
      return;
    }

    const legacySiteConfigs = normalizeEffectiveSiteConfigs(await getLegacySiteConfigs());
    if (legacySiteConfigs.length > 0) {
      const configuredSiteConfigs = await readLocalConfiguredSiteConfigs();
      const mergedSiteConfigs = mergeLegacySiteConfigs(configuredSiteConfigs, legacySiteConfigs);
      if (!haveSameSiteConfigs(configuredSiteConfigs, mergedSiteConfigs)) {
        await writeLocalConfiguredSiteConfigs(mergedSiteConfigs);
      }
    }

    await setLegacySiteConfigsMigrated(true);
    state.legacySiteConfigsMigrated = true;
  }

  async function ensureLocalRootReady(
    { requestPermission = false, silent = false }: { requestPermission?: boolean; silent?: boolean } = {}
  ): Promise<RootReadyResult> {
    const result = await sendOffscreenMessage<RootReadyResult>("fs.ensureRoot", { requestPermission });
    if (!result) {
      state.localRootReady = false;
      state.localRootSentinel = null;
      updateEffectiveRootState();
      if (!silent) {
        setLastError("No root directory selected.");
      }
      return { ok: false, error: "No root directory selected." };
    }
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

  async function readConfiguredSiteConfigsForAuthority(): Promise<SiteConfigsResult> {
    const serverInfo = await refreshServerInfo({ force: true });
    if (!serverInfo) {
      await ensureLegacySiteConfigsMigrated();
      return sendOffscreenMessage<SiteConfigsResult>("fs.readConfiguredSiteConfigs");
    }

    try {
      const result = await serverClient.readConfiguredSiteConfigs();
      return toSiteConfigsResult(result.siteConfigs ?? [], result.sentinel);
    } catch (error) {
      markServerOffline();
      const localRoot = await ensureLocalRootReady({ silent: true });
      if (localRoot.ok) {
        await ensureLegacySiteConfigsMigrated();
        return sendOffscreenMessage<SiteConfigsResult>("fs.readConfiguredSiteConfigs");
      }

      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: `Local WraithWalker server is unavailable and no fallback root is ready. ${message}`
      };
    }
  }

  async function readEffectiveSiteConfigsForAuthority(): Promise<SiteConfigsResult> {
    const serverInfo = await refreshServerInfo({ force: true });
    if (!serverInfo) {
      await ensureLegacySiteConfigsMigrated();
      return sendOffscreenMessage<SiteConfigsResult>("fs.readEffectiveSiteConfigs");
    }

    try {
      const result = await serverClient.readEffectiveSiteConfigs();
      return toSiteConfigsResult(result.siteConfigs ?? [], result.sentinel);
    } catch (error) {
      markServerOffline();
      const localRoot = await ensureLocalRootReady({ silent: true });
      if (localRoot.ok) {
        await ensureLegacySiteConfigsMigrated();
        return sendOffscreenMessage<SiteConfigsResult>("fs.readEffectiveSiteConfigs");
      }

      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: `Local WraithWalker server is unavailable and no fallback root is ready. ${message}`
      };
    }
  }

  async function writeConfiguredSiteConfigsForAuthority(siteConfigs: SiteConfig[]): Promise<SiteConfigsResult> {
    const serverInfo = await refreshServerInfo({ force: true });
    if (!serverInfo) {
      await ensureLegacySiteConfigsMigrated();
      const result = await sendOffscreenMessage<SiteConfigsResult>("fs.writeConfiguredSiteConfigs", {
        siteConfigs
      });
      if (result.ok) {
        await refreshStoredConfig();
        if (state.sessionActive && !state.serverInfo) {
          await sessionController.reconcileTabs();
        }
      }
      return result;
    }

    try {
      const result = await serverClient.writeConfiguredSiteConfigs(siteConfigs);
      await refreshServerInfo({ force: true });
      return toSiteConfigsResult(result.siteConfigs ?? [], result.sentinel);
    } catch (error) {
      markServerOffline();
      const localRoot = await ensureLocalRootReady({ silent: true });
      if (!localRoot.ok) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: `Local WraithWalker server is unavailable and no fallback root is ready. ${message}`
        };
      }

      await ensureLegacySiteConfigsMigrated();
      const result = await sendOffscreenMessage<SiteConfigsResult>("fs.writeConfiguredSiteConfigs", {
        siteConfigs
      });
      if (result.ok) {
        await refreshStoredConfig();
        if (state.sessionActive && !state.serverInfo) {
          await sessionController.reconcileTabs();
        }
      }
      return result;
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

  async function recordTraceClick(tabId: number, payload: TraceBindingPayload): Promise<void> {
    if (!state.serverInfo || !state.activeTrace) {
      return;
    }

    try {
      const result = await serverClient.recordTraceClick({
        traceId: state.activeTrace.traceId,
        step: {
          stepId: crypto.randomUUID(),
          tabId,
          recordedAt: payload.recordedAt || new Date().toISOString(),
          pageUrl: payload.pageUrl,
          topOrigin: payload.topOrigin || state.attachedTabs.get(tabId)?.topOrigin || "",
          selector: payload.selector,
          tagName: payload.tagName,
          textSnippet: payload.textSnippet,
          ...(payload.role ? { role: payload.role } : {}),
          ...(payload.ariaLabel ? { ariaLabel: payload.ariaLabel } : {}),
          ...(payload.href ? { href: payload.href } : {})
        }
      });
      state.activeTrace = result.activeTrace;
      scheduleHeartbeat();
    } catch {
      markServerOffline();
    }
  }

  async function linkTraceFixtureIfNeeded({
    descriptor,
    entry,
    capturedAt
  }: {
    descriptor: FixtureDescriptor;
    entry: RequestEntry;
    capturedAt: string;
  }): Promise<void> {
    if (!state.serverInfo || !state.activeTrace || !entry.requestedAt) {
      return;
    }

    try {
      const result = await serverClient.linkTraceFixture({
        traceId: state.activeTrace.traceId,
        tabId: entry.tabId,
        requestedAt: entry.requestedAt,
        fixture: {
          bodyPath: descriptor.bodyPath,
          requestUrl: descriptor.requestUrl,
          resourceType: entry.resourceType || "Other",
          capturedAt
        }
      });
      state.activeTrace = result.trace;
      scheduleHeartbeat();
    } catch {
      markServerOffline();
    }
  }

  async function armTraceForTab(tabId: number): Promise<void> {
    const tabState = state.attachedTabs.get(tabId);
    const activeTrace = state.activeTrace;
    if (!tabState || !activeTrace || !state.serverInfo || !state.sessionActive) {
      return;
    }

    if (tabState.traceArmedForTraceId === activeTrace.traceId) {
      return;
    }

    try {
      await chromeApi.debugger.sendCommand(debuggerTarget(tabId), "Runtime.addBinding", {
        name: TRACE_BINDING_NAME
      });
    } catch {
      // The binding may already be registered for this target.
    }

    const source = buildTraceCollectorSource(TRACE_BINDING_NAME);

    if (tabState.traceScriptIdentifier) {
      try {
        await chromeApi.debugger.sendCommand(debuggerTarget(tabId), "Page.removeScriptToEvaluateOnNewDocument", {
          identifier: tabState.traceScriptIdentifier
        });
      } catch {
        // Ignore stale script identifiers on refresh/navigate races.
      }
    }

    const injected = await chromeApi.debugger.sendCommand<{ identifier?: string }>(
      debuggerTarget(tabId),
      "Page.addScriptToEvaluateOnNewDocument",
      { source }
    );
    await chromeApi.debugger.sendCommand(debuggerTarget(tabId), "Runtime.evaluate", {
      expression: source,
      awaitPromise: false,
      returnByValue: false
    });

    tabState.traceScriptIdentifier = injected.identifier || null;
    tabState.traceArmedForTraceId = activeTrace.traceId;
  }

  async function disarmTraceForTab(tabId: number): Promise<void> {
    const tabState = state.attachedTabs.get(tabId);
    if (!tabState) {
      return;
    }

    if (tabState.traceScriptIdentifier) {
      try {
        await chromeApi.debugger.sendCommand(debuggerTarget(tabId), "Page.removeScriptToEvaluateOnNewDocument", {
          identifier: tabState.traceScriptIdentifier
        });
      } catch {
        // Ignore stale script identifiers on detached targets.
      }
    }

    try {
      await chromeApi.debugger.sendCommand(debuggerTarget(tabId), "Runtime.evaluate", {
        expression: "globalThis.__wraithwalkerDisableTrace?.()",
        awaitPromise: false,
        returnByValue: false
      });
    } catch {
      // Ignore detached tabs or unavailable execution contexts.
    }

    tabState.traceScriptIdentifier = null;
    tabState.traceArmedForTraceId = null;
  }

  async function syncTraceBindings(): Promise<void> {
    const shouldArm = Boolean(state.serverInfo && state.activeTrace && state.sessionActive);
    const tabIds = [...state.attachedTabs.keys()];

    await Promise.all(tabIds.map((tabId) => shouldArm
      ? armTraceForTab(tabId)
      : disarmTraceForTab(tabId)));
  }

  async function attachTab(tabId: number, topOrigin: string): Promise<void> {
    if (state.attachedTabs.has(tabId)) {
      const existing = state.attachedTabs.get(tabId)!;
      existing.topOrigin = topOrigin;
      await syncTraceBindings();
      return;
    }

    await chromeApi.debugger.attach(debuggerTarget(tabId), DEBUGGER_VERSION);
    await chromeApi.debugger.sendCommand(debuggerTarget(tabId), "Network.enable");
    await chromeApi.debugger.sendCommand(debuggerTarget(tabId), "Runtime.enable");
    await chromeApi.debugger.sendCommand(debuggerTarget(tabId), "Page.enable");
    await chromeApi.debugger.sendCommand(debuggerTarget(tabId), "Network.setCacheDisabled", { cacheDisabled: true });
    await chromeApi.debugger.sendCommand(debuggerTarget(tabId), "Fetch.enable", {
      patterns: [{ urlPattern: "*" }]
    });
    state.attachedTabs.set(tabId, {
      topOrigin,
      traceScriptIdentifier: null,
      traceArmedForTraceId: null
    });
    await syncTraceBindings();
  }

  async function detachTab(tabId: number): Promise<void> {
    if (!state.attachedTabs.has(tabId)) {
      return;
    }

    await disarmTraceForTab(tabId);
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
    getSiteConfigForOrigin: (topOrigin: string) => state.siteConfigsByOrigin.get(topOrigin),
    onFixturePersisted: linkTraceFixtureIfNeeded
  });

  async function handleDebuggerEvent(source: DebuggeeTarget, method: string, params: unknown): Promise<void> {
    try {
      if (method === "Runtime.bindingCalled" && source.tabId) {
        const event = params as { name?: string; payload?: string };
        if (event.name === TRACE_BINDING_NAME && typeof event.payload === "string") {
          const parsed = JSON.parse(event.payload) as TraceBindingPayload;
          await recordTraceClick(source.tabId, parsed);
        }
        return;
      }

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

    for (const key of [...state.requests.keys()]) {
      if (key.startsWith(`${source.tabId}:`)) {
        state.requests.delete(key);
      }
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

  function handleAlarm(alarm: { name: string }): void {
    if (alarm.name !== HEARTBEAT_ALARM_NAME) {
      return;
    }

    void refreshServerInfo({ force: true }).catch(() => undefined);
  }

  function handleStorageChanged(changes: Record<string, unknown>, areaName: string): void {
    if (areaName !== "local") {
      return;
    }

    Promise.resolve()
      .then(async () => {
        if (changes.nativeHostConfig || changes.preferredEditorId) {
          await refreshStoredConfig();
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
      case "config.readConfiguredSiteConfigs":
        return readConfiguredSiteConfigsForAuthority();
      case "config.readEffectiveSiteConfigs":
        return readEffectiveSiteConfigsForAuthority();
      case "config.writeConfiguredSiteConfigs":
        return writeConfiguredSiteConfigsForAuthority(message.siteConfigs);
      case "session.start": {
        await refreshServerInfo({ force: true });
        const result = await sessionController.startSession();
        queueServerRefresh({ force: true });
        scheduleHeartbeat();
        return result;
      }
      case "session.stop": {
        const result = await sessionController.stopSession();
        queueServerRefresh({ force: true });
        scheduleHeartbeat();
        return result;
      }
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
    chromeApi.alarms?.onAlarm.addListener(handleAlarm);
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
    scheduleHeartbeat();
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
