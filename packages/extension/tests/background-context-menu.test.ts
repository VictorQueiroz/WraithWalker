import { describe, expect, it, vi } from "vitest";

import {
  createBackgroundContextMenu,
  UNWHITELIST_SITE_MENU_TITLE,
  WHITELIST_SITE_MENU_ID,
  WHITELIST_SITE_MENU_TITLE
} from "../src/lib/background-context-menu.js";
import { createTestChromeApi } from "./helpers/chrome-api-test-helpers.js";

function createAuthorityStub({
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
    readConfiguredSiteConfigsForAuthority,
    writeConfiguredSiteConfigsForAuthority
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function createContextMenuHarness({
  chromeApi = createTestChromeApi(),
  authority = createAuthorityStub(),
  enabledOrigins = [],
  isAuthorityReady = true,
  setLastError = vi.fn()
}: {
  chromeApi?: ReturnType<typeof createTestChromeApi>;
  authority?: ReturnType<typeof createAuthorityStub>;
  enabledOrigins?: string[];
  isAuthorityReady?: boolean;
  setLastError?: ReturnType<typeof vi.fn>;
} = {}) {
  const contextMenu = createBackgroundContextMenu({
    chromeApi,
    authority,
    getEnabledOrigins: () => enabledOrigins,
    isAuthorityReady: () => isAuthorityReady,
    setLastError
  });

  return { chromeApi, authority, contextMenu, setLastError };
}

describe("background context menu", () => {
  it("registers the website whitelist menu for web pages", async () => {
    const { chromeApi, contextMenu } = createContextMenuHarness();

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
    const { contextMenu } = createContextMenuHarness({
      chromeApi: {
        ...chromeApi,
        contextMenus: undefined
      } as any
    });

    await expect(contextMenu.registerContextMenus()).resolves.toBeUndefined();
    expect(chromeApi.contextMenus.removeAll).not.toHaveBeenCalled();
    expect(chromeApi.contextMenus.create).not.toHaveBeenCalled();
  });

  it("shows the remove-from-whitelist label for the active tab origin", async () => {
    const { chromeApi, contextMenu } = createContextMenuHarness({
      chromeApi: createTestChromeApi({
        tabs: {
          query: vi.fn().mockResolvedValue([
            {
              id: 4,
              active: true,
              url: "https://docs.example.com/dashboard"
            }
          ])
        }
      }),
      authority: createAuthorityStub({
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
      })
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
    const authority = createAuthorityStub();
    const { chromeApi, contextMenu } = createContextMenuHarness({
      chromeApi: createTestChromeApi({
        contextMenus: {
          create: vi.fn(),
          update: undefined as any,
          removeAll: vi.fn().mockResolvedValue(undefined),
          onClicked: {
            listeners: [],
            addListener: vi.fn()
          }
        }
      }),
      authority
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
    const { chromeApi, contextMenu } = createContextMenuHarness();

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
    const setLastError = vi.fn();
    const { chromeApi, contextMenu } = createContextMenuHarness({
      authority: createAuthorityStub({
        readConfiguredSiteConfigsForAuthority: vi.fn().mockResolvedValue({
          ok: false,
          error: "Config read failed."
        })
      }),
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
    const { chromeApi, authority, contextMenu, setLastError } =
      createContextMenuHarness();

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

  it("treats a stale whitelist click for an already-enabled origin as a no-op sync", async () => {
    const { chromeApi, authority, contextMenu, setLastError } =
      createContextMenuHarness({
        authority: createAuthorityStub({
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
        })
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

    expect(chromeApi.permissions.request).toHaveBeenCalledWith({
      origins: ["https://docs.example.com/*"]
    });
    expect(
      authority.writeConfiguredSiteConfigsForAuthority
    ).not.toHaveBeenCalled();
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
    const { authority, contextMenu, setLastError } = createContextMenuHarness({
      chromeApi: createTestChromeApi({
        contextMenus: {
          create: vi.fn(),
          update: undefined as any,
          removeAll: vi.fn().mockResolvedValue(undefined),
          onClicked: {
            addListener: vi.fn()
          } as any
        }
      })
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
    const { chromeApi, authority, contextMenu, setLastError } =
      createContextMenuHarness();

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

    expect(chromeApi.permissions.request).not.toHaveBeenCalled();
    expect(
      authority.readConfiguredSiteConfigsForAuthority
    ).not.toHaveBeenCalled();
    expect(setLastError).not.toHaveBeenCalled();
  });

  it("falls back past invalid URL candidates to a later web origin", async () => {
    const { chromeApi, contextMenu, setLastError } = createContextMenuHarness();

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

    expect(chromeApi.permissions.request).toHaveBeenCalledWith({
      origins: ["https://docs.example.com/*"]
    });
    expect(setLastError).toHaveBeenLastCalledWith("");
  });

  it("removes the site from the whitelist when it is already configured", async () => {
    const { chromeApi, authority, contextMenu, setLastError } =
      createContextMenuHarness({
        authority: createAuthorityStub({
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
        }),
        enabledOrigins: ["https://docs.example.com"]
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
    const { authority, contextMenu, setLastError } = createContextMenuHarness({
      chromeApi,
      authority: createAuthorityStub({
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
      }),
      enabledOrigins: ["https://docs.example.com"]
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
    expect(setLastError).toHaveBeenLastCalledWith("");
  });

  it("keeps unwhitelisting successful when host permission removal returns false", async () => {
    const chromeApi = createTestChromeApi();
    chromeApi.permissions.remove!.mockResolvedValue(false);
    const { authority, contextMenu, setLastError } = createContextMenuHarness({
      chromeApi,
      authority: createAuthorityStub({
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
      }),
      enabledOrigins: ["https://docs.example.com"]
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
    const { chromeApi, authority, contextMenu, setLastError } =
      createContextMenuHarness({
        authority: createAuthorityStub({
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
        }),
        enabledOrigins: ["https://docs.example.com"]
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
    expect(setLastError).toHaveBeenLastCalledWith("Config write failed.");
  });

  it("surfaces root setup guidance before requesting permissions when no authority is ready", async () => {
    const { chromeApi, authority, contextMenu, setLastError } =
      createContextMenuHarness({
        isAuthorityReady: false
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
    expect(setLastError).toHaveBeenLastCalledWith(
      "Open WraithWalker Settings and choose Root Directory, or connect the local WraithWalker server, before whitelisting websites."
    );
  });

  it("surfaces host permission denials", async () => {
    const chromeApi = createTestChromeApi();
    chromeApi.permissions.request.mockResolvedValue(false);
    const { authority, contextMenu, setLastError } = createContextMenuHarness({
      chromeApi
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
    ).not.toHaveBeenCalled();
    expect(
      authority.writeConfiguredSiteConfigsForAuthority
    ).not.toHaveBeenCalled();
    expect(setLastError).toHaveBeenLastCalledWith(
      "Host access was not granted for https://docs.example.com/*."
    );
  });

  it("requests host permission before reading configs so the click keeps its user gesture", async () => {
    const callOrder: string[] = [];
    const readDeferred = createDeferred<{
      ok: true;
      siteConfigs: [];
      sentinel: { rootId: string };
    }>();
    const authority = createAuthorityStub({
      readConfiguredSiteConfigsForAuthority: vi.fn(() => {
        callOrder.push("read");
        return readDeferred.promise;
      })
    });
    const chromeApi = createTestChromeApi();
    chromeApi.permissions.request.mockImplementation(async () => {
      callOrder.push("request");
      return true;
    });
    const { contextMenu } = createContextMenuHarness({
      chromeApi,
      authority
    });

    const pending = contextMenu.handleContextMenuClicked(
      {
        menuItemId: WHITELIST_SITE_MENU_ID,
        pageUrl: "https://docs.example.com/page"
      },
      {
        id: 10,
        url: "https://docs.example.com/dashboard"
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chromeApi.permissions.request).toHaveBeenCalledWith({
      origins: ["https://docs.example.com/*"]
    });
    expect(callOrder).toEqual(["request", "read"]);
    expect(
      authority.writeConfiguredSiteConfigsForAuthority
    ).not.toHaveBeenCalled();

    readDeferred.resolve({
      ok: true,
      siteConfigs: [],
      sentinel: { rootId: "root-1" }
    });
    await pending;
  });

  it("surfaces user-gesture permission request failures without writing config", async () => {
    const chromeApi = createTestChromeApi();
    chromeApi.permissions.request.mockRejectedValue(
      "This must be executed after a user gesture."
    );
    const { authority, contextMenu, setLastError } = createContextMenuHarness({
      chromeApi
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
    ).not.toHaveBeenCalled();
    expect(
      authority.writeConfiguredSiteConfigsForAuthority
    ).not.toHaveBeenCalled();
    expect(setLastError).toHaveBeenLastCalledWith(
      "This must be executed after a user gesture."
    );
  });

  it("surfaces configured-site read failures after permission grant", async () => {
    const { authority, contextMenu, setLastError } = createContextMenuHarness({
      authority: createAuthorityStub({
        readConfiguredSiteConfigsForAuthority: vi.fn().mockResolvedValue({
          ok: false,
          error: "Config read failed."
        })
      })
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
    const { authority, contextMenu, setLastError } = createContextMenuHarness({
      authority: createAuthorityStub({
        writeConfiguredSiteConfigsForAuthority: vi.fn().mockResolvedValue({
          ok: false,
          error: "Config write failed."
        })
      })
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
    const { chromeApi, authority, contextMenu, setLastError } =
      createContextMenuHarness();

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

    expect(chromeApi.permissions.request).not.toHaveBeenCalled();
    expect(
      authority.writeConfiguredSiteConfigsForAuthority
    ).not.toHaveBeenCalled();
    expect(setLastError).toHaveBeenLastCalledWith(
      "Only http and https origins are supported."
    );
  });
});
