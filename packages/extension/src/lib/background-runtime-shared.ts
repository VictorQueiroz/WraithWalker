import type {
  BackgroundMessage,
  ErrorResult
} from "./messages.js";
import type {
  AttachedTabState,
  BrowserConsoleEntry,
  NativeHostConfig,
  RequestEntry,
  RootSentinel,
  SessionSnapshot,
  SiteConfig
} from "./types.js";
import type { ServerScenarioTraceRecord } from "./wraithwalker-server.js";

export type DetachReason = "target_closed" | "canceled_by_user";

export interface DebuggeeTarget {
  tabId?: number;
}

export interface BrowserTab {
  id?: number;
  url?: string;
}

export interface RuntimeApi {
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

export interface AlarmsApi {
  create(name: string, alarmInfo: { when?: number }): void;
  clear(name: string): Promise<boolean> | boolean;
  onAlarm: {
    addListener(listener: (alarm: { name: string }) => void): void;
  };
}

export interface DebuggerApi {
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

export interface TabsApi {
  query(queryInfo: Record<string, unknown>): Promise<BrowserTab[]>;
  create(createProperties: { url: string }): Promise<{ id?: number }>;
  onUpdated: {
    addListener(listener: (tabId: number, changeInfo: Record<string, unknown>, tab: BrowserTab) => void): void;
  };
  onRemoved: {
    addListener(listener: (tabId: number) => void): void;
  };
}

export interface StorageApi {
  onChanged: {
    addListener(listener: (changes: Record<string, unknown>, areaName: string) => void): void;
  };
}

export interface OffscreenApi {
  createDocument(config: {
    url: string;
    reasons: string[];
    justification: string;
  }): Promise<void>;
  closeDocument(): Promise<void>;
  Reason?: Record<string, string>;
}

export interface ChromeApi {
  runtime: RuntimeApi;
  debugger: DebuggerApi;
  tabs: TabsApi;
  storage: StorageApi;
  offscreen: OffscreenApi;
  alarms?: AlarmsApi;
}

export interface BackgroundServerInfo {
  rootPath: string;
  sentinel: RootSentinel;
  baseUrl: string;
  mcpUrl: string;
  trpcUrl: string;
}

export interface BackgroundState {
  sessionActive: boolean;
  attachedTabs: Map<number, AttachedTabState>;
  requests: Map<string, RequestEntry>;
  recentConsoleEntries: BrowserConsoleEntry[];
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
  serverInfo: BackgroundServerInfo | null;
  activeTrace: ServerScenarioTraceRecord | null;
  serverCheckedAt: number;
  legacySiteConfigsMigrated: boolean;
}

export interface SessionControllerApi {
  reconcileTabs(): Promise<void>;
  startSession(): Promise<SessionSnapshot>;
  stopSession(): Promise<SessionSnapshot>;
  handleTabStateChange(tabId: number, tab?: BrowserTab): Promise<void>;
}

export interface RequestLifecycleApi {
  ensureRequestEntry?(tabId: number, requestId: string): unknown;
  populatePostData?(tabId: number, requestId: string, fallbackRequest?: { postData?: string }): Promise<unknown>;
  ensureDescriptor?(entry: unknown): Promise<unknown>;
  handleFetchRequestPaused(source: DebuggeeTarget, params: unknown): Promise<void>;
  handleNetworkRequestWillBeSent(source: DebuggeeTarget, params: unknown): void;
  handleNetworkResponseReceived(source: DebuggeeTarget, params: unknown): void;
  handleNetworkLoadingFinished(source: DebuggeeTarget, params: unknown): Promise<void>;
  handleNetworkLoadingFailed(source: DebuggeeTarget, params: unknown): void;
}

export interface TraceBindingPayload {
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

interface DebuggerLogEntryPayload {
  entry?: {
    source?: string;
    level?: string;
    text?: string;
    timestamp?: number;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
}

export const MAX_RECENT_CONSOLE_ENTRIES = 200;
export const MAX_CONSOLE_ENTRY_TEXT_LENGTH = 4_000;

export function debuggerTarget(tabId: number): DebuggeeTarget {
  return { tabId };
}

export class DetachedDebuggerCommandError extends Error {
  constructor(
    readonly tabId: number,
    readonly method: string,
    readonly rawMessage: string
  ) {
    super("");
    this.name = "DetachedDebuggerCommandError";
  }
}

export function isDetachedDebuggerCommandMessage(message: string, tabId: number): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("debugger is not attached to the tab with id:")
    && normalized.includes(String(tabId));
}

export function normalizeConsoleTimestamp(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return new Date().toISOString();
  }

  const milliseconds = value >= 1_000_000_000_000
    ? value
    : value * 1_000;
  return new Date(milliseconds).toISOString();
}

export function clipConsoleText(value: unknown): string {
  const text = typeof value === "string"
    ? value
    : String(value ?? "");
  return text.length > MAX_CONSOLE_ENTRY_TEXT_LENGTH
    ? `${text.slice(0, MAX_CONSOLE_ENTRY_TEXT_LENGTH)}...`
    : text;
}

export function toBrowserConsoleEntry(
  tabId: number,
  params: unknown,
  extractOrigin: (url: string) => string | null,
  tabState?: AttachedTabState
): BrowserConsoleEntry | null {
  const entry = (params as DebuggerLogEntryPayload | null | undefined)?.entry;
  if (!entry) {
    return null;
  }

  const topOrigin = tabState?.topOrigin
    || extractOrigin(entry.url || "")
    || "";

  return {
    tabId,
    topOrigin,
    source: typeof entry.source === "string" && entry.source.trim()
      ? entry.source
      : "other",
    level: typeof entry.level === "string" && entry.level.trim()
      ? entry.level
      : "info",
    text: clipConsoleText(entry.text),
    timestamp: normalizeConsoleTimestamp(entry.timestamp),
    ...(typeof entry.url === "string" && entry.url.trim()
      ? { url: entry.url }
      : {}),
    ...(typeof entry.lineNumber === "number" && Number.isFinite(entry.lineNumber)
      ? { lineNumber: entry.lineNumber }
      : {}),
    ...(typeof entry.columnNumber === "number" && Number.isFinite(entry.columnNumber)
      ? { columnNumber: entry.columnNumber }
      : {})
  };
}

export function isBackgroundMessage(message: unknown): message is BackgroundMessage {
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
    "diagnostics.getReport",
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

export function getErrorMessage(result: unknown): string {
  if (
    typeof result === "object"
    && result !== null
    && "error" in result
    && typeof (result as { error?: unknown }).error === "string"
    && (result as { error: string }).error.trim()
  ) {
    return (result as { error: string }).error;
  }

  return "Unknown error.";
}

export function isLocalRootConfigUnavailable(result: ErrorResult): boolean {
  return result.error === "No root directory selected."
    || result.error === "Root directory access is not granted.";
}
