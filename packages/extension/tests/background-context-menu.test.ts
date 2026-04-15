import { describe, expect, it, vi } from "vitest";

import {
  createBackgroundContextMenu,
  UNWHITELIST_SITE_MENU_TITLE,
  WHITELIST_SITE_MENU_ID,
  WHITELIST_SITE_MENU_TITLE
} from "../src/lib/background-context-menu.js";
import { createTestChromeApi } from "./helpers/chrome-api-test-helpers.js";

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
  writeConfiguredSiteConfigsForAuthority = vi
    .fn()
    .mockImplementation(async (siteConfigs) => ({
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
    const chromeApi = createTestChromeApi();
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
      title: WHITELIST_SITE_MENU_TITLE,
      contexts: ["all"],
      documentUrlPatterns: ["http://*/*", "https://*/*"]
    });
  });

  it("skips menu registration when context menus are unavailable", async () => {
    const chromeApi = createTestChromeApi();
    const authority = createAuthorityStub();
    const contextMenu = createBackgroundContextMenu({
      chromeApi: {
        ...chromeApi,
        contextMenus: undefined
      } as any,
      authority,
      setLastError: vi.fn()
    });

    await expect(contextMenu.registerContextMenus()).resolves.toBeUndefined();
    expect(chromeApi.contextMenus.removeAll).not.toHaveBeenCalled();
    expect(chromeApi.contextMenus.create).not.toHaveBeenCalled();
  });

  it("shows the remove-from-whitelist label for the active tab origin", async () => {
    const chromeApi = createTestChromeApi({
      tabs: {
        query: vi.fn().mockResolvedValue([
          {
            id: 4,
            active: true,
            url: "https://docs.example.com/dashboard"
          }
        ])
      }
    });
    const authority = createAuthorityStub({
      readConfiguredSiteConfigsForAuthority: vi.fn().mockResolvedValue({
        ok: true,
        siteConfigs: [
          {
            origin: "https://docs.example.com",
            createdAt: "2026-04-10T00:00:00.000Z"
          }
        ],
        sentinel: { rootId: "root-1" }
      })
    });
    const contextMenu = createBackgroundContextMenu({
      chromeApi,
      authority,
      setLastError: vi.fn()
    });

    await contextMenu.refreshContextMenuForActiveTab();

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

  it("skips passive refresh work when menu updates are unavailable", async () => {
    const chromeApi = createTestChromeApi({
      contextMenus: {
        create: vi.fn(),
        update: undefined as any,
        removeAll: vi.fn().mockResolvedValue(undefined),
        onClicked: {
          listeners: [],
          addListener: vi.fn()
        }
      }
    });
    const authority = createAuthorityStub();
    const contextMenu = createBackgroundContextMenu({
      chromeApi,
      authority,
      setLastError: vi.fn()
    });

    await expect(
      contextMenu.refreshContextMenuForTab({
        id: 4,
        active: true,
        url: "https://docs.example.com/dashboard"
      })
    ).resolves.toBeUndefined();
    await expect(
      contextMenu.refreshContextMenuForActiveTab()
    ).resolves.toBeUndefined();

    expect(
      authority.readConfiguredSiteConfigsForAuthority
    ).not.toHaveBeenCalled();
    expect(chromeApi.tabs.query).not.toHaveBeenCalled();
  });

  it("keeps the whitelist action available when the active origin is not configured", async () => {
    const chromeApi = createTestChromeApi();
    const authority = createAuthorityStub();
    const contextMenu = createBackgroundContextMenu({
      chromeApi,
      authority,
      setLastError: vi.fn()
    });

    await contextMenu.refreshContextMenuForTab({
      id: 4,
      active: true,
      url: "https://docs.example.com/dashboard"
    });

    expect(chromeApi.contextMenus.update).toHaveBeenCalledWith(
      WHITELIST_SITE_MENU_ID,
      {
        title: WHITELIST_SITE_MENU_TITLE,
        enabled: true
      }
    );
  });

  it("falls back to the whitelist action when passive state refresh cannot read configs", async () => {
    const chromeApi = createTestChromeApi();
    const setLastError = vi.fn();
    const authority = createAuthorityStub({
      readConfiguredSiteConfigsForAuthority: vi.fn().mockResolvedValue({
        ok: false,
        error: "Config read failed."
      })
    });
    const contextMenu = createBackgroundContextMenu({
      chromeApi,
      authority,
      setLastError
    });

    await contextMenu.refreshContextMenuForTab({
      id: 4,
      active: true,
      url: "https://docs.example.com/dashboard"
    });

    expect(chromeApi.contextMenus.update).toHaveBeenCalledWith(
      WHITELIST_SITE_MENU_ID,
      {
        title: WHITELIST_SITE_MENU_TITLE,
        enabled: true
      }
    );
    expect(setLastError).not.toHaveBeenCalled();
  });

  it("whitelists the clicked website and requests the matching host permission", async () => {
    const chromeApi = createTestChromeApi();
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

    expect(authority.ensureRootReady).toHaveBeenCalledWith({
      requestPermission: true
    });
    expect(chromeApi.permissions.request).toHaveBeenCalledWith({
      origins: ["https://docs.example.com/*"]
    });
    expect(
      authority.writeConfiguredSiteConfigsForAuthority
    ).toHaveBeenCalledWith([
      expect.objectContaining({
        origin: "https://docs.example.com",
        dumpAllowlistPatterns: [
          "\\.m?(js|ts)x?$",
          "\\.css$",
          "\\.wasm$",
          "\\.json$"
        ]
      })
    ]);
    expect(chromeApi.contextMenus.update).toHaveBeenLastCalledWith(
      WHITELIST_SITE_MENU_ID,
      {
        title: UNWHITELIST_SITE_MENU_TITLE,
        enabled: true
      }
    );
    expect(setLastError).toHaveBeenLastCalledWith("");
  });

  it("still updates the whitelist when menu updates are unavailable during a click action", async () => {
    const chromeApi = createTestChromeApi({
      contextMenus: {
        create: vi.fn(),
        update: undefined as any,
        removeAll: vi.fn().mockResolvedValue(undefined),
        onClicked: {
          addListener: vi.fn()
        } as any
      }
    });
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

    expect(
      authority.writeConfiguredSiteConfigsForAuthority
    ).toHaveBeenCalledWith([
      expect.objectContaining({
        origin: "https://docs.example.com"
      })
    ]);
    expect(setLastError).toHaveBeenLastCalledWith("");
  });

  it("ignores unrelated context menu clicks", async () => {
    const chromeApi = createTestChromeApi();
    const authority = createAuthorityStub();
    const setLastError = vi.fn();
    const contextMenu = createBackgroundContextMenu({
      chromeApi,
      authority,
      setLastError
    });

    await contextMenu.handleContextMenuClicked(
      {
        menuItemId: "different-menu-item",
        pageUrl: "https://docs.example.com/page"
      },
      {
        id: 4,
        url: "https://docs.example.com/dashboard"
      }
    );

    expect(authority.ensureRootReady).not.toHaveBeenCalled();
    expect(chromeApi.permissions.request).not.toHaveBeenCalled();
    expect(setLastError).not.toHaveBeenCalled();
  });

  it("falls back past invalid URL candidates to a later web origin", async () => {
    const chromeApi = createTestChromeApi();
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
        id: 5,
        url: "not a valid URL"
      }
    );

    expect(authority.ensureRootReady).toHaveBeenCalledWith({
      requestPermission: true
    });
    expect(chromeApi.permissions.request).toHaveBeenCalledWith({
      origins: ["https://docs.example.com/*"]
    });
    expect(setLastError).toHaveBeenLastCalledWith("");
  });

  it("removes the site from the whitelist when it is already configured", async () => {
    const chromeApi = createTestChromeApi();
    const authority = createAuthorityStub({
      readConfiguredSiteConfigsForAuthority: vi.fn().mockResolvedValue({
        ok: true,
        siteConfigs: [
          {
            origin: "https://docs.example.com",
            createdAt: "2026-04-10T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ],
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

    expect(chromeApi.permissions.request).not.toHaveBeenCalled();
    expect(
      authority.writeConfiguredSiteConfigsForAuthority
    ).toHaveBeenCalledWith([]);
    expect(chromeApi.permissions.remove).toHaveBeenCalledWith({
      origins: ["https://docs.example.com/*"]
    });
    expect(chromeApi.contextMenus.update).toHaveBeenLastCalledWith(
      WHITELIST_SITE_MENU_ID,
      {
        title: WHITELIST_SITE_MENU_TITLE,
        enabled: true
      }
    );
    expect(setLastError).toHaveBeenLastCalledWith("");
  });

  it("keeps unwhitelisting successful when host permission removal fails", async () => {
    const chromeApi = createTestChromeApi();
    chromeApi.permissions.remove!.mockRejectedValue(new Error("remove failed"));
    const authority = createAuthorityStub({
      readConfiguredSiteConfigsForAuthority: vi.fn().mockResolvedValue({
        ok: true,
        siteConfigs: [
          {
            origin: "https://docs.example.com",
            createdAt: "2026-04-10T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ],
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
        pageUrl: "https://docs.example.com/path?via=context-menu"
      },
      {
        id: 7,
        url: "https://docs.example.com/dashboard"
      }
    );

    expect(
      authority.writeConfiguredSiteConfigsForAuthority
    ).toHaveBeenCalledWith([]);
    expect(chromeApi.permissions.remove).toHaveBeenCalledWith({
      origins: ["https://docs.example.com/*"]
    });
    expect(chromeApi.contextMenus.update).toHaveBeenLastCalledWith(
      WHITELIST_SITE_MENU_ID,
      {
        title: WHITELIST_SITE_MENU_TITLE,
        enabled: true
      }
    );
    expect(setLastError).toHaveBeenLastCalledWith("");
  });

  it("keeps unwhitelisting successful when host permission removal returns false", async () => {
    const chromeApi = createTestChromeApi();
    chromeApi.permissions.remove!.mockResolvedValue(false);
    const authority = createAuthorityStub({
      readConfiguredSiteConfigsForAuthority: vi.fn().mockResolvedValue({
        ok: true,
        siteConfigs: [
          {
            origin: "https://docs.example.com",
            createdAt: "2026-04-10T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ],
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

    expect(
      authority.writeConfiguredSiteConfigsForAuthority
    ).toHaveBeenCalledWith([]);
    expect(chromeApi.permissions.remove).toHaveBeenCalledWith({
      origins: ["https://docs.example.com/*"]
    });
    expect(setLastError).toHaveBeenLastCalledWith("");
  });

  it("surfaces unwhitelist write failures without removing permissions", async () => {
    const chromeApi = createTestChromeApi();
    const authority = createAuthorityStub({
      readConfiguredSiteConfigsForAuthority: vi.fn().mockResolvedValue({
        ok: true,
        siteConfigs: [
          {
            origin: "https://docs.example.com",
            createdAt: "2026-04-10T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ],
        sentinel: { rootId: "root-1" }
      }),
      writeConfiguredSiteConfigsForAuthority: vi.fn().mockResolvedValue({
        ok: false,
        error: "Config write failed."
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

    expect(chromeApi.permissions.request).not.toHaveBeenCalled();
    expect(chromeApi.permissions.remove).not.toHaveBeenCalled();
    expect(chromeApi.contextMenus.update).not.toHaveBeenCalledWith(
      WHITELIST_SITE_MENU_ID,
      {
        title: WHITELIST_SITE_MENU_TITLE,
        enabled: true
      }
    );
    expect(setLastError).toHaveBeenLastCalledWith("Config write failed.");
  });

  it("surfaces root readiness failures before requesting permissions", async () => {
    const chromeApi = createTestChromeApi();
    const authority = createAuthorityStub({
      ensureRootReady: vi.fn().mockResolvedValue({
        ok: false,
        error: "Root access is unavailable."
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
        id: 9,
        url: "https://docs.example.com/dashboard"
      }
    );

    expect(chromeApi.permissions.request).not.toHaveBeenCalled();
    expect(
      authority.readConfiguredSiteConfigsForAuthority
    ).not.toHaveBeenCalled();
    expect(setLastError).toHaveBeenLastCalledWith(
      "Root access is unavailable."
    );
  });

  it("surfaces a missing-root-directory error before attempting to whitelist", async () => {
    const chromeApi = createTestChromeApi();
    const authority = createAuthorityStub({
      ensureRootReady: vi.fn().mockResolvedValue({
        ok: false,
        error: "No root directory selected."
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
        id: 9,
        url: "https://docs.example.com/dashboard"
      }
    );

    expect(chromeApi.permissions.request).not.toHaveBeenCalled();
    expect(
      authority.readConfiguredSiteConfigsForAuthority
    ).not.toHaveBeenCalled();
    expect(
      authority.writeConfiguredSiteConfigsForAuthority
    ).not.toHaveBeenCalled();
    expect(chromeApi.contextMenus.update).not.toHaveBeenCalledWith(
      WHITELIST_SITE_MENU_ID,
      {
        title: UNWHITELIST_SITE_MENU_TITLE,
        enabled: true
      }
    );
    expect(setLastError).toHaveBeenLastCalledWith(
      "No root directory selected."
    );
  });

  it("surfaces host permission denials", async () => {
    const chromeApi = createTestChromeApi();
    chromeApi.permissions.request.mockResolvedValue(false);
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
        id: 10,
        url: "https://docs.example.com/dashboard"
      }
    );

    expect(
      authority.readConfiguredSiteConfigsForAuthority
    ).toHaveBeenCalledTimes(1);
    expect(
      authority.writeConfiguredSiteConfigsForAuthority
    ).not.toHaveBeenCalled();
    expect(setLastError).toHaveBeenLastCalledWith(
      "Host permission was not granted for https://docs.example.com."
    );
  });

  it("surfaces configured-site read failures after permission grant", async () => {
    const chromeApi = createTestChromeApi();
    const authority = createAuthorityStub({
      readConfiguredSiteConfigsForAuthority: vi.fn().mockResolvedValue({
        ok: false,
        error: "Config read failed."
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
        id: 11,
        url: "https://docs.example.com/dashboard"
      }
    );

    expect(
      authority.writeConfiguredSiteConfigsForAuthority
    ).not.toHaveBeenCalled();
    expect(setLastError).toHaveBeenLastCalledWith("Config read failed.");
  });

  it("surfaces configured-site write failures", async () => {
    const chromeApi = createTestChromeApi();
    const authority = createAuthorityStub({
      writeConfiguredSiteConfigsForAuthority: vi.fn().mockResolvedValue({
        ok: false,
        error: "Config write failed."
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
        id: 12,
        url: "https://docs.example.com/dashboard"
      }
    );

    expect(
      authority.writeConfiguredSiteConfigsForAuthority
    ).toHaveBeenCalledTimes(1);
    expect(setLastError).toHaveBeenLastCalledWith("Config write failed.");
  });

  it("rejects unsupported URLs without attempting permissions or config writes", async () => {
    const chromeApi = createTestChromeApi();
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
    expect(
      authority.writeConfiguredSiteConfigsForAuthority
    ).not.toHaveBeenCalled();
    expect(setLastError).toHaveBeenLastCalledWith(
      "Only http and https origins are supported."
    );
  });
});
