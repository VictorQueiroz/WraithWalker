// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

function renderPopupMarkup() {
  document.body.innerHTML = `
    <section>
      <div id="session-pill" data-state="inactive">Inactive</div>
      <strong id="attached-tabs-count">0</strong>
      <strong id="enabled-origins-count">0</strong>
      <strong id="root-status">Unknown</strong>
      <strong id="helper-status">Unknown</strong>
      <button id="toggle-session" type="button">Start session</button>
      <button id="open-options" type="button">Options</button>
      <button id="verify-root" type="button">Check root access</button>
      <button id="open-editor" type="button">Open in editor</button>
      <div id="message-box"></div>
      <div id="managed-sites"></div>
    </section>
  `;
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadPopupModule() {
  vi.resetModules();
  globalThis.__WRAITHWALKER_TEST__ = true;
  return import("../src/popup.ts");
}

afterEach(() => {
  delete globalThis.__WRAITHWALKER_TEST__;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("popup entrypoint", () => {
  it("renders the initial session snapshot and schedules refreshes", async () => {
    renderPopupMarkup();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue({
        sessionActive: true,
        attachedTabIds: [1, 2],
        enabledOrigins: ["https://app.example.com"],
        rootReady: true,
        helperReady: true,
        lastError: ""
      }),
      openOptionsPage: vi.fn()
    };
    const setIntervalFn = vi.fn();

    const popup = await initPopup({ document, runtime, setIntervalFn, refreshIntervalMs: 2500 });

    expect(document.querySelector("#session-pill")?.textContent).toBe("Active");
    expect(document.querySelector("#attached-tabs-count")?.textContent).toBe("2");
    expect(document.querySelector("#enabled-origins-count")?.textContent).toBe("1");
    expect(document.querySelector("#root-status")?.textContent).toBe("Ready");
    expect(document.querySelector("#helper-status")?.textContent).toBe("Ready");
    expect(document.querySelector("#managed-sites")?.textContent).toContain("https://app.example.com");
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 2500);

    popup.renderState({
      sessionActive: false,
      attachedTabIds: [],
      enabledOrigins: [],
      rootReady: false,
      helperReady: false,
      lastError: "Manual error"
    });
    expect(document.querySelector("#message-box")?.textContent).toContain("Manual error");
  });

  it("toggles the session through background messages", async () => {
    renderPopupMarkup();
    const { initPopup } = await loadPopupModule();
    const idle = {
      sessionActive: false,
      attachedTabIds: [],
      enabledOrigins: ["https://app.example.com"],
      rootReady: true,
      helperReady: false,
      lastError: ""
    };
    const active = {
      ...idle,
      sessionActive: true,
      attachedTabIds: [10]
    };
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(idle)
        .mockResolvedValueOnce(idle)
        .mockResolvedValueOnce(active),
      openOptionsPage: vi.fn()
    };

    await initPopup({ document, runtime, setIntervalFn: vi.fn() });
    document.querySelector("#toggle-session")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();

    expect(runtime.sendMessage).toHaveBeenNthCalledWith(1, { type: "session.getState" });
    expect(runtime.sendMessage).toHaveBeenNthCalledWith(2, { type: "session.getState" });
    expect(runtime.sendMessage).toHaveBeenNthCalledWith(3, { type: "session.start" });
    expect(document.querySelector("#toggle-session")?.textContent).toBe("Stop session");
  });

  it("opens the options page and reports root verification failures", async () => {
    renderPopupMarkup();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce({
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: false,
          helperReady: false,
          lastError: ""
        })
        .mockResolvedValueOnce({ ok: false, error: "Root directory access is not granted." }),
      openOptionsPage: vi.fn()
    };

    await initPopup({ document, runtime, setIntervalFn: vi.fn() });
    document.querySelector("#open-options")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.querySelector("#verify-root")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();

    expect(runtime.openOptionsPage).toHaveBeenCalled();
    expect(document.querySelector("#message-box")?.textContent).toContain("Root directory access is not granted.");
  });

  it("shows native-open errors returned by the background runtime", async () => {
    renderPopupMarkup();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce({
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: true,
          helperReady: false,
          lastError: ""
        })
        .mockResolvedValueOnce({ ok: false, error: "Editor launch failed." })
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

    await initPopup({ document, runtime, setIntervalFn: vi.fn() });
    document.querySelector("#open-editor")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();

    expect(runtime.sendMessage).toHaveBeenNthCalledWith(2, { type: "native.open" });
    expect(document.querySelector("#message-box")?.textContent).toContain("Editor launch failed.");
  });

  it("renders empty-site and idle states from the returned renderer", async () => {
    renderPopupMarkup();
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

    const popup = await initPopup({ document, runtime, setIntervalFn: vi.fn() });
    popup.renderState({
      sessionActive: false,
      attachedTabIds: [],
      enabledOrigins: [],
      rootReady: false,
      helperReady: false,
      lastError: ""
    });
    expect(document.querySelector("#managed-sites")?.textContent).toContain("No origins enabled.");
    expect(document.querySelector("#message-box")?.textContent?.toLowerCase()).toContain("no active sites");

    popup.renderState({
      sessionActive: false,
      attachedTabIds: [],
      enabledOrigins: ["https://app.example.com"],
      rootReady: true,
      helperReady: false,
      lastError: ""
    });
    expect(document.querySelector("#message-box")?.textContent).toContain("Session is idle.");
  });

  it("reports toggle failures from the background runtime", async () => {
    renderPopupMarkup();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce({
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: true,
          helperReady: false,
          lastError: ""
        })
        .mockResolvedValueOnce({
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: true,
          helperReady: false,
          lastError: ""
        })
        .mockRejectedValueOnce(new Error("Start failed.")),
      openOptionsPage: vi.fn()
    };

    await initPopup({ document, runtime, setIntervalFn: vi.fn() });
    document.querySelector("#toggle-session")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();

    expect(document.querySelector("#message-box")?.textContent).toContain("Start failed.");
  });

  it("shows successful root verification and editor-open actions", async () => {
    renderPopupMarkup();
    const { initPopup } = await loadPopupModule();
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce({
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: false,
          helperReady: false,
          lastError: ""
        })
        .mockResolvedValueOnce({ ok: true, sentinel: { rootId: "root-42" }, permission: "granted" })
        .mockResolvedValueOnce({
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: true,
          helperReady: false,
          lastError: ""
        })
        .mockResolvedValueOnce({ ok: true })
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

    await initPopup({ document, runtime, setIntervalFn: vi.fn() });
    document.querySelector("#verify-root")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(document.querySelector("#message-box")?.textContent).toContain("root-42");

    document.querySelector("#open-editor")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(document.querySelector("#message-box")?.textContent).toContain("Editor command dispatched.");
  });
});
