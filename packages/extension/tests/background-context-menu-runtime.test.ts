import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_NATIVE_HOST_CONFIG } from "../src/lib/constants.js";
import {
  UNWHITELIST_SITE_MENU_TITLE,
  WHITELIST_SITE_MENU_ID,
  WHITELIST_SITE_MENU_TITLE
} from "../src/lib/background-context-menu.js";
import { installTestChromeApi } from "./helpers/chrome-api-test-helpers.js";

function createSiteConfig(origin: string) {
  return {
    origin,
    createdAt: "2026-04-10T00:00:00.000Z",
    dumpAllowlistPatterns: ["\\.js$"]
  };
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadBackgroundModule() {
  vi.resetModules();
  globalThis.__WRAITHWALKER_TEST__ = true;
  return import("../src/background.ts");
}

function cloneSiteConfigs(
  siteConfigs: Array<{
    origin: string;
    createdAt: string;
    dumpAllowlistPatterns: string[];
  }>
) {
  return siteConfigs.map((siteConfig) => ({
    ...siteConfig,
    dumpAllowlistPatterns: [...siteConfig.dumpAllowlistPatterns]
  }));
}

function installLocalRootChromeApi({
  activeTabUrl,
  configuredSiteConfigs = [],
  sendMessageOverride
}: {
  activeTabUrl: string;
  configuredSiteConfigs?: Array<{
    origin: string;
    createdAt: string;
    dumpAllowlistPatterns: string[];
  }>;
  sendMessageOverride?: (
    message: { type?: string; payload?: Record<string, unknown> },
    helpers: {
      getConfiguredSiteConfigs: () => ReturnType<typeof cloneSiteConfigs>;
      setConfiguredSiteConfigs: (
        siteConfigs: ReturnType<typeof cloneSiteConfigs>
      ) => void;
    }
  ) => Promise<unknown> | unknown;
}) {
  const chromeApi = installTestChromeApi({
    tabs: {
      query: vi.fn().mockResolvedValue([
        {
          id: 12,
          active: true,
          url: activeTabUrl
        }
      ])
    }
  });
  chromeApi.runtime.getContexts.mockResolvedValue([{}]);

  let localConfiguredSiteConfigs = cloneSiteConfigs(configuredSiteConfigs);

  chromeApi.runtime.sendMessage.mockImplementation(
    async (message: { type?: string; payload?: Record<string, unknown> }) => {
      const helpers = {
        getConfiguredSiteConfigs: () =>
          cloneSiteConfigs(localConfiguredSiteConfigs),
        setConfiguredSiteConfigs: (
          siteConfigs: ReturnType<typeof cloneSiteConfigs>
        ) => {
          localConfiguredSiteConfigs = cloneSiteConfigs(siteConfigs);
        }
      };

      if (sendMessageOverride) {
        const overrideResult = await sendMessageOverride(message, helpers);
        if (overrideResult !== undefined) {
          return overrideResult;
        }
      }

      switch (message?.type) {
        case "fs.ensureRoot":
          return {
            ok: true,
            sentinel: { rootId: "local-root" },
            permission: "granted"
          };
        case "fs.readConfiguredSiteConfigs":
          return {
            ok: true,
            siteConfigs: helpers.getConfiguredSiteConfigs(),
            sentinel: { rootId: "local-root" }
          };
        case "fs.writeConfiguredSiteConfigs": {
          const nextSiteConfigs = cloneSiteConfigs(
            ((message.payload?.siteConfigs as typeof configuredSiteConfigs) ??
              []) as typeof configuredSiteConfigs
          );
          helpers.setConfiguredSiteConfigs(nextSiteConfigs);
          return {
            ok: true,
            siteConfigs: helpers.getConfiguredSiteConfigs(),
            sentinel: { rootId: "local-root" }
          };
        }
        default:
          return { ok: true };
      }
    }
  );

  return {
    chromeApi,
    getConfiguredSiteConfigs: () => cloneSiteConfigs(localConfiguredSiteConfigs)
  };
}

async function createLocalRuntime(
  options: Parameters<typeof installLocalRootChromeApi>[0]
) {
  const { createBackgroundRuntime } = await loadBackgroundModule();
  const { chromeApi, getConfiguredSiteConfigs } =
    installLocalRootChromeApi(options);
  const runtime = createBackgroundRuntime({
    chromeApi,
    getSiteConfigs: vi.fn().mockResolvedValue([]),
    getNativeHostConfig: vi.fn().mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
    setLastSessionSnapshot: vi.fn(),
    createSessionController: vi.fn(() => ({
      startSession: vi.fn().mockResolvedValue(undefined),
      stopSession: vi.fn().mockResolvedValue(undefined),
      reconcileTabs: vi.fn().mockResolvedValue(undefined),
      handleTabStateChange: vi.fn().mockResolvedValue(undefined)
    })),
    createRequestLifecycle: vi.fn(() => ({
      handleFetchRequestPaused: vi.fn(),
      handleNetworkRequestWillBeSent: vi.fn(),
      handleNetworkResponseReceived: vi.fn(),
      handleNetworkLoadingFinished: vi.fn(),
      handleNetworkLoadingFailed: vi.fn()
    }))
  });

  await runtime.start();

  return { runtime, chromeApi, getConfiguredSiteConfigs };
}

afterEach(() => {
  delete globalThis.__WRAITHWALKER_TEST__;
  delete globalThis.chrome;
  vi.restoreAllMocks();
});

describe("background context menu runtime", () => {
  it("uses local configured site configs for the menu when the server is unavailable", async () => {
    const { chromeApi } = await createLocalRuntime({
      activeTabUrl: "https://docs.example.com/dashboard",
      configuredSiteConfigs: [createSiteConfig("https://docs.example.com")]
    });

    expect(chromeApi.contextMenus.update).toHaveBeenCalledWith(
      WHITELIST_SITE_MENU_ID,
      {
        title: UNWHITELIST_SITE_MENU_TITLE,
        enabled: true
      }
    );
  });

  it("adds the current site through the local fallback path and flips the menu label", async () => {
    const { chromeApi, getConfiguredSiteConfigs } = await createLocalRuntime({
      activeTabUrl: "https://docs.example.com/dashboard"
    });

    chromeApi.contextMenus.onClicked.listeners[0](
      {
        menuItemId: WHITELIST_SITE_MENU_ID,
        pageUrl: "https://docs.example.com/page"
      },
      {
        id: 12,
        url: "https://docs.example.com/dashboard"
      }
    );
    await flushPromises();

    expect(chromeApi.permissions.request).toHaveBeenCalledWith({
      origins: ["https://docs.example.com/*"]
    });
    expect(getConfiguredSiteConfigs()).toEqual([
      expect.objectContaining({
        origin: "https://docs.example.com"
      })
    ]);
    expect(chromeApi.contextMenus.update).toHaveBeenLastCalledWith(
      WHITELIST_SITE_MENU_ID,
      {
        title: UNWHITELIST_SITE_MENU_TITLE,
        enabled: true
      }
    );
  });

  it("removes the current site through the local fallback path and flips the menu label back", async () => {
    const { chromeApi, getConfiguredSiteConfigs } = await createLocalRuntime({
      activeTabUrl: "https://docs.example.com/dashboard",
      configuredSiteConfigs: [createSiteConfig("https://docs.example.com")]
    });

    chromeApi.contextMenus.onClicked.listeners[0](
      {
        menuItemId: WHITELIST_SITE_MENU_ID,
        pageUrl: "https://docs.example.com/page"
      },
      {
        id: 12,
        url: "https://docs.example.com/dashboard"
      }
    );
    await flushPromises();

    expect(chromeApi.permissions.request).not.toHaveBeenCalled();
    expect(chromeApi.permissions.remove).toHaveBeenCalledWith({
      origins: ["https://docs.example.com/*"]
    });
    expect(getConfiguredSiteConfigs()).toEqual([]);
    expect(chromeApi.contextMenus.update).toHaveBeenLastCalledWith(
      WHITELIST_SITE_MENU_ID,
      {
        title: WHITELIST_SITE_MENU_TITLE,
        enabled: true
      }
    );
  });

  it("refreshes the menu for the active tab when the activated-tab listener fires", async () => {
    const { chromeApi } = await createLocalRuntime({
      activeTabUrl: "https://docs.example.com/dashboard",
      configuredSiteConfigs: [createSiteConfig("https://docs.example.com")]
    });

    chromeApi.tabs.query.mockClear();
    chromeApi.contextMenus.update.mockClear();

    chromeApi.tabs.onActivated.listeners[0]({ tabId: 12, windowId: 1 });
    await flushPromises();

    expect(chromeApi.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true
    });
    expect(chromeApi.contextMenus.update).toHaveBeenCalledWith(
      WHITELIST_SITE_MENU_ID,
      {
        title: UNWHITELIST_SITE_MENU_TITLE,
        enabled: true
      }
    );
  });

  it("refreshes the menu only for active tab updates", async () => {
    const { chromeApi } = await createLocalRuntime({
      activeTabUrl: "https://docs.example.com/dashboard",
      configuredSiteConfigs: [createSiteConfig("https://docs.example.com")]
    });

    chromeApi.contextMenus.update.mockClear();

    chromeApi.tabs.onUpdated.listeners[0](
      12,
      {},
      { id: 12, active: false, url: "https://docs.example.com/dashboard" }
    );
    await flushPromises();

    expect(chromeApi.contextMenus.update).not.toHaveBeenCalled();

    chromeApi.tabs.onUpdated.listeners[0](
      12,
      {},
      { id: 12, active: true, url: "https://docs.example.com/dashboard" }
    );
    await flushPromises();

    expect(chromeApi.contextMenus.update).toHaveBeenCalledWith(
      WHITELIST_SITE_MENU_ID,
      {
        title: UNWHITELIST_SITE_MENU_TITLE,
        enabled: true
      }
    );
  });

  it("captures thrown context menu handler errors into lastError", async () => {
    const { runtime, chromeApi } = await createLocalRuntime({
      activeTabUrl: "https://docs.example.com/dashboard"
    });

    chromeApi.permissions.request.mockRejectedValue("permission exploded");

    chromeApi.contextMenus.onClicked.listeners[0](
      {
        menuItemId: WHITELIST_SITE_MENU_ID,
        pageUrl: "https://docs.example.com/page"
      },
      {
        id: 12,
        url: "https://docs.example.com/dashboard"
      }
    );
    await flushPromises();

    expect(runtime.state.lastError).toBe("permission exploded");
  });

  it("records register-context-menu startup failures in lastError", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = installTestChromeApi();
    chromeApi.contextMenus!.removeAll.mockRejectedValue(
      new Error("Menu registration failed.")
    );

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn().mockResolvedValue(undefined),
        stopSession: vi.fn().mockResolvedValue(undefined),
        reconcileTabs: vi.fn().mockResolvedValue(undefined),
        handleTabStateChange: vi.fn().mockResolvedValue(undefined)
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await expect(runtime.start()).resolves.toBeUndefined();

    expect(runtime.state.lastError).toBe("Menu registration failed.");
  });

  it("records refresh-context-menu startup failures in lastError", async () => {
    const { createBackgroundRuntime } = await loadBackgroundModule();
    const chromeApi = installTestChromeApi({
      tabs: {
        query: vi.fn().mockRejectedValue(new Error("Menu refresh failed."))
      }
    });

    const runtime = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(DEFAULT_NATIVE_HOST_CONFIG),
      setLastSessionSnapshot: vi.fn(),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn().mockResolvedValue(undefined),
        stopSession: vi.fn().mockResolvedValue(undefined),
        reconcileTabs: vi.fn().mockResolvedValue(undefined),
        handleTabStateChange: vi.fn().mockResolvedValue(undefined)
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    await expect(runtime.start()).resolves.toBeUndefined();

    expect(runtime.state.lastError).toBe("Menu refresh failed.");
  });
});
