// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

function renderRoot() {
  document.body.innerHTML = "<div id=\"root\"></div>";
}

const fakeSetInterval = ((_handler: TimerHandler, _timeout?: number) => {
  return 1;
}) as typeof setInterval;

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
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor")
    })).rejects.toThrow("Popup root container not found.");
  });

  it("renders the simplified popup with one-click editor open", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue({
        sessionActive: true,
        attachedTabIds: [1, 2],
        enabledOrigins: ["https://app.example.com", "https://admin.example.com"],
        rootReady: true,
        helperReady: true,
        lastError: ""
      }),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor")
    });

    try {
      expect(await screen.findByRole("button", { name: "Stop Session" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open in Cursor" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
      expect(screen.getAllByRole("button")).toHaveLength(3);
      expect(screen.queryByText("Check root access")).toBeNull();
      expect(screen.queryByText("Save Scenario")).toBeNull();
      expect(screen.queryByLabelText("Choose editor")).toBeNull();
      expect(screen.queryByText("Attached Tabs")).toBeNull();
      expect(screen.queryByText("Managed Origins")).toBeNull();
      expect(screen.queryByText("Origins")).toBeNull();
      expect(runtime.sendMessage).toHaveBeenCalledWith({ type: "session.getState" });
    } finally {
      popup.unmount();
    }
  });

  it("opens the preferred editor without sending command templates", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi.fn()
        .mockResolvedValueOnce({
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: true,
          helperReady: true,
          lastError: ""
        })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: true,
          helperReady: true,
          lastError: ""
        }),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor")
    });

    try {
      await screen.findByRole("button", { name: "Open in Cursor" });
      await user.click(screen.getByRole("button", { name: "Open in Cursor" }));

      expect(runtime.sendMessage).toHaveBeenCalledWith({
        type: "native.open",
        editorId: "cursor"
      });
      expect(await screen.findByText("Opened the capture root in Cursor.")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("shows native open failures inline", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi.fn()
        .mockResolvedValueOnce({
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: true,
          helperReady: false,
          lastError: ""
        })
        .mockResolvedValueOnce({ ok: false, error: "Open failed." })
        .mockResolvedValueOnce({
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: true,
          helperReady: false,
          lastError: ""
        }),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor")
    });

    try {
      await screen.findByRole("button", { name: "Open in Cursor" });
      await user.click(screen.getByRole("button", { name: "Open in Cursor" }));
      expect(await screen.findByText("Open failed.")).toBeTruthy();
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
        .mockResolvedValueOnce({
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: true,
          helperReady: true,
          lastError: ""
        })
        .mockRejectedValueOnce(new Error("Session failed.")),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor")
    });

    try {
      await screen.findByRole("button", { name: "Start Session" });
      await user.click(screen.getByRole("button", { name: "Start Session" }));
      expect(await screen.findByText("Session failed.")).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("prioritizes stored session errors in the single status area", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue({
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: [
          "https://app.example.com",
          "https://admin.example.com",
          "https://cdn.example.com",
          "https://assets.example.com"
        ],
        rootReady: true,
        helperReady: true,
        lastError: "The last capture failed."
      }),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor")
    });

    try {
      expect(await screen.findByText("The last capture failed.")).toBeTruthy();
      expect(screen.queryByText("Managed Origins")).toBeNull();
    } finally {
      popup.unmount();
    }
  });

  it("shows editor setup guidance when the preferred editor lacks URL launch support", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue({
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: ["https://app.example.com"],
        rootReady: true,
        helperReady: false,
        lastError: ""
      }),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getPreferredEditorId: vi.fn().mockResolvedValue("windsurf")
    });

    try {
      expect(await screen.findByText(/Windsurf needs a custom URL override or a verified native host/i)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open in Windsurf" })).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("surfaces blocked root and unsupported launch states as guidance", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue({
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: ["https://app.example.com"],
        rootReady: false,
        helperReady: false,
        lastError: ""
      }),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor")
    });

    try {
      expect(await screen.findByText(/Reconnect the capture root in Settings/i)).toBeTruthy();
    } finally {
      popup.unmount();
    }
  });

  it("opens the options page from the lightweight settings action", async () => {
    renderRoot();
    const { initPopup } = await loadPopupModule();
    const user = userEvent.setup();
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue({
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: [],
        rootReady: false,
        helperReady: false,
        lastError: ""
      }),
      openOptionsPage: vi.fn()
    };

    const popup = await initPopup({
      document,
      runtime,
      setIntervalFn: fakeSetInterval,
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await screen.findByRole("button", { name: "Settings" });
      await user.click(screen.getByRole("button", { name: "Settings" }));
      expect(runtime.openOptionsPage).toHaveBeenCalled();
    } finally {
      popup.unmount();
    }
  });

  it("bootstraps automatically outside test mode", async () => {
    renderRoot();
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: [],
          rootReady: false,
          helperReady: false,
          lastError: ""
        }),
        openOptionsPage: vi.fn()
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined)
        }
      }
    } as any;

    await loadPopupModuleOutsideTestMode();

    expect(await screen.findByRole("button", { name: "Open in Cursor" })).toBeTruthy();
  });
});
