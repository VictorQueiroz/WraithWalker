export type DetachReason = "target_closed" | "canceled_by_user";

export interface DebuggeeTarget {
  tabId?: number;
}

export interface BrowserTab {
  id?: number;
  url?: string;
  active?: boolean;
}

export interface RuntimeApi {
  getURL(path: string): string;
  getManifest?: () => { version?: string };
  sendMessage(message: unknown): Promise<unknown>;
  sendNativeMessage(
    hostName: string,
    message: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  openOptionsPage(): void;
  onMessage: {
    addListener(
      listener: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: unknown) => void
      ) => boolean | void
    ): void;
    removeListener?: (
      listener: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: unknown) => void
      ) => boolean | void
    ) => void;
  };
  onStartup: {
    addListener(listener: () => void): void;
  };
  onInstalled: {
    addListener(listener: () => void): void;
  };
  getContexts?: (filter: {
    contextTypes: string[];
    documentUrls: string[];
  }) => Promise<unknown[]>;
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
  sendCommand<T = unknown>(
    target: DebuggeeTarget,
    method: string,
    params?: Record<string, unknown>
  ): Promise<T>;
  detach(target: DebuggeeTarget): Promise<void>;
  onEvent: {
    addListener(
      listener: (
        source: DebuggeeTarget,
        method: string,
        params: unknown
      ) => void
    ): void;
  };
  onDetach: {
    addListener(
      listener: (source: DebuggeeTarget, reason: DetachReason) => void
    ): void;
  };
}

export interface TabsApi {
  query(queryInfo: Record<string, unknown>): Promise<BrowserTab[]>;
  create(createProperties: { url: string }): Promise<{ id?: number }>;
  onActivated: {
    addListener(
      listener: (activeInfo: { tabId: number; windowId: number }) => void
    ): void;
  };
  onUpdated: {
    addListener(
      listener: (
        tabId: number,
        changeInfo: Record<string, unknown>,
        tab: BrowserTab
      ) => void
    ): void;
  };
  onRemoved: {
    addListener(listener: (tabId: number) => void): void;
  };
}

export interface PermissionsApi {
  request(options: { origins: string[] }): Promise<boolean>;
  remove?(options: { origins: string[] }): Promise<boolean>;
}

export interface ContextMenuOnClickData {
  menuItemId?: string | number;
  pageUrl?: string;
  frameUrl?: string;
  linkUrl?: string;
}

export interface ContextMenusApi {
  create(createProperties: {
    id: string;
    title: string;
    contexts: string[];
    documentUrlPatterns?: string[];
    enabled?: boolean;
  }): void;
  update(
    itemId: string | number,
    updateProperties: {
      title?: string;
      enabled?: boolean;
    }
  ): Promise<void> | void;
  removeAll(): Promise<void> | void;
  onClicked: {
    addListener(
      listener: (info: ContextMenuOnClickData, tab?: BrowserTab) => void
    ): void;
  };
}

export interface StorageApi {
  onChanged: {
    addListener(
      listener: (changes: Record<string, unknown>, areaName: string) => void
    ): void;
  };
  local?: {
    get(keys?: string[] | string | Record<string, unknown>): Promise<unknown>;
    set(values: Record<string, unknown>): Promise<void>;
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
  permissions?: PermissionsApi;
  contextMenus?: ContextMenusApi;
}

export type MessageRuntimeApi = Pick<RuntimeApi, "sendMessage"> &
  Partial<Pick<RuntimeApi, "onMessage">>;
export type PopupRuntimeApi = Pick<
  RuntimeApi,
  "sendMessage" | "openOptionsPage"
> &
  Partial<Pick<RuntimeApi, "onMessage">>;
export type OffscreenRuntimeApi = Pick<RuntimeApi, "onMessage">;
export interface OptionsPermissionsApi extends PermissionsApi {
  remove(options: { origins: string[] }): Promise<boolean>;
}
export interface OptionsChromeApi {
  permissions: OptionsPermissionsApi;
  runtime: MessageRuntimeApi;
}

type RawChromeApi = ChromeApi;

function getGlobalChrome(): RawChromeApi {
  return (globalThis as typeof globalThis & { chrome: RawChromeApi }).chrome;
}

export function createChromeApi(
  rawChrome: RawChromeApi = getGlobalChrome()
): ChromeApi {
  return {
    runtime: rawChrome.runtime,
    debugger: rawChrome.debugger,
    tabs: rawChrome.tabs,
    storage: rawChrome.storage,
    offscreen: rawChrome.offscreen,
    alarms: rawChrome.alarms,
    permissions: rawChrome.permissions,
    contextMenus: rawChrome.contextMenus
  };
}

export function createMessageRuntimeApi(
  rawChrome: RawChromeApi = getGlobalChrome()
): MessageRuntimeApi {
  return createChromeApi(rawChrome).runtime;
}

export function createPopupRuntimeApi(
  rawChrome: RawChromeApi = getGlobalChrome()
): PopupRuntimeApi {
  return createChromeApi(rawChrome).runtime;
}

export function createOffscreenRuntimeApi(
  rawChrome: RawChromeApi = getGlobalChrome()
): OffscreenRuntimeApi {
  return createChromeApi(rawChrome).runtime;
}

export function createOptionsChromeApi(
  rawChrome: RawChromeApi = getGlobalChrome()
): OptionsChromeApi {
  const chromeApi = createChromeApi(rawChrome);

  return {
    runtime: chromeApi.runtime,
    permissions: chromeApi.permissions as OptionsPermissionsApi
  };
}
