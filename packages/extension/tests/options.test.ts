// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DUMP_ALLOWLIST_PATTERN } from "../src/lib/constants.js";
import type { SiteConfig } from "../src/lib/types.js";

function renderOptionsMarkup() {
  document.body.innerHTML = `
    <form id="site-form">
      <input id="site-origin" />
      <button type="submit">Add</button>
    </form>
    <div id="sites-empty">No enabled origins yet.</div>
    <div id="sites-list"></div>
    <div id="root-status"></div>
    <button id="choose-root" type="button">Choose root</button>
    <button id="reauthorize-root" type="button">Reauthorize</button>
    <pre id="root-meta" class="hidden"></pre>
    <form id="native-form">
      <input id="native-host-name" />
      <input id="native-command-template" />
      <input id="native-root-path" />
      <button type="submit">Save</button>
    </form>
    <button id="verify-helper" type="button">Verify helper</button>
    <div id="native-status"></div>
    <div id="flash" class="hidden"></div>
  `;
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function queryInput(selector: string): HTMLInputElement {
  return document.querySelector(selector) as HTMLInputElement;
}

function querySelect(selector: string): HTMLSelectElement {
  return document.querySelector(selector) as HTMLSelectElement;
}

function withDirectoryPicker(
  showDirectoryPicker: any
): Window {
  const windowRef = window as Window & { showDirectoryPicker?: () => Promise<unknown> };
  windowRef.showDirectoryPicker = showDirectoryPicker;
  return windowRef;
}

function createStoredSite(overrides: Partial<SiteConfig> = {}): SiteConfig {
  return {
    origin: "https://app.example.com",
    createdAt: "2026-04-03T00:00:00.000Z",
    mode: "simple",
    dumpAllowlistPattern: DEFAULT_DUMP_ALLOWLIST_PATTERN,
    ...overrides
  };
}

async function loadOptionsModule() {
  vi.resetModules();
  globalThis.__WRAITHWALKER_TEST__ = true;
  return import("../src/options.ts");
}

afterEach(() => {
  delete globalThis.__WRAITHWALKER_TEST__;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("options entrypoint", () => {
  it("renders stored sites, root state, and native helper config", async () => {
    renderOptionsMarkup();
    const { initOptions } = await loadOptionsModule();
    const rootHandle = {};

    await initOptions({
      document,
      windowRef: window,
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: vi.fn()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([createStoredSite()]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        hostName: "com.example.host",
        rootPath: "/tmp/fixtures",
        commandTemplate: 'code "$DIR"',
        verifiedAt: "2026-04-03T00:00:00.000Z",
        lastVerificationError: "",
        lastOpenError: ""
      }),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-1" }),
      storeRootHandleWithSentinel: vi.fn()
    });

    expect(document.querySelector("#sites-list")?.textContent).toContain("https://app.example.com");
    expect(queryInput("#native-host-name").value).toBe("com.example.host");
    expect(queryInput("#native-root-path").value).toBe("/tmp/fixtures");
    expect(document.querySelector("#root-status")?.textContent).toContain("ready");
    expect(querySelect(".site-mode").value).toBe("simple");
    expect(queryInput(".site-allowlist").value).toBe(DEFAULT_DUMP_ALLOWLIST_PATTERN);
  });

  it("adds an origin after host permission is granted", async () => {
    renderOptionsMarkup();
    const { initOptions } = await loadOptionsModule();
    let sites = [];
    const setSiteConfigs = vi.fn(async (nextSites) => {
      sites = nextSites;
    });
    const permissions = {
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn()
    };

    await initOptions({
      document,
      windowRef: window,
      chromeApi: {
        permissions,
        runtime: {
          sendMessage: vi.fn()
        }
      },
      getSiteConfigs: vi.fn(async () => [...sites]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        hostName: "",
        rootPath: "",
        commandTemplate: 'code "$DIR"',
        verifiedAt: null,
        lastVerificationError: "",
        lastOpenError: ""
      }),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn()
    });

    queryInput("#site-origin").value = "app.example.com";
    document.querySelector("#site-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(permissions.request).toHaveBeenCalledWith({ origins: ["https://app.example.com/*"] });
    expect(setSiteConfigs).toHaveBeenCalledWith([
      expect.objectContaining({
        origin: "https://app.example.com",
        mode: "simple",
        dumpAllowlistPattern: DEFAULT_DUMP_ALLOWLIST_PATTERN
      })
    ]);
    expect(document.querySelector("#flash")?.textContent).toContain("Origin added");
  });

  it("removes an existing origin", async () => {
    renderOptionsMarkup();
    const { initOptions } = await loadOptionsModule();
    const permissions = {
      request: vi.fn(),
      remove: vi.fn().mockResolvedValue(true)
    };
    let sites = [createStoredSite()];
    const setSiteConfigs = vi.fn(async (nextSites) => {
      sites = nextSites;
    });

    await initOptions({
      document,
      windowRef: window,
      chromeApi: {
        permissions,
        runtime: {
          sendMessage: vi.fn()
        }
      },
      getSiteConfigs: vi.fn(async () => [...sites]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        hostName: "",
        rootPath: "",
        commandTemplate: 'code "$DIR"',
        verifiedAt: null,
        lastVerificationError: "",
        lastOpenError: ""
      }),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn()
    });

    document.querySelector(".remove-site")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();

    expect(permissions.remove).toHaveBeenCalledWith({ origins: ["https://app.example.com/*"] });
    expect(setSiteConfigs).toHaveBeenCalledWith([]);
    expect(document.querySelector("#flash")?.textContent).toContain("Removed https://app.example.com.");
  });

  it("stores the selected root directory and surfaces the sentinel", async () => {
    renderOptionsMarkup();
    const { initOptions } = await loadOptionsModule();
    const rootHandle = { kind: "directory" };
    const showDirectoryPicker = vi.fn().mockResolvedValue(rootHandle);
    const storeRootHandleWithSentinel = vi.fn().mockResolvedValue({ rootId: "root-123" });

    await initOptions({
      document,
      windowRef: withDirectoryPicker(showDirectoryPicker),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: vi.fn()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        hostName: "",
        rootPath: "",
        commandTemplate: 'code "$DIR"',
        verifiedAt: null,
        lastVerificationError: "",
        lastOpenError: ""
      }),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel
    });

    document.querySelector("#choose-root")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();

    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(storeRootHandleWithSentinel).toHaveBeenCalledWith(rootHandle);
    expect(document.querySelector("#flash")?.textContent).toContain("root-123");
  });

  it("surfaces native helper verification failures", async () => {
    renderOptionsMarkup();
    const { initOptions } = await loadOptionsModule();

    await initOptions({
      document,
      windowRef: window,
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: vi.fn().mockResolvedValue({ ok: false, error: "Native helper offline." })
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        hostName: "",
        rootPath: "",
        commandTemplate: 'code "$DIR"',
        verifiedAt: null,
        lastVerificationError: "",
        lastOpenError: ""
      }),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn()
    });

    document.querySelector("#verify-helper")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();

    expect(document.querySelector("#flash")?.textContent).toContain("Native helper offline.");
  });

  it("renders blocked root access and reauthorizes the stored root", async () => {
    renderOptionsMarkup();
    const { initOptions } = await loadOptionsModule();
    const rootHandle = {};
    const requestRootPermission = vi.fn().mockResolvedValue("granted");

    const options = await initOptions({
      document,
      windowRef: window,
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: vi.fn()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        hostName: "",
        rootPath: "",
        commandTemplate: 'code "$DIR"',
        verifiedAt: null,
        lastVerificationError: "",
        lastOpenError: ""
      }),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      queryRootPermission: vi.fn().mockResolvedValue("prompt"),
      requestRootPermission,
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-1" }),
      storeRootHandleWithSentinel: vi.fn()
    });

    await options.renderRootState();
    expect(document.querySelector("#root-status")?.textContent).toContain("reauthorized");

    document.querySelector("#reauthorize-root")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();

    expect(requestRootPermission).toHaveBeenCalledWith(rootHandle);
    expect(document.querySelector("#flash")?.textContent).toContain("Root permission status: granted");
  });

  it("does not duplicate stored origins and reports permission denials", async () => {
    renderOptionsMarkup();
    const { initOptions } = await loadOptionsModule();
    let sites = [createStoredSite()];
    const setSiteConfigs = vi.fn(async (nextSites) => {
      sites = nextSites;
    });
    const permissions = {
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn()
    };

    const options = await initOptions({
      document,
      windowRef: window,
      chromeApi: {
        permissions,
        runtime: {
          sendMessage: vi.fn()
        }
      },
      getSiteConfigs: vi.fn(async () => [...sites]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        hostName: "",
        rootPath: "",
        commandTemplate: 'code "$DIR"',
        verifiedAt: null,
        lastVerificationError: "",
        lastOpenError: ""
      }),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn()
    });

    await options.addSite("https://app.example.com");
    expect(setSiteConfigs).not.toHaveBeenCalled();

    permissions.request.mockResolvedValueOnce(false);
    await expect(options.addSite("https://denied.example.com")).rejects.toThrow(
      "Host access was not granted for https://denied.example.com/*."
    );
  });

  it("updates the site mode and allowlist after validating the regex", async () => {
    renderOptionsMarkup();
    const { initOptions } = await loadOptionsModule();
    let sites = [createStoredSite()];
    const setSiteConfigs = vi.fn(async (nextSites) => {
      sites = nextSites;
    });

    await initOptions({
      document,
      windowRef: window,
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: vi.fn()
        }
      },
      getSiteConfigs: vi.fn(async () => [...sites]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        hostName: "",
        rootPath: "",
        commandTemplate: 'code "$DIR"',
        verifiedAt: null,
        lastVerificationError: "",
        lastOpenError: ""
      }),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn()
    });

    querySelect(".site-mode").value = "advanced";
    queryInput(".site-allowlist").value = "\\.json$";
    document.querySelector(".save-site")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();

    expect(setSiteConfigs).toHaveBeenCalledWith([
      expect.objectContaining({
        origin: "https://app.example.com",
        mode: "advanced",
        dumpAllowlistPattern: "\\.json$"
      })
    ]);
    expect(document.querySelector("#flash")?.textContent).toContain("Updated https://app.example.com.");
  });

  it("rejects invalid allowlist regex updates", async () => {
    renderOptionsMarkup();
    const { initOptions } = await loadOptionsModule();
    const setSiteConfigs = vi.fn();

    await initOptions({
      document,
      windowRef: window,
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: vi.fn()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([createStoredSite()]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        hostName: "",
        rootPath: "",
        commandTemplate: 'code "$DIR"',
        verifiedAt: null,
        lastVerificationError: "",
        lastOpenError: ""
      }),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn()
    });

    queryInput(".site-allowlist").value = "[";
    document.querySelector(".save-site")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();

    expect(setSiteConfigs).not.toHaveBeenCalled();
    expect(document.querySelector("#flash")?.textContent).toContain("Dump allowlist regex is invalid.");
  });

  it("ignores aborted directory picks and reports missing roots during reauthorization", async () => {
    renderOptionsMarkup();
    const { initOptions } = await loadOptionsModule();
    const showDirectoryPicker = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));

    await initOptions({
      document,
      windowRef: withDirectoryPicker(showDirectoryPicker),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: vi.fn()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        hostName: "",
        rootPath: "",
        commandTemplate: 'code "$DIR"',
        verifiedAt: null,
        lastVerificationError: "",
        lastOpenError: ""
      }),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn()
    });

    document.querySelector("#choose-root")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(document.querySelector("#flash")?.textContent).toBe("");

    document.querySelector("#reauthorize-root")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(document.querySelector("#flash")?.textContent).toContain("Choose a root directory first.");
  });

  it("saves native helper settings and reports successful verification", async () => {
    renderOptionsMarkup();
    const { initOptions } = await loadOptionsModule();
    const setNativeHostConfig = vi.fn().mockResolvedValue(undefined);
    const getNativeHostConfig = vi
      .fn()
      .mockResolvedValueOnce({
        hostName: "",
        rootPath: "",
        commandTemplate: 'code "$DIR"',
        verifiedAt: null,
        lastVerificationError: "",
        lastOpenError: ""
      })
      .mockResolvedValueOnce({
        hostName: "com.example.host",
        rootPath: "/tmp/fixtures",
        commandTemplate: 'cursor "$DIR"',
        verifiedAt: "2026-04-03T12:00:00.000Z",
        lastVerificationError: "",
        lastOpenError: ""
      })
      .mockResolvedValueOnce({
        hostName: "com.example.host",
        rootPath: "/tmp/fixtures",
        commandTemplate: 'cursor "$DIR"',
        verifiedAt: "2026-04-03T12:00:00.000Z",
        lastVerificationError: "",
        lastOpenError: ""
      })
      .mockResolvedValueOnce({
        hostName: "com.example.host",
        rootPath: "/tmp/fixtures",
        commandTemplate: 'cursor "$DIR"',
        verifiedAt: "2026-04-03T12:00:00.000Z",
        lastVerificationError: "",
        lastOpenError: ""
      });

    await initOptions({
      document,
      windowRef: window,
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: vi.fn().mockResolvedValue({ ok: true, verifiedAt: "2026-04-03T12:00:00.000Z" })
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig,
      setNativeHostConfig,
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn()
    });

    queryInput("#native-host-name").value = "com.example.host";
    queryInput("#native-root-path").value = "/tmp/fixtures";
    queryInput("#native-command-template").value = 'cursor "$DIR"';
    document.querySelector("#native-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(setNativeHostConfig).toHaveBeenCalledWith({
      hostName: "com.example.host",
      rootPath: "/tmp/fixtures",
      commandTemplate: 'cursor "$DIR"',
      verifiedAt: "2026-04-03T12:00:00.000Z",
      lastVerificationError: "",
      lastOpenError: ""
    });
    expect(document.querySelector("#flash")?.textContent).toContain("Native helper settings saved.");

    document.querySelector("#verify-helper")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(document.querySelector("#flash")?.textContent).toContain("Helper verified at 2026-04-03T12:00:00.000Z.");
  });
});
