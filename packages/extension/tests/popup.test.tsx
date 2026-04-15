// @vitest-environment jsdom

import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { DEFAULT_NATIVE_HOST_CONFIG } from "../src/lib/constants.js";
import type { NativeHostConfig, SessionSnapshot } from "../src/lib/types.js";
import { createTestChromeApi } from "./helpers/chrome-api-test-helpers.js";

function renderRoot() {
  document.body.innerHTML = '<div id="root"></div>';
}

function createNativeHostConfig(
  overrides: Partial<NativeHostConfig> = {}
): NativeHostConfig {
  return {
    ...DEFAULT_NATIVE_HOST_CONFIG,
    ...overrides,
    editorLaunchOverrides: {
      ...DEFAULT_NATIVE_HOST_CONFIG.editorLaunchOverrides,
      ...overrides.editorLaunchOverrides
    }
  };
}

function createSnapshot(
  overrides: Partial<SessionSnapshot> = {}
): SessionSnapshot {
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
    loadStoredRootHandle: vi
      .fn()
      .mockResolvedValue(
        hasHandle
          ? ({ kind: "directory" } as FileSystemDirectoryHandle)
          : undefined
      ),
    queryRootPermission: vi.fn().mockResolvedValue(permission)
  };
}

const fakeSetInterval = ((_handler: TimerHandler, _timeout?: number) =>
  1) as typeof setInterval;

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

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
  vi.doUnmock("node:child_process");
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("popup entrypoint", () => {
  it("throws when the popup root container is missing", async () => {
    document.body.innerHTML = "";
    const { initPopup } = await loadPopupModule();

    await expect(
      initPopup({
        document,
        runtime: {
          sendMessage: vi.fn(),
          openOptionsPage: vi.fn()
        },
        getNativeHostConfig: vi
          .fn()
          .mockResolvedValue(createNativeHostConfig()),
        getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
        ...createRootDeps()
      })
    ).rejects.toThrow("Popup root container not found.");
  });

  it("renders the simplified popup with only the required controls", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValue(createSnapshot({ sessionActive: true })),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(
          createNativeHostConfig({ launchPath: "/tmp/fixtures" })
        ),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      expect(
        await screen.findByRole("button", { name: "Stop Session" })
      ).toBeTruthy();
      expect(screen.getByLabelText("Workspace status")).toBeTruthy();
      expect(screen.getByText("Active")).toBeTruthy();
      expect(screen.getAllByText("Remembered Browser Root")).toHaveLength(2);
      expect(screen.getByText("1 enabled")).toBeTruthy();
      expect(
        screen.getByText("Open in Cursor uses Remembered Browser Root.")
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Open in Cursor" })
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Open in folder" })
      ).toBeNull();
      expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
      expect(screen.getAllByRole("button")).toHaveLength(3);
      expect(screen.queryByText("Managed Origins")).toBeNull();
      expect(screen.queryByText("Attached Tabs")).toBeNull();
      expect(runtime.sendMessage).toHaveBeenCalledWith({
        type: "session.getState"
      });
    } finally {
      popup.unmount();
    }
  });

  it("falls back to the first configured editor preset when the default preset is absent", async () => {
    const { PopupApp } = await import("../src/ui/popup-app.tsx");
    const popup = render(
      React.createElement(PopupApp, {
        runtime: {
          sendMessage: vi.fn().mockResolvedValue(createSnapshot()),
          openOptionsPage: vi.fn()
        },
        getNativeHostConfig: vi
          .fn()
          .mockResolvedValue(
            createNativeHostConfig({ launchPath: "/tmp/fixtures" })
          ),
        setIntervalFn: fakeSetInterval,
        clearIntervalFn: vi.fn() as typeof clearInterval,
        editorPresets: [
          {
            id: "zed",
            label: "Zed",
            urlTemplate: "zed://file/$DIR_URI/",
            commandTemplate: "zed $DIR_PATH"
          }
        ],
        ...createRootDeps()
      })
    );

    try {
      expect(
        await screen.findByRole("button", { name: "Open in Zed" })
      ).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("routes Cursor opening through the shared background flow", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(createSnapshot())
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce(createSnapshot()),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(
          createNativeHostConfig({ launchPath: "/tmp/fixtures" })
        ),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      await user.click(
        await screen.findByRole("button", { name: "Open in Cursor" })
      );

      expect(runtime.sendMessage).toHaveBeenCalledWith({
        type: "native.open",
        editorId: "cursor"
      });
      expect(
        await screen.findByText(
          "Opened Cursor for Remembered Browser Root and sent the fixture brief to Cursor Chat."
        )
      ).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("still uses the shared background flow when no launch path is configured", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(createSnapshot())
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce(createSnapshot()),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(createNativeHostConfig({ launchPath: "" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      expect(
        await screen.findByText("Open in Cursor uses Remembered Browser Root.")
      ).toBeTruthy();
      expect(screen.getByText("Idle")).toBeTruthy();
      expect(screen.getByText("1 enabled")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Open in Cursor" }));
      expect(runtime.sendMessage).toHaveBeenCalledWith({
        type: "native.open",
        editorId: "cursor"
      });
      expect(
        await screen.findByText(
          "Opened Cursor for Remembered Browser Root and sent the fixture brief to Cursor Chat."
        )
      ).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("surfaces background open failures only after the open button is clicked", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi
        .fn()
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
      getNativeHostConfig: vi.fn().mockResolvedValue(
        createNativeHostConfig({
          launchPath: "",
          editorLaunchOverrides: {
            cursor: {
              urlTemplate: "cursor://file/$DIR_URI/"
            }
          }
        })
      ),
      ...createRootDeps()
    });

    try {
      expect(
        await screen.findByText("Open in Cursor uses Remembered Browser Root.")
      ).toBeTruthy();
      expect(screen.queryByText(/Cursor prompt launch failed/i)).toBeNull();

      await user.click(screen.getByRole("button", { name: "Open in Cursor" }));
      expect(
        await screen.findByText("Cursor prompt launch failed.")
      ).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("surfaces runtime action errors from the session toggle", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(createSnapshot())
        .mockRejectedValueOnce(new Error("Session failed.")),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(
          createNativeHostConfig({ launchPath: "/tmp/fixtures" })
        ),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      await user.click(
        await screen.findByRole("button", { name: "Start Session" })
      );
      expect(await screen.findByText("Session failed.")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("stringifies non-Error session toggle failures through the single status area", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(createSnapshot())
        .mockRejectedValueOnce("Session failed hard."),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(
          createNativeHostConfig({ launchPath: "/tmp/fixtures" })
        ),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      await user.click(
        await screen.findByRole("button", { name: "Start Session" })
      );
      expect(await screen.findByText("Session failed hard.")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("updates popup state after a successful session toggle", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(
          createSnapshot({ lastError: "Old capture error." })
        )
        .mockResolvedValueOnce(
          createSnapshot({ sessionActive: true, lastError: "" })
        ),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(
          createNativeHostConfig({ launchPath: "/tmp/fixtures" })
        ),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      expect(await screen.findByText("Old capture error.")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Start Session" }));

      expect(
        await screen.findByRole("button", { name: "Stop Session" })
      ).toBeTruthy();
      expect(screen.queryByText("Old capture error.")).toBeNull();
    } finally {
      popup.unmount();
    }
  });

  it("stops the session when the background reports that capture is already active", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(createSnapshot({ sessionActive: true }))
        .mockResolvedValueOnce(createSnapshot({ sessionActive: false })),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(
          createNativeHostConfig({ launchPath: "/tmp/fixtures" })
        ),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      await user.click(
        await screen.findByRole("button", { name: "Stop Session" })
      );

      expect(runtime.sendMessage).toHaveBeenNthCalledWith(2, {
        type: "session.stop"
      });
      expect(
        await screen.findByRole("button", { name: "Start Session" })
      ).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("stops the session even when the current snapshot has not loaded yet", async () => {
    const { PopupApp } = await import("../src/ui/popup-app.tsx");
    const user = userEvent.setup();
    const initialSnapshot = createDeferred<SessionSnapshot>();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockImplementationOnce(() => initialSnapshot.promise)
        .mockResolvedValueOnce(createSnapshot({ sessionActive: true }))
        .mockResolvedValueOnce(createSnapshot({ sessionActive: false })),
      openOptionsPage: vi.fn()
    };

    const popup = render(
      React.createElement(PopupApp, {
        runtime,
        getNativeHostConfig: vi
          .fn()
          .mockResolvedValue(
            createNativeHostConfig({ launchPath: "/tmp/fixtures" })
          ),
        setIntervalFn: fakeSetInterval,
        clearIntervalFn: vi.fn() as typeof clearInterval,
        ...createRootDeps()
      })
    );

    try {
      await user.click(
        await screen.findByRole("button", { name: "Start Session" })
      );

      expect(runtime.sendMessage).toHaveBeenNthCalledWith(2, {
        type: "session.getState"
      });
      expect(runtime.sendMessage).toHaveBeenNthCalledWith(3, {
        type: "session.stop"
      });

      initialSnapshot.resolve(createSnapshot({ sessionActive: false }));
      await flushPromises();
      expect(
        await screen.findByRole("button", { name: "Start Session" })
      ).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("surfaces thrown open-editor errors through the single status area", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(createSnapshot())
        .mockRejectedValueOnce(new Error("Cursor protocol failed.")),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(
          createNativeHostConfig({ launchPath: "/tmp/fixtures" })
        ),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      await user.click(
        await screen.findByRole("button", { name: "Open in Cursor" })
      );
      expect(await screen.findByText("Cursor protocol failed.")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("stringifies non-Error open-editor failures through the single status area", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(createSnapshot())
        .mockRejectedValueOnce(418),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(
          createNativeHostConfig({ launchPath: "/tmp/fixtures" })
        ),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      await user.click(
        await screen.findByRole("button", { name: "Open in Cursor" })
      );
      expect(await screen.findByText("418")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("falls back to the shared unknown error message when open-editor fails without an error field", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(createSnapshot())
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce(createSnapshot()),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(
          createNativeHostConfig({ launchPath: "/tmp/fixtures" })
        ),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      await user.click(
        await screen.findByRole("button", { name: "Open in Cursor" })
      );
      expect(await screen.findByText("Unknown error.")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("safely ignores deferred startup completion after the popup unmounts", async () => {
    const { PopupApp } = await import("../src/ui/popup-app.tsx");
    const nativeHostConfig = createDeferred<NativeHostConfig>();
    const initialSnapshot = createDeferred<SessionSnapshot>();
    const runtime = {
      sendMessage: vi.fn().mockImplementationOnce(() => initialSnapshot.promise),
      openOptionsPage: vi.fn()
    };
    const getNativeHostConfig = vi
      .fn()
      .mockImplementationOnce(() => nativeHostConfig.promise);
    const clearIntervalFn = vi.fn() as typeof clearInterval;

    const popup = render(
      React.createElement(PopupApp, {
        runtime,
        getNativeHostConfig,
        setIntervalFn: fakeSetInterval,
        clearIntervalFn,
        ...createRootDeps()
      })
    );

    await flushPromises();
    popup.unmount();

    nativeHostConfig.resolve(
      createNativeHostConfig({ launchPath: "/tmp/fixtures" })
    );
    initialSnapshot.resolve(createSnapshot());
    await flushPromises();

    expect(getNativeHostConfig).toHaveBeenCalledTimes(1);
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: "session.getState"
    });
    expect(clearIntervalFn).toHaveBeenCalledWith(1);
  });

  it("opens the server root in the OS file manager through the shared background flow", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(
          createSnapshot({
            captureDestination: "server",
            captureRootPath: "/tmp/server-root"
          })
        )
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce(
          createSnapshot({
            captureDestination: "server",
            captureRootPath: "/tmp/server-root"
          })
        ),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(createNativeHostConfig({ launchPath: "" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps({ hasHandle: false })
    });

    try {
      await user.click(
        await screen.findByRole("button", { name: "Open in folder" })
      );

      expect(runtime.sendMessage).toHaveBeenCalledWith({
        type: "native.revealRoot"
      });
      expect(
        await screen.findByText(
          "Opened Server Root in the OS file manager."
        )
      ).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("surfaces thrown reveal-folder errors and restores the button state", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(
          createSnapshot({
            captureDestination: "server",
            captureRootPath: "/tmp/server-root"
          })
        )
        .mockRejectedValueOnce(new Error("Reveal transport failed.")),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(createNativeHostConfig({ launchPath: "" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps({ hasHandle: false })
    });

    try {
      await user.click(
        await screen.findByRole("button", { name: "Open in folder" })
      );

      expect(
        await screen.findByText("Reveal transport failed.")
      ).toBeTruthy();
      const revealButton = screen.getByRole("button", { name: "Open in folder" });
      expect((revealButton as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByRole("button", { name: "Opening..." })).toBeNull();
    } finally {
      popup.unmount();
    }
  });

  it("stringifies non-Error reveal-folder failures and restores the button state", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(
          createSnapshot({
            captureDestination: "server",
            captureRootPath: "/tmp/server-root"
          })
        )
        .mockRejectedValueOnce(404),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(createNativeHostConfig({ launchPath: "" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps({ hasHandle: false })
    });

    try {
      await user.click(
        await screen.findByRole("button", { name: "Open in folder" })
      );

      expect(await screen.findByText("404")).toBeTruthy();
      const revealButton = screen.getByRole("button", { name: "Open in folder" });
      expect((revealButton as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByRole("button", { name: "Opening..." })).toBeNull();
    } finally {
      popup.unmount();
    }
  });

  it("reveals the live server root through the connected server without requiring a native host", async () => {
    renderRoot();
    const user = userEvent.setup();
    vi.resetModules();
    globalThis.__WRAITHWALKER_TEST__ = true;

    const { initPopup } = await import("../src/popup.ts");
    const { createBackgroundRuntime } = await import("../src/background.ts");

    const chromeApi = createTestChromeApi();
    const serverClient = {
      getSystemInfo: vi.fn().mockResolvedValue({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        siteConfigs: []
      }),
      revealRoot: vi
        .fn()
        .mockResolvedValue({ ok: true, command: "xdg-open /tmp/server-root" }),
      heartbeat: vi.fn().mockResolvedValue({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        siteConfigs: [],
        activeTrace: null
      }),
      hasFixture: vi.fn(),
      readConfiguredSiteConfigs: vi.fn(),
      readEffectiveSiteConfigs: vi.fn(),
      writeConfiguredSiteConfigs: vi.fn(),
      readFixture: vi.fn(),
      writeFixtureIfAbsent: vi.fn(),
      generateContext: vi.fn(),
      recordTraceClick: vi.fn(),
      linkTraceFixture: vi.fn()
    };

    const background = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(
        createNativeHostConfig({
          hostName: "",
          launchPath: "/tmp/local-launch"
        })
      ),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-popup"),
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(true),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createWraithWalkerServerClient: vi.fn(() => serverClient as any),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const popupRuntime = {
      sendMessage: vi.fn((message) =>
        background.handleRuntimeMessage(message as any)
      ),
      openOptionsPage: vi.fn()
    };

    let popup: Awaited<ReturnType<typeof initPopup>> | undefined;

    try {
      await background.start();

      let connectedSnapshot: SessionSnapshot | null = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const snapshot = await background.handleRuntimeMessage({
          type: "session.getState"
        });
        if (
          snapshot &&
          "captureDestination" in snapshot &&
          snapshot.captureDestination === "server"
        ) {
          connectedSnapshot = snapshot;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(connectedSnapshot).toEqual(
        expect.objectContaining({
          captureDestination: "server",
          captureRootPath: "/tmp/server-root"
        })
      );

      popup = await initPopup({
        document,
        runtime: popupRuntime,
        setIntervalFn: fakeSetInterval,
        getNativeHostConfig: vi.fn().mockResolvedValue(
          createNativeHostConfig({
            hostName: "com.example.host",
            launchPath: "/tmp/local-launch"
          })
        ),
        getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
        ...createRootDeps({ hasHandle: false })
      });

      await user.click(
        await screen.findByRole("button", { name: "Open in folder" })
      );
      expect(
        await screen.findByText(
          "Opened Server Root in the OS file manager."
        )
      ).toBeTruthy();

      expect(serverClient.revealRoot).toHaveBeenCalledTimes(1);
      expect(chromeApi.runtime.sendNativeMessage).not.toHaveBeenCalled();
    } finally {
      popup?.unmount();
    }
  });

  it("opens Cursor at the live server root through the shared background flow", async () => {
    renderRoot();
    const user = userEvent.setup();
    vi.resetModules();
    globalThis.__WRAITHWALKER_TEST__ = true;

    const { initPopup } = await import("../src/popup.ts");
    const { createBackgroundRuntime } = await import("../src/background.ts");

    const chromeApi = createTestChromeApi();
    const serverClient = {
      getSystemInfo: vi.fn().mockResolvedValue({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        siteConfigs: [
          {
            origin: "https://app.example.com",
            createdAt: "2026-04-08T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ]
      }),
      revealRoot: vi
        .fn()
        .mockResolvedValue({ ok: true, command: "xdg-open /tmp/server-root" }),
      heartbeat: vi.fn().mockResolvedValue({
        version: "1.0.0",
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc",
        siteConfigs: [
          {
            origin: "https://app.example.com",
            createdAt: "2026-04-08T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ],
        activeTrace: null
      }),
      hasFixture: vi.fn(),
      readConfiguredSiteConfigs: vi.fn(),
      readEffectiveSiteConfigs: vi.fn(),
      writeConfiguredSiteConfigs: vi.fn(),
      readFixture: vi.fn(),
      writeFixtureIfAbsent: vi.fn(),
      generateContext: vi.fn().mockResolvedValue({ ok: true }),
      recordTraceClick: vi.fn(),
      linkTraceFixture: vi.fn()
    };

    const background = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(
        createNativeHostConfig({
          hostName: "",
          launchPath: ""
        })
      ),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-popup"),
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(true),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createWraithWalkerServerClient: vi.fn(() => serverClient as any),
      createSessionController: vi.fn(() => ({
        startSession: vi.fn(),
        stopSession: vi.fn(),
        reconcileTabs: vi.fn(),
        handleTabStateChange: vi.fn()
      })),
      createRequestLifecycle: vi.fn(() => ({
        handleFetchRequestPaused: vi.fn(),
        handleNetworkRequestWillBeSent: vi.fn(),
        handleNetworkResponseReceived: vi.fn(),
        handleNetworkLoadingFinished: vi.fn(),
        handleNetworkLoadingFailed: vi.fn()
      }))
    });

    const popupRuntime = {
      sendMessage: vi.fn((message) =>
        background.handleRuntimeMessage(message as any)
      ),
      openOptionsPage: vi.fn()
    };

    let popup: Awaited<ReturnType<typeof initPopup>> | undefined;

    try {
      await background.start();

      let connectedSnapshot: SessionSnapshot | null = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const snapshot = await background.handleRuntimeMessage({
          type: "session.getState"
        });
        if (
          snapshot &&
          "captureDestination" in snapshot &&
          snapshot.captureDestination === "server"
        ) {
          connectedSnapshot = snapshot;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(connectedSnapshot).toEqual(
        expect.objectContaining({
          captureDestination: "server",
          captureRootPath: "/tmp/server-root"
        })
      );

      popup = await initPopup({
        document,
        runtime: popupRuntime,
        setIntervalFn: fakeSetInterval,
        getNativeHostConfig: vi.fn().mockResolvedValue(
          createNativeHostConfig({
            hostName: "",
            launchPath: ""
          })
        ),
        getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
        ...createRootDeps({ hasHandle: false })
      });

      await user.click(
        await screen.findByRole("button", { name: "Open in Cursor" })
      );

      expect(serverClient.generateContext).toHaveBeenCalledWith({
        siteConfigs: [
          {
            origin: "https://app.example.com",
            createdAt: "2026-04-08T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ],
        editorId: "cursor"
      });
      expect(chromeApi.tabs.create).toHaveBeenCalledWith({
        url: "cursor://file//tmp/server-root/"
      });
      expect(chromeApi.tabs.create).toHaveBeenCalledTimes(1);
      expect(chromeApi.runtime.sendNativeMessage).not.toHaveBeenCalled();
      expect(
        await screen.findByText("Opened Cursor at Server Root.")
      ).toBeTruthy();
    } finally {
      popup?.unmount();
    }
  });

  it("surfaces shared background reveal errors through the single status area", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(
          createSnapshot({
            captureDestination: "server",
            captureRootPath: "/tmp/server-root"
          })
        )
        .mockResolvedValueOnce({
          ok: false,
          error: "Reveal failed."
        })
        .mockResolvedValueOnce(
          createSnapshot({
            captureDestination: "server",
            captureRootPath: "/tmp/server-root"
          })
        ),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(createNativeHostConfig({ launchPath: "" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps({ hasHandle: false })
    });

    try {
      await user.click(
        await screen.findByRole("button", { name: "Open in folder" })
      );
      expect(await screen.findByText("Reveal failed.")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("prioritizes stored session errors in the single status area", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValue(
          createSnapshot({ lastError: "The last capture failed." })
        ),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(
          createNativeHostConfig({ launchPath: "/tmp/fixtures" })
        ),
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
      sendMessage: vi.fn().mockResolvedValue(
        createSnapshot({
          rootReady: false,
          captureDestination: "none",
          captureRootPath: ""
        })
      ),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(
          createNativeHostConfig({ launchPath: "/tmp/fixtures" })
        ),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps({ permission: "prompt" })
    });

    try {
      expect(
        await screen.findByText(
          /Reconnect Root Directory in Settings before starting capture/i
        )
      ).toBeTruthy();
      expect(screen.getByText("No Active Root")).toBeTruthy();
      expect(
        (
          screen.getByRole("button", {
            name: "Start Session"
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);
    } finally {
      popup.unmount();
    }
  });

  it("shows server-root status when the local WraithWalker server is active", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue(
        createSnapshot({
          rootReady: true,
          captureDestination: "server",
          captureRootPath: "/tmp/server-root"
        })
      ),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(createNativeHostConfig({ launchPath: "" })),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps({ hasHandle: false })
    });

    try {
      expect(await screen.findByLabelText("Workspace status")).toBeTruthy();
      expect(screen.getAllByText("Server Root")).toHaveLength(2);
      expect(screen.getByText("Open actions use Server Root.")).toBeTruthy();
      expect(screen.getByText("/tmp/server-root")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Open in folder" })
      ).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("disables popup actions while the server-folder reveal is in flight", async () => {
    const { PopupApp } = await import("../src/ui/popup-app.tsx");
    const user = userEvent.setup();
    const revealResult = createDeferred<{ ok: true }>();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(
          createSnapshot({
            captureDestination: "server",
            captureRootPath: "/tmp/server-root"
          })
        )
        .mockImplementationOnce(() => revealResult.promise)
        .mockResolvedValueOnce(
          createSnapshot({
            captureDestination: "server",
            captureRootPath: "/tmp/server-root"
          })
        ),
      openOptionsPage: vi.fn()
    };

    const popup = render(
      React.createElement(PopupApp, {
        runtime,
        setIntervalFn: fakeSetInterval,
        clearIntervalFn: vi.fn() as typeof clearInterval,
        getNativeHostConfig: vi
          .fn()
          .mockResolvedValue(createNativeHostConfig({ launchPath: "" })),
        ...createRootDeps({ hasHandle: false })
      })
    );

    try {
      await user.click(
        await screen.findByRole("button", { name: "Open in folder" })
      );

      const openingButton = await screen.findByRole("button", {
        name: "Opening..."
      });
      expect((openingButton as HTMLButtonElement).disabled).toBe(true);
      expect(
        (
          screen.getByRole("button", {
            name: "Start Session"
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);
      expect(
        (
          screen.getByRole("button", {
            name: "Open in Cursor"
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);

      revealResult.resolve({ ok: true });
      await flushPromises();

      expect(
        await screen.findByText(
          "Opened Server Root in the OS file manager."
        )
      ).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("refreshes through the polling interval, clears action alerts, and cleans up the interval", async () => {
    const { PopupApp } = await import("../src/ui/popup-app.tsx");
    const user = userEvent.setup();
    let intervalHandler: (() => void) | undefined;
    const setIntervalCalls: Array<{ timeout?: number }> = [];
    const intervalId = 42 as unknown as ReturnType<typeof setInterval>;
    const setIntervalFn = ((handler: TimerHandler, timeout?: number) => {
      setIntervalCalls.push({ timeout });
      intervalHandler = handler as () => void;
      return intervalId;
    }) as typeof setInterval;
    const clearIntervalFn = vi.fn();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(
          createSnapshot({
            captureDestination: "local",
            captureRootPath: "/tmp/local-root"
          })
        )
        .mockResolvedValueOnce({
          ok: false,
          error: "Cursor prompt launch failed."
        })
        .mockResolvedValueOnce(
          createSnapshot({
            captureDestination: "local",
            captureRootPath: "/tmp/local-root"
          })
        )
        .mockResolvedValueOnce(
          createSnapshot({
            captureDestination: "server",
            captureRootPath: "/tmp/server-root"
          })
        ),
      openOptionsPage: vi.fn()
    };

    const popup = render(
      React.createElement(PopupApp, {
        runtime,
        setIntervalFn,
        clearIntervalFn: clearIntervalFn as typeof clearInterval,
        getNativeHostConfig: vi
          .fn()
          .mockResolvedValue(createNativeHostConfig({ launchPath: "" })),
        ...createRootDeps()
      })
    );

    try {
      expect(setIntervalCalls).toHaveLength(1);
      await user.click(
        await screen.findByRole("button", { name: "Open in Cursor" })
      );
      expect(
        await screen.findByText("Cursor prompt launch failed.")
      ).toBeTruthy();

      expect(intervalHandler).toBeTypeOf("function");
      intervalHandler?.();
      await flushPromises();

      expect(await screen.findAllByText("Server Root")).toHaveLength(2);
      expect(screen.getByText("Open actions use Server Root.")).toBeTruthy();
      expect(screen.queryByText("Cursor prompt launch failed.")).toBeNull();
    } finally {
      popup.unmount();
      await flushPromises();
      expect(clearIntervalFn).toHaveBeenCalledWith(intervalId);
    }
  });

  it("opens the options page from the lightweight settings action", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValue(createSnapshot({ enabledOrigins: [] })),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(
          createNativeHostConfig({ launchPath: "/tmp/fixtures" })
        ),
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

  it("disables Start Session when no origins are enabled", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValue(createSnapshot({ enabledOrigins: [] })),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(
          createNativeHostConfig({ launchPath: "/tmp/fixtures" })
        ),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps()
    });

    try {
      expect(
        await screen.findByText(
          "Add your first origin in Settings before starting capture."
        )
      ).toBeTruthy();
      expect(
        (
          screen.getByRole("button", {
            name: "Start Session"
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);
      expect(screen.getByText("0 enabled")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("disables Start Session when there is no active root yet", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue(
        createSnapshot({
          rootReady: false,
          captureDestination: "none",
          captureRootPath: ""
        })
      ),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(
          createNativeHostConfig({ launchPath: "/tmp/fixtures" })
        ),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      ...createRootDeps({ hasHandle: false })
    });

    try {
      expect(
        await screen.findByText(
          "Choose Root Directory in Settings before starting capture."
        )
      ).toBeTruthy();
      expect(screen.getByText("No Active Root")).toBeTruthy();
      expect(
        (
          screen.getByRole("button", {
            name: "Start Session"
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);
    } finally {
      popup.unmount();
    }
  });

  it("bootstraps automatically outside test mode", async () => {
    renderRoot();
    vi.doMock("../src/lib/chrome-storage.js", () => ({
      getNativeHostConfig: vi
        .fn()
        .mockResolvedValue(
          createNativeHostConfig({ launchPath: "/tmp/fixtures" })
        ),
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

    expect(
      await screen.findByRole("button", { name: "Open in Cursor" })
    ).toBeTruthy();
  });
});
