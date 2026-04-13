import { describe, expect, it, vi } from "vitest";

import {
  createBackgroundContextMenu,
  WHITELIST_SITE_MENU_ID
} from "../src/lib/background-context-menu.js";
import { createChromeApi } from "./helpers/background-service-test-helpers.js";

function createAuthorityStub({
  ensureRootReady = vi.fn().mockResolvedValue({
    ok: true,
    sentinel: { rootId: "root-1" },
    permission: "granted"
  }),
  readConfiguredSiteConfigsForAuthority = vi.fn().mockResolvedValue({
    ok: true,
    siteConfigs: [],
    sentinel: { rootId: "root-1" }
  }),
  writeConfiguredSiteConfigsForAuthority = vi.fn().mockImplementation(async (siteConfigs) => ({
    ok: true,
    siteConfigs,
    sentinel: { rootId: "root-1" }
  }))
} = {}) {
  return {
    ensureRootReady,
    readConfiguredSiteConfigsForAuthority,
    writeConfiguredSiteConfigsForAuthority
  };
}

describe("background context menu", () => {
  it("registers the website whitelist menu for web pages", async () => {
    const chromeApi = createChromeApi();
    const authority = createAuthorityStub();
    const contextMenu = createBackgroundContextMenu({
      chromeApi,
      authority,
      setLastError: vi.fn()
    });

    await contextMenu.registerContextMenus();

    expect(chromeApi.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    expect(chromeApi.contextMenus.create).toHaveBeenCalledWith({
      id: WHITELIST_SITE_MENU_ID,
      title: "Whitelist this website",
      contexts: ["all"],
      documentUrlPatterns: ["http://*/*", "https://*/*"]
    });
  });

  it("whitelists the clicked website and requests the matching host permission", async () => {
    const chromeApi = createChromeApi();
    const authority = createAuthorityStub();
    const setLastError = vi.fn();
    const contextMenu = createBackgroundContextMenu({
      chromeApi,
      authority,
      setLastError
    });

    await contextMenu.handleContextMenuClicked(
      {
        menuItemId: WHITELIST_SITE_MENU_ID,
        pageUrl: "https://docs.example.com/page"
      },
      {
        id: 4,
        url: "https://docs.example.com/dashboard"
      }
    );

    expect(authority.ensureRootReady).toHaveBeenCalledWith({ requestPermission: true });
    expect(chromeApi.permissions.request).toHaveBeenCalledWith({
      origins: ["https://docs.example.com/*"]
    });
    expect(authority.writeConfiguredSiteConfigsForAuthority).toHaveBeenCalledWith([
      expect.objectContaining({
        origin: "https://docs.example.com",
        dumpAllowlistPatterns: ["\\.m?(js|ts)x?$", "\\.css$", "\\.wasm$", "\\.json$"]
      })
    ]);
    expect(setLastError).toHaveBeenLastCalledWith("");
  });

  it("skips writes when the site is already explicitly configured", async () => {
    const chromeApi = createChromeApi();
    const authority = createAuthorityStub({
      readConfiguredSiteConfigsForAuthority: vi.fn().mockResolvedValue({
        ok: true,
        siteConfigs: [{
          origin: "https://docs.example.com",
          createdAt: "2026-04-10T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }],
        sentinel: { rootId: "root-1" }
      })
    });
    const setLastError = vi.fn();
    const contextMenu = createBackgroundContextMenu({
      chromeApi,
      authority,
      setLastError
    });

    await contextMenu.handleContextMenuClicked(
      {
        menuItemId: WHITELIST_SITE_MENU_ID,
        pageUrl: "https://docs.example.com/page"
      },
      {
        id: 7,
        url: "https://docs.example.com/dashboard"
      }
    );

    expect(chromeApi.permissions.request).toHaveBeenCalledWith({
      origins: ["https://docs.example.com/*"]
    });
    expect(authority.writeConfiguredSiteConfigsForAuthority).not.toHaveBeenCalled();
    expect(setLastError).toHaveBeenLastCalledWith("");
  });

  it("rejects unsupported URLs without attempting permissions or config writes", async () => {
    const chromeApi = createChromeApi();
    const authority = createAuthorityStub();
    const setLastError = vi.fn();
    const contextMenu = createBackgroundContextMenu({
      chromeApi,
      authority,
      setLastError
    });

    await contextMenu.handleContextMenuClicked(
      {
        menuItemId: WHITELIST_SITE_MENU_ID,
        pageUrl: "chrome://settings"
      },
      {
        id: 8,
        url: "chrome://settings"
      }
    );

    expect(authority.ensureRootReady).not.toHaveBeenCalled();
    expect(chromeApi.permissions.request).not.toHaveBeenCalled();
    expect(authority.writeConfiguredSiteConfigsForAuthority).not.toHaveBeenCalled();
    expect(setLastError).toHaveBeenLastCalledWith("Only http and https origins are supported.");
  });
});
