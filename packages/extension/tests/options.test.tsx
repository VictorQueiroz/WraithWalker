// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { DEFAULT_DUMP_ALLOWLIST_PATTERNS, DEFAULT_NATIVE_HOST_CONFIG, ROOT_DIRECTORY_PICKER_ID } from "../src/lib/constants.js";
import type { NativeHostConfig, SiteConfig } from "../src/lib/types.js";

function renderRoot() {
  document.body.innerHTML = "<div id=\"root\"></div>";
}

function createWindowWithDirectoryPicker(
  showDirectoryPicker: (options?: { mode?: "read" | "readwrite"; id?: string; startIn?: FileSystemDirectoryHandle }) => Promise<FileSystemDirectoryHandle>
): Window {
  const windowRef = window as Window & {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; id?: string; startIn?: FileSystemDirectoryHandle }) => Promise<unknown>;
  };
  windowRef.showDirectoryPicker = showDirectoryPicker;
  return windowRef;
}

function createStoredSite(overrides: Partial<SiteConfig> = {}): SiteConfig {
  return {
    origin: "https://app.example.com",
    createdAt: "2026-04-03T00:00:00.000Z",
    mode: "simple",
    dumpAllowlistPatterns: [...DEFAULT_DUMP_ALLOWLIST_PATTERNS],
    ...overrides
  };
}

function createNativeHostConfig(overrides: Partial<NativeHostConfig> = {}): NativeHostConfig {
  return {
    ...DEFAULT_NATIVE_HOST_CONFIG,
    ...overrides,
    editorLaunchOverrides: {
      ...DEFAULT_NATIVE_HOST_CONFIG.editorLaunchOverrides,
      ...overrides.editorLaunchOverrides
    }
  };
}

async function loadOptionsModule() {
  vi.resetModules();
  globalThis.__WRAITHWALKER_TEST__ = true;
  return import("../src/options.ts");
}

async function loadOptionsModuleOutsideTestMode() {
  vi.resetModules();
  delete globalThis.__WRAITHWALKER_TEST__;
  return import("../src/options.ts");
}

function createRuntimeSendMessage() {
  return vi.fn(async (message: { type: string; name?: string }) => {
    switch (message.type) {
      case "scenario.list":
        return { ok: true, scenarios: ["baseline"] };
      case "scenario.switch":
        return { ok: true, name: message.name ?? "" };
      case "scenario.save":
        return { ok: true, name: message.name ?? "" };
      case "native.verify":
        return { ok: true, verifiedAt: "2026-04-03T12:00:00.000Z" };
      default:
        return { ok: true };
    }
  });
}

afterEach(() => {
  delete globalThis.__WRAITHWALKER_TEST__;
  delete globalThis.chrome;
  vi.doUnmock("../src/lib/chrome-storage.js");
  vi.doUnmock("../src/lib/root-handle.js");
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("options entrypoint", () => {
  it("throws when the options root container is missing", async () => {
    document.body.innerHTML = "";
    const { initOptions } = await loadOptionsModule();

    await expect(initOptions({
      document,
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: vi.fn()
        }
      }
    })).rejects.toThrow("Options root container not found.");
  });

  it("renders stored sites and updates or removes them", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    let sites = [createStoredSite()];
    const setSiteConfigs = vi.fn(async (nextSites: SiteConfig[]) => {
      sites = nextSites;
    });

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn().mockResolvedValue(true),
          remove: vi.fn().mockResolvedValue(true)
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn(async () => [...sites]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      expect(await screen.findByText("Enabled Origins")).toBeTruthy();
      expect(await screen.findByText("https://app.example.com")).toBeTruthy();

      const modeSelect = await screen.findByLabelText("Storage Mode");
      await user.selectOptions(modeSelect, "advanced");
      const patterns = await screen.findByLabelText("Dump Allowlist Patterns");
      await user.clear(patterns);
      await user.type(patterns, "\\.json$");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(setSiteConfigs).toHaveBeenCalledWith([
        expect.objectContaining({
          origin: "https://app.example.com",
          mode: "advanced",
          dumpAllowlistPatterns: ["\\.json$"]
        })
      ]);
      expect(await screen.findByText("Updated https://app.example.com.")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Remove" }));
      expect(setSiteConfigs).toHaveBeenLastCalledWith([]);
      expect(await screen.findByText("Removed https://app.example.com.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("shows a validation error for invalid dump allowlist patterns", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const setSiteConfigs = vi.fn();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn().mockResolvedValue(true),
          remove: vi.fn().mockResolvedValue(true)
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([createStoredSite()]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      const patterns = await screen.findByLabelText("Dump Allowlist Patterns");
      fireEvent.change(patterns, { target: { value: "[" } });
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(setSiteConfigs).not.toHaveBeenCalled();
      expect(await screen.findByText("One or more dump allowlist patterns are invalid.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("adds an origin after host permission is granted", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    let sites: SiteConfig[] = [];
    const setSiteConfigs = vi.fn(async (nextSites: SiteConfig[]) => {
      sites = nextSites;
    });
    const permissions = {
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn()
    };

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions,
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn(async () => [...sites]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await user.type(await screen.findByLabelText("Exact origin"), "app.example.com");
      await user.click(screen.getByRole("button", { name: "Add Origin" }));

      expect(permissions.request).toHaveBeenCalledWith({ origins: ["https://app.example.com/*"] });
      expect(setSiteConfigs).toHaveBeenCalledWith([
        expect.objectContaining({
          origin: "https://app.example.com",
          mode: "simple",
          dumpAllowlistPatterns: [...DEFAULT_DUMP_ALLOWLIST_PATTERNS]
        })
      ]);
      expect(await screen.findByText("Origin added and host access granted.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("shows a helpful error when host permission is denied", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const permissions = {
      request: vi.fn().mockResolvedValue(false),
      remove: vi.fn()
    };

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions,
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await user.type(await screen.findByLabelText("Exact origin"), "app.example.com");
      await user.click(screen.getByRole("button", { name: "Add Origin" }));

      expect(permissions.request).toHaveBeenCalledWith({ origins: ["https://app.example.com/*"] });
      expect(await screen.findByText("Host access was not granted for https://app.example.com/*." )).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("shows the choose-root action when no root is connected and stores the selection", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const rootHandle = { kind: "directory" } as FileSystemDirectoryHandle;
    const showDirectoryPicker = vi.fn().mockResolvedValue(rootHandle);
    const loadStoredRootHandle = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(rootHandle);
    const ensureRootSentinel = vi.fn().mockResolvedValue({ rootId: "root-123" });
    const storeRootHandleWithSentinel = vi.fn().mockResolvedValue({ rootId: "root-123" });

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(showDirectoryPicker),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle,
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn(),
      ensureRootSentinel,
      storeRootHandleWithSentinel,
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      const button = await screen.findByRole("button", { name: "Choose Root Directory" });
      await user.click(button);

      expect(showDirectoryPicker).toHaveBeenCalledWith({
        mode: "readwrite",
        id: ROOT_DIRECTORY_PICKER_ID
      });
      expect(storeRootHandleWithSentinel).toHaveBeenCalledWith(rootHandle);
      expect(await screen.findByText(/Root directory saved\. Root ID: root-123\./)).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("ignores aborted root-directory picks without surfacing an error", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const showDirectoryPicker = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(showDirectoryPicker),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await user.click(await screen.findByRole("button", { name: "Choose Root Directory" }));
      expect(showDirectoryPicker).toHaveBeenCalledWith({
        mode: "readwrite",
        id: ROOT_DIRECTORY_PICKER_ID
      });
      expect(screen.queryByText(/Aborted/i)).toBeNull();
      expect(screen.getByText(/No capture root is connected yet/i)).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("shows the reconnect action when root permission is revoked", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const rootHandle = {};
    const queryRootPermission = vi.fn()
      .mockResolvedValueOnce("prompt")
      .mockResolvedValueOnce("granted");
    const requestRootPermission = vi.fn().mockResolvedValue("granted");

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      queryRootPermission,
      requestRootPermission,
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-1" }),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      const button = await screen.findByRole("button", { name: "Reconnect Root Directory" });
      await user.click(button);
      expect(requestRootPermission).toHaveBeenCalledWith(rootHandle);
      expect(await screen.findByText("Root permission status: granted.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("keeps the settings flow Cursor-first without a preferred-editor picker", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn()
    });

    try {
      expect(await screen.findByText("Capture Root")).toBeTruthy();
      expect(screen.queryByText("Preferred Editor")).toBeNull();
      await userEvent.setup().click(screen.getByRole("button", { name: "Show" }));
      expect(await screen.findByLabelText("Custom URL Override For Cursor")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("shows the change-root action and sentinel when the root is ready", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const currentRootHandle = { kind: "directory" } as FileSystemDirectoryHandle;
    const showDirectoryPicker = vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle);

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(showDirectoryPicker),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(currentRootHandle),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-ready" }),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      expect(await screen.findByRole("button", { name: "Change Root Directory" })).toBeTruthy();
      expect(screen.getByText("Root access is ready. Root ID: root-ready.")).toBeTruthy();
      expect(screen.getByText("root-ready")).toBeTruthy();
      expect(screen.getByText("Capture Root")).toBeTruthy();
      expect(screen.getByText("Enabled Origins")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open Launch Folder" })).toBeTruthy();
      expect(screen.queryByText("Default root path")).toBeNull();

      await userEvent.setup().click(screen.getByRole("button", { name: "Change Root Directory" }));
      expect(showDirectoryPicker).toHaveBeenCalledWith({
        mode: "readwrite",
        id: ROOT_DIRECTORY_PICKER_ID,
        startIn: currentRootHandle
      });
    } finally {
      options.unmount();
    }
  });

  it("saves Cursor launch overrides from the collapsed advanced section", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const setNativeHostConfig = vi.fn().mockResolvedValue(undefined);
    const getNativeHostConfig = vi.fn()
      .mockResolvedValueOnce(createNativeHostConfig())
      .mockResolvedValueOnce(createNativeHostConfig({
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures",
        editorLaunchOverrides: {
          cursor: {
            urlTemplate: "cursor://workspace?folder=$DIR_COMPONENT",
            commandTemplate: 'cursor "$DIR"'
          }
        }
      }))
      .mockResolvedValueOnce(createNativeHostConfig({
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures",
        editorLaunchOverrides: {
          cursor: {
            urlTemplate: "cursor://workspace?folder=$DIR_COMPONENT",
            commandTemplate: 'cursor "$DIR"'
          }
        }
      }));
    const runtimeSendMessage = createRuntimeSendMessage();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: runtimeSendMessage
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

    try {
      expect(await screen.findByText(/Hidden by default so the common flow stays simple/i)).toBeTruthy();
      expect(screen.queryByLabelText("Native Host Name")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Show" }));
      fireEvent.change(await screen.findByLabelText("Native Host Name"), {
        target: { value: "com.example.host" }
      });
      fireEvent.change(screen.getByLabelText("Shared Editor Launch Path"), {
        target: { value: "/tmp/fixtures" }
      });
      fireEvent.change(screen.getByLabelText("Custom URL Override For Cursor"), {
        target: { value: "cursor://workspace?folder=$DIR_COMPONENT" }
      });
      fireEvent.change(screen.getByLabelText("Custom Command Override For Cursor"), {
        target: { value: 'cursor "$DIR"' }
      });
      await user.click(screen.getByRole("button", { name: "Save Launch Settings" }));

      expect(setNativeHostConfig).toHaveBeenCalledWith(createNativeHostConfig({
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures",
        editorLaunchOverrides: {
          cursor: {
            urlTemplate: "cursor://workspace?folder=$DIR_COMPONENT",
            commandTemplate: 'cursor "$DIR"'
          }
        }
      }));
      expect(await screen.findByText("Launch settings saved.")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Verify Helper" }));
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "native.verify" });
      expect(await screen.findByText("Helper verified at 2026-04-03T12:00:00.000Z.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("opens the configured launch folder through the OS handler", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const runtimeSendMessage = vi.fn(async (message: { type: string }) => {
      switch (message.type) {
        case "scenario.list":
          return { ok: true, scenarios: ["baseline"] };
        case "native.revealRoot":
          return { ok: true };
        default:
          return { ok: true };
      }
    });

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: runtimeSendMessage
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      })),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-ready" }),
      storeRootHandleWithSentinel: vi.fn()
    });

    try {
      await user.click(await screen.findByRole("button", { name: "Open Launch Folder" }));
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "native.revealRoot" });
      expect(await screen.findByText("Opened the launch folder in the OS file manager.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("surfaces launch-folder failures as a destructive flash message", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const runtimeSendMessage = vi.fn(async (message: { type: string }) => {
      switch (message.type) {
        case "scenario.list":
          return { ok: true, scenarios: ["baseline"] };
        case "native.revealRoot":
          return { ok: false, error: "Reveal failed." };
        default:
          return { ok: true };
      }
    });

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: runtimeSendMessage
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      })),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-ready" }),
      storeRootHandleWithSentinel: vi.fn()
    });

    try {
      await user.click(await screen.findByRole("button", { name: "Open Launch Folder" }));
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "native.revealRoot" });
      expect(await screen.findByText("Reveal failed.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("moves scenario save and switch controls into settings", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const runtimeSendMessage = createRuntimeSendMessage();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: runtimeSendMessage
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      expect(await screen.findByText("baseline")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Switch" }));
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "scenario.switch", name: "baseline" });
      expect(await screen.findByText('Switched to "baseline".')).toBeTruthy();

      await user.type(screen.getByLabelText("Scenario name"), "release");
      await user.click(screen.getByRole("button", { name: "Save Scenario" }));
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "scenario.save", name: "release" });
      expect(await screen.findByText('Scenario "release" saved.')).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("ignores blank scenario saves", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const runtimeSendMessage = createRuntimeSendMessage();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: runtimeSendMessage
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await user.type(await screen.findByLabelText("Scenario name"), "   ");
      await user.click(screen.getByRole("button", { name: "Save Scenario" }));
      expect(runtimeSendMessage).toHaveBeenCalledTimes(1);
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "scenario.list" });
    } finally {
      options.unmount();
    }
  });

  it("surfaces scenario list failures without crashing the page", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const runtimeSendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === "scenario.list") {
        return { ok: false, error: "Scenario listing failed." };
      }
      return { ok: true };
    });

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: runtimeSendMessage
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      expect(await screen.findByText("Scenario listing failed.")).toBeTruthy();
      expect(screen.getByText("No scenarios saved yet.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("surfaces helper verification and scenario action failures", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const runtimeSendMessage = vi.fn(async (message: { type: string; name?: string }) => {
      switch (message.type) {
        case "scenario.list":
          return { ok: true, scenarios: ["baseline"] };
        case "native.verify":
          return { ok: false, error: "Helper unavailable." };
        case "scenario.switch":
          return { ok: false, error: "Switch failed." };
        case "scenario.save":
          return { ok: false, error: "Save failed." };
        default:
          return { ok: true };
      }
    });

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: runtimeSendMessage
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await user.click(await screen.findByRole("button", { name: "Show" }));
      await user.click(screen.getByRole("button", { name: "Verify Helper" }));
      expect(await screen.findByText("Helper unavailable.")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Switch" }));
      expect(await screen.findByText("Switch failed.")).toBeTruthy();

      await user.type(screen.getByLabelText("Scenario name"), "release");
      await user.click(screen.getByRole("button", { name: "Save Scenario" }));
      expect(await screen.findByText("Save failed.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("bootstraps automatically outside test mode", async () => {
    renderRoot();
    vi.doMock("../src/lib/chrome-storage.js", () => ({
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      setNativeHostConfig: vi.fn().mockResolvedValue(undefined),
      setPreferredEditorId: vi.fn().mockResolvedValue(undefined),
      setSiteConfigs: vi.fn().mockResolvedValue(undefined)
    }));
    vi.doMock("../src/lib/root-handle.js", () => ({
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-auto" }),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn().mockResolvedValue("prompt"),
      requestRootPermission: vi.fn().mockResolvedValue("granted"),
      storeRootHandleWithSentinel: vi.fn().mockResolvedValue({ rootId: "root-auto" })
    }));
    globalThis.chrome = {
      permissions: {
        request: vi.fn().mockResolvedValue(true),
        remove: vi.fn().mockResolvedValue(true)
      },
      runtime: {
        sendMessage: vi.fn(async (message: { type: string }) => {
          if (message.type === "scenario.list") {
            return { ok: true, scenarios: [] };
          }
          if (message.type === "native.verify") {
            return { ok: true, verifiedAt: "2026-04-03T12:00:00.000Z" };
          }
          return { ok: true };
        })
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined)
        }
      }
    } as any;
    createWindowWithDirectoryPicker(
      vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
    );

    await loadOptionsModuleOutsideTestMode();

    expect(await screen.findByText("Enabled Origins")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose Root Directory" })).toBeTruthy();
  });
});
