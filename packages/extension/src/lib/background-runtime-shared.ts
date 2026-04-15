import type { BackgroundMessage, ErrorResult } from "./messages.js";
import type {
  BrowserTab,
  DebuggeeTarget
} from "./chrome-api.js";
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
export type {
  AlarmsApi,
  BrowserTab,
  ChromeApi,
  ContextMenuOnClickData,
  ContextMenusApi,
  DebuggerApi,
  DebuggeeTarget,
  DetachReason,
  OffscreenApi,
  PermissionsApi,
  RuntimeApi,
  StorageApi,
  TabsApi
} from "./chrome-api.js";

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
  populatePostData?(
    tabId: number,
    requestId: string,
    fallbackRequest?: { postData?: string }
  ): Promise<unknown>;
  ensureDescriptor?(entry: unknown): Promise<unknown>;
  handleFetchRequestPaused(
    source: DebuggeeTarget,
    params: unknown
  ): Promise<void>;
  handleNetworkRequestWillBeSent(source: DebuggeeTarget, params: unknown): void;
  handleNetworkResponseReceived(source: DebuggeeTarget, params: unknown): void;
  handleNetworkLoadingFinished(
    source: DebuggeeTarget,
    params: unknown
  ): Promise<void>;
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

export function isDetachedDebuggerCommandMessage(
  message: string,
  tabId: number
): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("debugger is not attached to the tab with id:") &&
    normalized.includes(String(tabId))
  );
}

export class StaleFetchRequestCommandError extends Error {
  constructor(
    readonly tabId: number,
    readonly method: string,
    readonly rawMessage: string
  ) {
    super("");
    this.name = "StaleFetchRequestCommandError";
  }
}

export function isInvalidFetchRequestMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("invalid interceptionid") ||
    normalized.includes("invalid requestid")
  );
}

export function isFetchResolutionCommand(method: string): boolean {
  return (
    method === "Fetch.continueRequest" ||
    method === "Fetch.fulfillRequest" ||
    method === "Fetch.failRequest" ||
    method === "Fetch.continueResponse"
  );
}

export function normalizeConsoleTimestamp(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return new Date().toISOString();
  }

  const milliseconds = value >= 1_000_000_000_000 ? value : value * 1_000;
  return new Date(milliseconds).toISOString();
}

export function clipConsoleText(value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "");
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

  const topOrigin = tabState?.topOrigin || extractOrigin(entry.url || "") || "";

  return {
    tabId,
    topOrigin,
    source:
      typeof entry.source === "string" && entry.source.trim()
        ? entry.source
        : "other",
    level:
      typeof entry.level === "string" && entry.level.trim()
        ? entry.level
        : "info",
    text: clipConsoleText(entry.text),
    timestamp: normalizeConsoleTimestamp(entry.timestamp),
    ...(typeof entry.url === "string" && entry.url.trim()
      ? { url: entry.url }
      : {}),
    ...(typeof entry.lineNumber === "number" &&
    Number.isFinite(entry.lineNumber)
      ? { lineNumber: entry.lineNumber }
      : {}),
    ...(typeof entry.columnNumber === "number" &&
    Number.isFinite(entry.columnNumber)
      ? { columnNumber: entry.columnNumber }
      : {})
  };
}

export function isBackgroundMessage(
  message: unknown
): message is BackgroundMessage {
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
    "scenario.switch",
    "scenario.diff",
    "scenario.saveFromTrace"
  ].includes(type || "");
}

export function getErrorMessage(result: unknown): string {
  if (
    typeof result === "object" &&
    result !== null &&
    "error" in result &&
    typeof (result as { error?: unknown }).error === "string" &&
    (result as { error: string }).error.trim()
  ) {
    return (result as { error: string }).error;
  }

  return "Unknown error.";
}

export function isLocalRootConfigUnavailable(result: ErrorResult): boolean {
  return (
    result.error === "No root directory selected." ||
    result.error === "Root directory access is not granted."
  );
}
