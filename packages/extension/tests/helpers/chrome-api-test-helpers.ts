import { vi } from "vitest";

import type { ChromeApi } from "../../src/lib/chrome-api.js";

function createEvent<T extends (...args: any[]) => unknown>() {
  const listeners: T[] = [];

  return {
    listeners,
    addListener: vi.fn((listener: T) => {
      listeners.push(listener);
    })
  };
}

export type TestChromeApi = ChromeApi & {
  runtime: ChromeApi["runtime"] & {
    getURL: ReturnType<typeof vi.fn>;
    getManifest: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    sendNativeMessage: ReturnType<typeof vi.fn>;
    openOptionsPage: ReturnType<typeof vi.fn>;
    getContexts: ReturnType<typeof vi.fn>;
  };
  debugger: ChromeApi["debugger"] & {
    attach: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
  };
  tabs: ChromeApi["tabs"] & {
    query: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  storage: NonNullable<ChromeApi["storage"]> & {
    local: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
    };
  };
  offscreen: ChromeApi["offscreen"] & {
    createDocument: ReturnType<typeof vi.fn>;
    closeDocument: ReturnType<typeof vi.fn>;
  };
  alarms?: NonNullable<ChromeApi["alarms"]> & {
    create: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  permissions?: NonNullable<ChromeApi["permissions"]> & {
    request: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  contextMenus?: NonNullable<ChromeApi["contextMenus"]> & {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    removeAll: ReturnType<typeof vi.fn>;
  };
};

export interface TestChromeApiOverrides {
  runtime?: Partial<TestChromeApi["runtime"]>;
  debugger?: Partial<TestChromeApi["debugger"]>;
  tabs?: Partial<TestChromeApi["tabs"]>;
  storage?: Partial<TestChromeApi["storage"]>;
  offscreen?: Partial<TestChromeApi["offscreen"]>;
  alarms?: Partial<NonNullable<TestChromeApi["alarms"]>>;
  permissions?: Partial<NonNullable<TestChromeApi["permissions"]>>;
  contextMenus?: Partial<NonNullable<TestChromeApi["contextMenus"]>>;
}

function hasOwn<
  TObject extends object,
  TKey extends keyof TObject & PropertyKey
>(value: TObject, key: TKey): value is TObject & Required<Pick<TObject, TKey>> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function createTestChromeApi(
  overrides: TestChromeApiOverrides = {}
): TestChromeApi {
  const defaults: TestChromeApi = {
    runtime: {
      getURL: vi.fn((path) => path),
      getManifest: vi.fn(() => ({ version: "0.1.0" })),
      sendMessage: vi.fn(),
      sendNativeMessage: vi.fn(),
      openOptionsPage: vi.fn(),
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
      create: vi.fn().mockResolvedValue({ id: 99 }),
      onActivated: createEvent(),
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
    },
    alarms: {
      create: vi.fn(),
      clear: vi.fn().mockResolvedValue(true),
      onAlarm: createEvent()
    },
    permissions: {
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true)
    },
    contextMenus: {
      create: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
      removeAll: vi.fn().mockResolvedValue(undefined),
      onClicked: createEvent()
    }
  };

  const chromeApi: TestChromeApi = {
    ...defaults,
    runtime: { ...defaults.runtime, ...overrides.runtime },
    debugger: { ...defaults.debugger, ...overrides.debugger },
    tabs: { ...defaults.tabs, ...overrides.tabs },
    storage: {
      ...defaults.storage,
      ...overrides.storage,
      local: {
        ...defaults.storage.local,
        ...overrides.storage?.local
      }
    },
    offscreen: { ...defaults.offscreen, ...overrides.offscreen }
  };

  chromeApi.alarms = hasOwn(overrides, "alarms")
    ? overrides.alarms
      ? { ...defaults.alarms!, ...overrides.alarms }
      : undefined
    : defaults.alarms;
  chromeApi.permissions = hasOwn(overrides, "permissions")
    ? overrides.permissions
      ? { ...defaults.permissions!, ...overrides.permissions }
      : undefined
    : defaults.permissions;
  chromeApi.contextMenus = hasOwn(overrides, "contextMenus")
    ? overrides.contextMenus
      ? { ...defaults.contextMenus!, ...overrides.contextMenus }
      : undefined
    : defaults.contextMenus;

  return chromeApi;
}

export function installTestChromeApi(
  overrides: TestChromeApiOverrides = {}
): TestChromeApi {
  const chromeApi = createTestChromeApi(overrides);

  (globalThis as typeof globalThis & { chrome: TestChromeApi }).chrome =
    chromeApi;

  return chromeApi;
}
