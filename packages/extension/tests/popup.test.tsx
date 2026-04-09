// @vitest-environment jsdom

import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { DEFAULT_NATIVE_HOST_CONFIG } from "../src/lib/constants.js";
import type { NativeHostConfig, SessionSnapshot } from "../src/lib/types.js";
import { createWraithWalkerServerClient } from "../src/lib/wraithwalker-server.js";
import { startExternalHttpServer } from "../../../test-support/external-http-server.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

function renderRoot() {
  document.body.innerHTML = "<div id=\"root\"></div>";
}

function createEvent() {
  const listeners: Array<(...args: any[]) => void> = [];
  return {
    listeners,
    addListener: vi.fn((listener: (...args: any[]) => void) => {
      listeners.push(listener);
    })
  };
}

function createBackgroundChromeApi() {
  return {
    runtime: {
      getURL: vi.fn((path) => path),
      getManifest: vi.fn(() => ({ version: "0.1.0" })),
      sendMessage: vi.fn(),
      sendNativeMessage: vi.fn(),
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
    }
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
      expect(screen.queryByRole("button", { name: "Open in folder" })).toBeNull();
      expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
      expect(screen.getAllByRole("button")).toHaveLength(3);
      expect(screen.queryByText("Managed Origins")).toBeNull();
      expect(screen.queryByText("Attached Tabs")).toBeNull();
      expect(runtime.sendMessage).toHaveBeenCalledWith({ type: "session.getState" });
    } finally {
      popup.unmount();
    }
  });

  it("falls back to the first configured editor preset when the default preset is absent", async () => {
    const { PopupApp } = await import("../src/ui/popup-app.tsx");
    const popup = render(React.createElement(PopupApp, {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(createSnapshot()),
        openOptionsPage: vi.fn()
      },
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({ launchPath: "/tmp/fixtures" })),
      setIntervalFn: fakeSetInterval,
      clearIntervalFn: vi.fn() as typeof clearInterval,
      editorPresets: [{
        id: "zed",
        label: "Zed",
        urlTemplate: "zed://file/$DIR_URI/",
        commandTemplate: "zed $DIR_PATH"
      }],
      ...createRootDeps()
    }));

    try {
      expect(await screen.findByRole("button", { name: "Open in Zed" })).toBeTruthy();
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

  it("stops the session when the background reports that capture is already active", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi.fn()
        .mockResolvedValueOnce(createSnapshot({ sessionActive: true }))
        .mockResolvedValueOnce(createSnapshot({ sessionActive: false })),
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
      await user.click(await screen.findByRole("button", { name: "Stop Session" }));

      expect(runtime.sendMessage).toHaveBeenNthCalledWith(2, { type: "session.stop" });
      expect(await screen.findByRole("button", { name: "Start Session" })).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("stops the session even when the current snapshot has not loaded yet", async () => {
    const { PopupApp } = await import("../src/ui/popup-app.tsx");
    const user = userEvent.setup();
    const initialSnapshot = createDeferred<SessionSnapshot>();
    const runtime = {
      sendMessage: vi.fn()
        .mockImplementationOnce(() => initialSnapshot.promise)
        .mockResolvedValueOnce(createSnapshot({ sessionActive: true }))
        .mockResolvedValueOnce(createSnapshot({ sessionActive: false })),
      openOptionsPage: vi.fn()
    };

    const popup = render(React.createElement(PopupApp, {
      runtime,
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({ launchPath: "/tmp/fixtures" })),
      setIntervalFn: fakeSetInterval,
      clearIntervalFn: vi.fn() as typeof clearInterval,
      ...createRootDeps()
    }));

    try {
      await user.click(await screen.findByRole("button", { name: "Start Session" }));

      expect(runtime.sendMessage).toHaveBeenNthCalledWith(2, { type: "session.getState" });
      expect(runtime.sendMessage).toHaveBeenNthCalledWith(3, { type: "session.stop" });

      initialSnapshot.resolve(createSnapshot({ sessionActive: false }));
      await flushPromises();
      expect(await screen.findByRole("button", { name: "Start Session" })).toBeTruthy();
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

  it("opens the server root in the OS file manager through the shared background flow", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi.fn()
        .mockResolvedValueOnce(createSnapshot({
          captureDestination: "server",
          captureRootPath: "/tmp/server-root"
        }))
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce(createSnapshot({
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
      await user.click(await screen.findByRole("button", { name: "Open in folder" }));

      expect(runtime.sendMessage).toHaveBeenCalledWith({
        type: "native.revealRoot"
      });
      expect(await screen.findByText("Opened the server root in the OS file manager.")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("reveals the live server root through the native OS handler when the popup is server-connected", async () => {
    renderRoot();
    const user = userEvent.setup();
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-popup-reveal-",
      rootId: "server-root"
    });
    const server = await startExternalHttpServer(serverRoot.rootPath);
    const spawnChild = { unref: vi.fn() };
    const spawnMock = vi.fn().mockReturnValue(spawnChild as any);

    vi.resetModules();
    globalThis.__WRAITHWALKER_TEST__ = true;
    vi.doMock("node:child_process", () => ({
      spawn: spawnMock
    }));

    const { initPopup } = await import("../src/popup.ts");
    const { createBackgroundRuntime } = await import("../src/background.ts");
    const { getRevealDirectoryLaunch, revealDirectory } = await import("../../native-host/src/lib.mts");

    const chromeApi = createBackgroundChromeApi();
    chromeApi.runtime.sendNativeMessage.mockImplementation(async (hostName: string, message: {
      type?: string;
      path?: string;
      expectedRootId?: string;
    }) => {
      expect(hostName).toBe("com.example.host");

      if (message.type === "revealDirectory") {
        return revealDirectory(message);
      }

      return { ok: false, error: `Unexpected native message: ${String(message.type)}` };
    });

    const background = createBackgroundRuntime({
      chromeApi,
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({
        hostName: "com.example.host",
        launchPath: "/tmp/local-launch"
      })),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-popup"),
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(true),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      createWraithWalkerServerClient: vi.fn(() => createWraithWalkerServerClient(server.trpcUrl, {
        timeoutMs: 2_000,
        fetchImpl: (input, init) => fetch(input, {
          ...init,
          signal: undefined
        })
      })),
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
      sendMessage: vi.fn((message) => background.handleRuntimeMessage(message as any)),
      openOptionsPage: vi.fn()
    };

    let popup: Awaited<ReturnType<typeof initPopup>> | undefined;

    try {
      await background.start();

      let connectedSnapshot: SessionSnapshot | null = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const snapshot = await background.handleRuntimeMessage({ type: "session.getState" });
        if (snapshot && "captureDestination" in snapshot && snapshot.captureDestination === "server") {
          connectedSnapshot = snapshot;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(connectedSnapshot).toEqual(expect.objectContaining({
        captureDestination: "server",
        captureRootPath: server.rootPath
      }));

      popup = await initPopup({
        document,
        runtime: popupRuntime,
        setIntervalFn: fakeSetInterval,
        getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({
          hostName: "com.example.host",
          launchPath: "/tmp/local-launch"
        })),
        getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
        ...createRootDeps({ hasHandle: false })
      });

      await user.click(await screen.findByRole("button", { name: "Open in folder" }));
      expect(await screen.findByText("Opened the server root in the OS file manager.")).toBeTruthy();

      expect(chromeApi.runtime.sendNativeMessage).toHaveBeenCalledWith("com.example.host", {
        type: "revealDirectory",
        path: server.rootPath,
        expectedRootId: serverRoot.rootId
      });

      const launch = getRevealDirectoryLaunch(server.rootPath);
      expect(spawnMock).toHaveBeenCalledWith(launch.program, launch.args, {
        detached: true,
        stdio: "ignore"
      });
      expect(spawnChild.unref).toHaveBeenCalled();
    } finally {
      popup?.unmount();
      await server.close();
    }
  });

  it("surfaces shared background reveal errors through the single status area", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi.fn()
        .mockResolvedValueOnce(createSnapshot({
          captureDestination: "server",
          captureRootPath: "/tmp/server-root"
        }))
        .mockResolvedValueOnce({
          ok: false,
          error: "Reveal failed."
        })
        .mockResolvedValueOnce(createSnapshot({
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
      await user.click(await screen.findByRole("button", { name: "Open in folder" }));
      expect(await screen.findByText("Reveal failed.")).toBeTruthy();
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
      expect(screen.getByRole("button", { name: "Open in folder" })).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("disables popup actions while the server-folder reveal is in flight", async () => {
    const { PopupApp } = await import("../src/ui/popup-app.tsx");
    const user = userEvent.setup();
    const revealResult = createDeferred<{ ok: true }>();
    const runtime = {
      sendMessage: vi.fn()
        .mockResolvedValueOnce(createSnapshot({
          captureDestination: "server",
          captureRootPath: "/tmp/server-root"
        }))
        .mockImplementationOnce(() => revealResult.promise)
        .mockResolvedValueOnce(createSnapshot({
          captureDestination: "server",
          captureRootPath: "/tmp/server-root"
        })),
      openOptionsPage: vi.fn()
    };

    const popup = render(React.createElement(PopupApp, {
      runtime,
      setIntervalFn: fakeSetInterval,
      clearIntervalFn: vi.fn() as typeof clearInterval,
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({ launchPath: "" })),
      ...createRootDeps({ hasHandle: false })
    }));

    try {
      await user.click(await screen.findByRole("button", { name: "Open in folder" }));

      const openingButton = await screen.findByRole("button", { name: "Opening..." });
      expect((openingButton as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Start Session" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Open in Cursor" }) as HTMLButtonElement).disabled).toBe(true);

      revealResult.resolve({ ok: true });
      await flushPromises();

      expect(await screen.findByText("Opened the server root in the OS file manager.")).toBeTruthy();
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
      sendMessage: vi.fn()
        .mockResolvedValueOnce(createSnapshot({
          captureDestination: "local",
          captureRootPath: "/tmp/local-root"
        }))
        .mockResolvedValueOnce({ ok: false, error: "Cursor prompt launch failed." })
        .mockResolvedValueOnce(createSnapshot({
          captureDestination: "local",
          captureRootPath: "/tmp/local-root"
        }))
        .mockResolvedValueOnce(createSnapshot({
          captureDestination: "server",
          captureRootPath: "/tmp/server-root"
        })),
      openOptionsPage: vi.fn()
    };

    const popup = render(React.createElement(PopupApp, {
      runtime,
      setIntervalFn,
      clearIntervalFn: clearIntervalFn as typeof clearInterval,
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({ launchPath: "" })),
      ...createRootDeps()
    }));

    try {
      expect(setIntervalCalls).toHaveLength(1);
      await user.click(await screen.findByRole("button", { name: "Open in Cursor" }));
      expect(await screen.findByText("Cursor prompt launch failed.")).toBeTruthy();

      expect(intervalHandler).toBeTypeOf("function");
      intervalHandler?.();
      await flushPromises();

      expect(await screen.findByText("Connected.")).toBeTruthy();
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
