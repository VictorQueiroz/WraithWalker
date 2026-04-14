import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthorityHarness } from "./helpers/background-authority-test-helpers.js";
import { createChromeApi } from "./helpers/background-service-test-helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("background authority local root", () => {
  it("reuses an existing offscreen document instead of creating a second one", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{}]);
    chromeApi.runtime.sendMessage.mockResolvedValue({ ok: true });

    const { authority } = createAuthorityHarness({ chromeApi });

    await authority.sendOffscreenMessage("fs.ensureRoot", {
      requestPermission: true
    });
    await authority.sendOffscreenMessage("fs.ensureRoot", {
      requestPermission: false
    });

    expect(chromeApi.offscreen.createDocument).toHaveBeenCalledTimes(1);
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("reuses an in-flight offscreen document creation and waits before closing it", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValueOnce([]);

    let finishCreate: (() => void) | null = null;
    chromeApi.offscreen.createDocument.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finishCreate = resolve;
      });
    });
    chromeApi.runtime.sendMessage.mockResolvedValue({ ok: true });

    const { authority } = createAuthorityHarness({ chromeApi });

    const firstMessage = authority.sendOffscreenMessage("fs.ensureRoot", {
      requestPermission: true
    });
    await vi.waitFor(() => {
      expect(chromeApi.offscreen.createDocument).toHaveBeenCalledTimes(1);
      expect(finishCreate).not.toBeNull();
    });
    const secondMessage = authority.sendOffscreenMessage("fs.ensureRoot", {
      requestPermission: false
    });
    finishCreate?.();

    await Promise.all([firstMessage, secondMessage]);
    chromeApi.runtime.getContexts.mockResolvedValueOnce([{}]);
    await authority.closeOffscreenDocument();

    expect(chromeApi.offscreen.createDocument).toHaveBeenCalledTimes(1);
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(chromeApi.offscreen.closeDocument).toHaveBeenCalledTimes(1);
  });

  it("propagates unexpected offscreen creation errors", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([]);
    chromeApi.offscreen.createDocument.mockRejectedValue(
      new Error("Offscreen denied.")
    );

    const { authority } = createAuthorityHarness({ chromeApi });

    await expect(
      authority.sendOffscreenMessage("fs.ensureRoot")
    ).rejects.toThrow("Offscreen denied.");
  });

  it("returns local-root errors when no offscreen root result is available", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockResolvedValue(null);
    const { authority, setLastError } = createAuthorityHarness({ chromeApi });

    await expect(authority.ensureLocalRootReady()).resolves.toEqual({
      ok: false,
      error: "No root directory selected."
    });
    expect(setLastError).toHaveBeenCalledWith("No root directory selected.");
  });

  it("fails legacy site-config migration when the local write returns no result", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return {
          ok: true,
          sentinel: { rootId: "local-root" },
          permission: "granted"
        };
      }
      if (message?.type === "fs.readConfiguredSiteConfigs") {
        return {
          ok: true,
          siteConfigs: [],
          sentinel: { rootId: "local-root" }
        };
      }
      if (message?.type === "fs.writeConfiguredSiteConfigs") {
        return null;
      }
      return { ok: true };
    });
    const { authority } = createAuthorityHarness({
      chromeApi,
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      },
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(false),
      getLegacySiteConfigs: vi.fn().mockResolvedValue([
        {
          origin: "https://legacy.example.com",
          createdAt: "2026-04-09T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }
      ])
    });

    await expect(
      authority.readConfiguredSiteConfigsForAuthority()
    ).rejects.toThrow("Failed to update root config.");
  });

  it("fails legacy site-config migration when the local write returns an explicit error", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return {
          ok: true,
          sentinel: { rootId: "local-root" },
          permission: "granted"
        };
      }
      if (message?.type === "fs.readConfiguredSiteConfigs") {
        return {
          ok: true,
          siteConfigs: [],
          sentinel: { rootId: "local-root" }
        };
      }
      if (message?.type === "fs.writeConfiguredSiteConfigs") {
        return { ok: false, error: "Failed to write merged site config." };
      }
      return { ok: true };
    });
    const { authority } = createAuthorityHarness({
      chromeApi,
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      },
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(false),
      getLegacySiteConfigs: vi.fn().mockResolvedValue([
        {
          origin: "https://legacy.example.com",
          createdAt: "2026-04-09T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }
      ])
    });

    await expect(
      authority.readConfiguredSiteConfigsForAuthority()
    ).rejects.toThrow("Failed to write merged site config.");
  });
});
