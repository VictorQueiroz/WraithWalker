// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { DEFAULT_NATIVE_HOST_CONFIG } from "../src/lib/constants.js";
import type { NativeHostConfig, SessionSnapshot } from "../src/lib/types.js";

function renderRoot() {
  document.body.innerHTML = "<div id=\"root\"></div>";
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

function createSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionActive: false,
    attachedTabIds: [],
    enabledOrigins: ["https://app.example.com"],
    rootReady: true,
    captureDestination: "local",
    captureRootPath: "/tmp/fixtures",
    lastError: "",
    ...overrides
  };
}

function createRootDeps({
  hasHandle = true,
  permission = "granted" as PermissionState
} = {}) {
  return {
    loadStoredRootHandle: vi.fn().mockResolvedValue(
      hasHandle ? ({ kind: "directory" } as FileSystemDirectoryHandle) : undefined
    ),
    queryRootPermission: vi.fn().mockResolvedValue(permission)
  };
}

const fakeSetInterval = ((_handler: TimerHandler, _timeout?: number) => 1) as typeof setInterval;

async function loadPopupModule() {
  vi.resetModules();
  globalThis.__WRAITHWALKER_TEST__ = true;
  return import("../src/popup.ts");
}

async function loadPopupModuleOutsideTestMode() {
  vi.resetModules();
  delete globalThis.__WRAITHWALKER_TEST__;
  return import("../src/popup.ts");
}

afterEach(() => {
  delete globalThis.__WRAITHWALKER_TEST__;
  delete globalThis.chrome;
  vi.doUnmock("../src/lib/chrome-storage.js");
  vi.doUnmock("../src/lib/root-handle.js");
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("popup entrypoint", () => {
  it("throws when the popup root container is missing", async () => {
    document.body.innerHTML = "";
    const { initPopup } = await loadPopupModule();

    await expect(initPopup({
      document,
      runtime: {
        sendMessage: vi.fn(),
        openOptionsPage: vi.fn()
      },
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    })).rejects.toThrow("Popup root container not found.");
  });

  it("renders the simplified popup with only the required controls", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue(createSnapshot({ sessionActive: true })),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({ launchPath: "/tmp/fixtures" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      expect(await screen.findByRole("button", { name: "Stop Session" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open in Cursor" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
      expect(screen.getAllByRole("button")).toHaveLength(3);
      expect(screen.queryByText("Managed Origins")).toBeNull();
      expect(screen.queryByText("Attached Tabs")).toBeNull();
      expect(runtime.sendMessage).toHaveBeenCalledWith({ type: "session.getState" });
    } finally {
      popup.unmount();
    }
  });

  it("routes Cursor opening through the shared background flow", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi.fn()
        .mockResolvedValueOnce(createSnapshot())
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce(createSnapshot()),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({ launchPath: "/tmp/fixtures" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      await user.click(await screen.findByRole("button", { name: "Open in Cursor" }));

      expect(runtime.sendMessage).toHaveBeenCalledWith({
        type: "native.open",
        editorId: "cursor"
      });
      expect(await screen.findByText("Opened Cursor and sent the fixture brief to Cursor Chat.")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("still uses the shared background flow when no launch path is configured", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi.fn()
        .mockResolvedValueOnce(createSnapshot())
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce(createSnapshot()),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({ launchPath: "" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      expect(await screen.findByText("Session is idle. Start it when you want matching tabs to attach automatically.")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Open in Cursor" }));
      expect(runtime.sendMessage).toHaveBeenCalledWith({
        type: "native.open",
        editorId: "cursor"
      });
      expect(await screen.findByText("Opened Cursor and sent the fixture brief to Cursor Chat.")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("surfaces background open failures only after the open button is clicked", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi.fn()
        .mockResolvedValueOnce(createSnapshot())
        .mockResolvedValueOnce({
          ok: false,
          error: "Cursor prompt launch failed."
        })
        .mockResolvedValueOnce(createSnapshot()),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({
        launchPath: "",
        editorLaunchOverrides: {
          cursor: {
            urlTemplate: "cursor://file/$DIR_URI/"
          }
        }
      })),
      ...createRootDeps()
    });

    try {
      expect(await screen.findByText("Session is idle. Start it when you want matching tabs to attach automatically.")).toBeTruthy();
      expect(screen.queryByText(/Cursor prompt launch failed/i)).toBeNull();

      await user.click(screen.getByRole("button", { name: "Open in Cursor" }));
      expect(await screen.findByText("Cursor prompt launch failed.")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("surfaces runtime action errors from the session toggle", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi.fn()
        .mockResolvedValueOnce(createSnapshot())
        .mockRejectedValueOnce(new Error("Session failed.")),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({ launchPath: "/tmp/fixtures" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      await user.click(await screen.findByRole("button", { name: "Start Session" }));
      expect(await screen.findByText("Session failed.")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("updates popup state after a successful session toggle", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi.fn()
        .mockResolvedValueOnce(createSnapshot({ lastError: "Old capture error." }))
        .mockResolvedValueOnce(createSnapshot({ sessionActive: true, lastError: "" })),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({ launchPath: "/tmp/fixtures" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      expect(await screen.findByText("Old capture error.")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Start Session" }));

      expect(await screen.findByRole("button", { name: "Stop Session" })).toBeTruthy();
      expect(screen.queryByText("Old capture error.")).toBeNull();
    } finally {
      popup.unmount();
    }
  });

  it("surfaces thrown open-editor errors through the single status area", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi.fn()
        .mockResolvedValueOnce(createSnapshot())
        .mockRejectedValueOnce(new Error("Cursor protocol failed.")),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({ launchPath: "/tmp/fixtures" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      await user.click(await screen.findByRole("button", { name: "Open in Cursor" }));
      expect(await screen.findByText("Cursor protocol failed.")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("prioritizes stored session errors in the single status area", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue(createSnapshot({ lastError: "The last capture failed." })),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({ launchPath: "/tmp/fixtures" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      expect(await screen.findByText("The last capture failed.")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("surfaces blocked root state from the remembered handle", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue(createSnapshot({
        rootReady: false,
        captureDestination: "none",
        captureRootPath: ""
      })),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({ launchPath: "/tmp/fixtures" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps({ permission: "prompt" })
    });

    try {
      expect(await screen.findByText(/Reconnect the WraithWalker root directory in Settings/i)).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("shows a subtle connected indicator when the local WraithWalker server is active", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue(createSnapshot({
        rootReady: true,
        captureDestination: "server",
        captureRootPath: "/tmp/server-root"
      })),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({ launchPath: "" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps({ hasHandle: false })
    });

    try {
      expect(await screen.findByText("Connected.")).toBeTruthy();
      expect(screen.getByText(/Using local WraithWalker server root\./i)).toBeTruthy();
      expect(screen.getByText("/tmp/server-root")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("opens the options page from the lightweight settings action", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue(createSnapshot({ enabledOrigins: [] })),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({ launchPath: "/tmp/fixtures" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode"),
      ...createRootDeps()
    });

    try {
      await user.click(await screen.findByRole("button", { name: "Settings" }));
      expect(runtime.openOptionsPage).toHaveBeenCalled();
    } finally {
      popup.unmount();
    }
  });

  it("bootstraps automatically outside test mode", async () => {
    renderRoot();
    vi.doMock("../src/lib/chrome-storage.js", () => ({
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({ launchPath: "/tmp/fixtures" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor")
    }));
    vi.doMock("../src/lib/root-handle.js", () => ({
      loadStoredRootHandle: vi.fn().mockResolvedValue({ kind: "directory" }),
      queryRootPermission: vi.fn().mockResolvedValue("granted")
    }));
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(createSnapshot()),
        openOptionsPage: vi.fn()
      }
    } as any;

    await loadPopupModuleOutsideTestMode();

    expect(await screen.findByRole("button", { name: "Open in Cursor" })).toBeTruthy();
  });
});
