import { afterEach, describe, expect, it, vi } from "vitest";

import { createBackgroundAuthority } from "../src/lib/background-authority.js";
import { createBackgroundState, createChromeApi, createMockServerClient } from "./helpers/background-service-test-helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("background authority", () => {
  it("reuses an existing offscreen document instead of creating a second one", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{}]);
    chromeApi.runtime.sendMessage.mockResolvedValue({ ok: true });

    const authority = createBackgroundAuthority({
      state: createBackgroundState(),
      chromeApi,
      serverClient: createMockServerClient(),
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(true),
      getNativeHostConfig: vi.fn().mockResolvedValue({ hostName: "", launchPath: "", editorLaunchOverrides: {} }),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(undefined),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      normalizeSiteConfigs: vi.fn((siteConfigs) => siteConfigs as any),
      setLastError: vi.fn(),
      syncTraceBindings: vi.fn().mockResolvedValue(undefined),
      reconcileTabs: vi.fn().mockResolvedValue(undefined)
    });

    await authority.sendOffscreenMessage("fs.ensureRoot", { requestPermission: true });
    await authority.sendOffscreenMessage("fs.ensureRoot", { requestPermission: false });

    expect(chromeApi.offscreen.createDocument).toHaveBeenCalledTimes(1);
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("falls back to local configured site configs when a server-backed read fails", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return { ok: true, sentinel: { rootId: "local-root" }, permission: "granted" };
      }
      if (message?.type === "fs.readConfiguredSiteConfigs") {
        return {
          ok: true,
          siteConfigs: [{
            origin: "https://local.example.com",
            createdAt: "2026-04-09T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }],
          sentinel: { rootId: "local-root" }
        };
      }
      return { ok: true };
    });

    const authority = createBackgroundAuthority({
      state: createBackgroundState(),
      chromeApi,
      serverClient: createMockServerClient({
        readConfiguredSiteConfigs: vi.fn().mockRejectedValue(new Error("server offline"))
      }),
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(true),
      getNativeHostConfig: vi.fn().mockResolvedValue({ hostName: "", launchPath: "", editorLaunchOverrides: {} }),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(undefined),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      normalizeSiteConfigs: vi.fn((siteConfigs) => siteConfigs as any),
      setLastError: vi.fn(),
      syncTraceBindings: vi.fn().mockResolvedValue(undefined),
      reconcileTabs: vi.fn().mockResolvedValue(undefined)
    });

    const result = await authority.readConfiguredSiteConfigsForAuthority();

    expect(result).toEqual({
      ok: true,
      siteConfigs: [{
        origin: "https://local.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }],
      sentinel: { rootId: "local-root" }
    });
  });

  it("reports missing roots, missing configs, and server disconnects in diagnostics", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return { ok: false, error: "No root directory selected." };
      }
      if (message?.type === "fs.readConfiguredSiteConfigs" || message?.type === "fs.readEffectiveSiteConfigs") {
        return {
          ok: true,
          siteConfigs: [],
          sentinel: { rootId: "local-root" }
        };
      }
      return { ok: true };
    });

    const state = createBackgroundState({
      lastError: "transport unavailable",
      nativeHostConfig: { hostName: "", launchPath: "", editorLaunchOverrides: {} }
    });
    const authority = createBackgroundAuthority({
      state,
      chromeApi,
      serverClient: createMockServerClient({
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      }),
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(true),
      getNativeHostConfig: vi.fn().mockResolvedValue({ hostName: "", launchPath: "", editorLaunchOverrides: {} }),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(undefined),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      normalizeSiteConfigs: vi.fn((siteConfigs) => siteConfigs as any),
      setLastError: vi.fn((message) => {
        state.lastError = message;
      }),
      syncTraceBindings: vi.fn().mockResolvedValue(undefined),
      reconcileTabs: vi.fn().mockResolvedValue(undefined)
    });

    const report = await authority.getDiagnosticsReport();

    expect(report.issues).toEqual(expect.arrayContaining([
      "No active capture root is ready.",
      "No enabled origins are configured.",
      "Native host name is not configured.",
      "Local WraithWalker server is not connected.",
      "Last runtime error: transport unavailable"
    ]));
  });
});
