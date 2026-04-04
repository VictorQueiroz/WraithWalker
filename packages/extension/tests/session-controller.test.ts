import { describe, expect, it, vi } from "vitest";

import { createSessionController } from "../src/lib/session-controller.js";

function createBaseState() {
  return {
    sessionActive: false,
    attachedTabs: new Map(),
    requests: new Map([["1:abc", { id: "abc" }]]),
    enabledOrigins: [],
    lastError: "",
    rootReady: false
  };
}

interface ControllerHarnessOverrides {
  state?: ReturnType<typeof createBaseState>;
  enabledOrigins?: string[];
  tabs?: Array<{ id?: number; url?: string }>;
  rootResult?: { ok: boolean; error?: string; sentinel?: { rootId: string } };
}

function createControllerHarness(overrides: ControllerHarnessOverrides = {}) {
  const state = overrides.state || createBaseState();
  if (overrides.enabledOrigins) {
    state.enabledOrigins = overrides.enabledOrigins;
  }
  const listTabs = vi.fn().mockResolvedValue(overrides.tabs || []);
  const attachTab = vi.fn().mockResolvedValue(undefined);
  const detachTab = vi.fn().mockResolvedValue(undefined);
  const refreshStoredConfig = vi.fn().mockImplementation(async () => {
    if (overrides.enabledOrigins) {
      state.enabledOrigins = overrides.enabledOrigins;
    }
  });
  const ensureRootReady = vi.fn().mockResolvedValue(overrides.rootResult || { ok: true, sentinel: { rootId: "root-1" } });
  const closeOffscreenDocument = vi.fn().mockResolvedValue(undefined);
  const persistSnapshot = vi.fn().mockResolvedValue(undefined);
  const setLastError = vi.fn().mockImplementation((message) => {
    state.lastError = message || "";
  });
  const snapshotState = vi.fn().mockImplementation(async () => ({
    sessionActive: state.sessionActive,
    attachedTabIds: [...state.attachedTabs.keys()],
    enabledOrigins: [...state.enabledOrigins],
    rootReady: state.rootReady,
    helperReady: false,
    lastError: state.lastError
  }));

  const controller = createSessionController({
    state,
    listTabs,
    attachTab,
    detachTab,
    refreshStoredConfig,
    ensureRootReady,
    closeOffscreenDocument,
    persistSnapshot,
    setLastError,
    snapshotState
  });

  return {
    state,
    controller,
    listTabs,
    attachTab,
    detachTab,
    refreshStoredConfig,
    ensureRootReady,
    closeOffscreenDocument,
    persistSnapshot,
    setLastError,
    snapshotState
  };
}

describe("session controller", () => {
  it("exposes exact-origin matching through getMatchingOrigin", () => {
    const harness = createControllerHarness({
      enabledOrigins: ["https://app.example.com"]
    });

    expect(harness.controller.getMatchingOrigin("https://app.example.com/path")).toBe("https://app.example.com");
    expect(harness.controller.getMatchingOrigin("notaurl")).toBeNull();
  });

  it("blocks session start when no origins are enabled", async () => {
    const harness = createControllerHarness();
    const snapshot = await harness.controller.startSession();

    expect(harness.setLastError).toHaveBeenCalledWith("Add at least one enabled origin in the options page.");
    expect(harness.ensureRootReady).not.toHaveBeenCalled();
    expect(snapshot.sessionActive).toBe(false);
  });

  it("starts the session and attaches to matching tabs", async () => {
    const harness = createControllerHarness({
      enabledOrigins: ["https://app.example.com"],
      tabs: [
        { id: 1, url: "https://app.example.com/dashboard" },
        { id: 2, url: "https://other.example.com/" }
      ]
    });

    const snapshot = await harness.controller.startSession();

    expect(harness.attachTab).toHaveBeenCalledTimes(1);
    expect(harness.attachTab).toHaveBeenCalledWith(1, "https://app.example.com");
    expect(harness.persistSnapshot).toHaveBeenCalled();
    expect(snapshot.sessionActive).toBe(true);
  });

  it("requests filesystem permission when starting a session", async () => {
    const harness = createControllerHarness({
      enabledOrigins: ["https://app.example.com"]
    });

    await harness.controller.startSession();

    expect(harness.ensureRootReady).toHaveBeenCalledWith({ requestPermission: true });
  });

  it("returns an idle snapshot when root readiness fails", async () => {
    const harness = createControllerHarness({
      enabledOrigins: ["https://app.example.com"],
      tabs: [{ id: 1, url: "https://app.example.com/dashboard" }],
      rootResult: { ok: false, error: "Root directory access is not granted." }
    });

    const snapshot = await harness.controller.startSession();

    expect(harness.ensureRootReady).toHaveBeenCalled();
    expect(harness.attachTab).not.toHaveBeenCalled();
    expect(harness.persistSnapshot).not.toHaveBeenCalled();
    expect(snapshot.sessionActive).toBe(false);
  });

  it("stops the session, clears requests, and detaches tabs", async () => {
    const state = createBaseState();
    state.sessionActive = true;
    state.attachedTabs.set(10, { topOrigin: "https://app.example.com" });
    state.attachedTabs.set(11, { topOrigin: "https://app.example.com" });
    const harness = createControllerHarness({ state });

    const snapshot = await harness.controller.stopSession();

    expect(harness.detachTab).toHaveBeenCalledTimes(2);
    expect(harness.closeOffscreenDocument).toHaveBeenCalled();
    expect(state.requests.size).toBe(0);
    expect(snapshot.sessionActive).toBe(false);
  });

  it("reconciles tabs and detaches ones that no longer match", async () => {
    const state = createBaseState();
    state.enabledOrigins = ["https://app.example.com"];
    state.attachedTabs.set(5, { topOrigin: "https://app.example.com" });
    state.attachedTabs.set(6, { topOrigin: "https://app.example.com" });
    const harness = createControllerHarness({
      state,
      tabs: [{ id: 5, url: "https://app.example.com/dashboard" }]
    });

    await harness.controller.reconcileTabs();

    expect(harness.attachTab).toHaveBeenCalledWith(5, "https://app.example.com");
    expect(harness.detachTab).toHaveBeenCalledWith(6);
  });

  it("records attach failures during tab reconciliation", async () => {
    const state = createBaseState();
    state.enabledOrigins = ["https://app.example.com"];
    const harness = createControllerHarness({
      state,
      tabs: [{ id: 7, url: "https://app.example.com/dashboard" }]
    });
    harness.attachTab.mockRejectedValueOnce(new Error("attach failed"));

    await harness.controller.reconcileTabs();

    expect(harness.setLastError).toHaveBeenCalledWith("attach failed");
  });

  it("handles tab updates by attaching or detaching based on origin match", async () => {
    const state = createBaseState();
    state.sessionActive = true;
    state.enabledOrigins = ["https://app.example.com"];
    const harness = createControllerHarness({ state });

    await harness.controller.handleTabStateChange(8, { url: "https://app.example.com/page" });
    await harness.controller.handleTabStateChange(9, { url: "https://other.example.com/" });

    expect(harness.attachTab).toHaveBeenCalledWith(8, "https://app.example.com");
    expect(harness.detachTab).toHaveBeenCalledWith(9);
  });

  it("ignores tab updates while the session is inactive", async () => {
    const harness = createControllerHarness({
      enabledOrigins: ["https://app.example.com"]
    });

    await harness.controller.handleTabStateChange(10, { url: "https://app.example.com/path" });

    expect(harness.attachTab).not.toHaveBeenCalled();
    expect(harness.detachTab).not.toHaveBeenCalled();
  });
});
