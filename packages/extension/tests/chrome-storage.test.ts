import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DUMP_ALLOWLIST_PATTERN, DEFAULT_NATIVE_HOST_CONFIG, STORAGE_KEYS } from "../src/lib/constants.js";
import {
  getNativeHostConfig,
  getPreferredEditorId,
  getSiteConfigs,
  setLastSessionSnapshot,
  setNativeHostConfig,
  setPreferredEditorId,
  setSiteConfigs
} from "../src/lib/chrome-storage.js";
import type { SiteConfig } from "../src/lib/types.js";

describe("chrome storage helpers", () => {
  const storageGet = vi.fn();
  const storageSet = vi.fn();

  beforeEach(() => {
    storageGet.mockReset();
    storageSet.mockReset();
    globalThis.chrome = {
      storage: {
        local: {
          get: storageGet,
          set: storageSet
        }
      }
    } as any;
  });

  afterEach(() => {
    delete globalThis.chrome;
  });

  it("returns an empty site list by default", async () => {
    storageGet.mockResolvedValue({});

    await expect(getSiteConfigs()).resolves.toEqual([]);
    expect(storageGet).toHaveBeenCalledWith([STORAGE_KEYS.SITES]);
  });

  it("normalizes legacy stored site configs on read", async () => {
    storageGet.mockResolvedValue({
      [STORAGE_KEYS.SITES]: [
        { origin: "app.example.com", createdAt: "2026-04-03T00:00:00.000Z" }
      ]
    });

    await expect(getSiteConfigs()).resolves.toEqual([
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-03T00:00:00.000Z",
        mode: "advanced",
        dumpAllowlistPatterns: [DEFAULT_DUMP_ALLOWLIST_PATTERN]
      }
    ]);
  });

  it("merges native host defaults with stored values", async () => {
    storageGet.mockResolvedValue({
      [STORAGE_KEYS.NATIVE_HOST]: {
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      }
    });

    await expect(getNativeHostConfig()).resolves.toEqual({
      ...DEFAULT_NATIVE_HOST_CONFIG,
      hostName: "com.example.host",
      launchPath: "/tmp/fixtures"
    });
  });

  it("migrates legacy global launch templates into the preferred editor override on read", async () => {
    storageGet.mockResolvedValue({
      [STORAGE_KEYS.PREFERRED_EDITOR]: "cursor",
      [STORAGE_KEYS.NATIVE_HOST]: {
        hostName: "com.example.host",
        rootPath: "/tmp/fixtures",
        commandTemplate: 'cursor "$DIR"',
        urlTemplate: "cursor://workspace?folder=$DIR_COMPONENT"
      }
    });

    await expect(getNativeHostConfig()).resolves.toEqual({
      ...DEFAULT_NATIVE_HOST_CONFIG,
      hostName: "com.example.host",
      launchPath: "/tmp/fixtures",
      editorLaunchOverrides: {
        cursor: {
          commandTemplate: 'cursor "$DIR"',
          urlTemplate: "cursor://workspace?folder=$DIR_COMPONENT"
        }
      }
    });
  });

  it("persists site configs, native host config, and session snapshots", async () => {
    storageGet.mockResolvedValue({ [STORAGE_KEYS.PREFERRED_EDITOR]: "vscode" });
    const sites: SiteConfig[] = [{
      origin: "https://app.example.com",
      createdAt: "2026-04-03T00:00:00.000Z",
      mode: "simple",
      dumpAllowlistPatterns: [DEFAULT_DUMP_ALLOWLIST_PATTERN]
    }];
    const nativeHostConfig = {
      ...DEFAULT_NATIVE_HOST_CONFIG,
      hostName: "com.example.host",
      editorLaunchOverrides: {
        vscode: {
          urlTemplate: "vscode://file/$DIR_URI/"
        }
      }
    };
    const snapshot = {
      sessionActive: true,
      attachedTabIds: [1, 2],
      enabledOrigins: ["https://app.example.com"],
      rootReady: true,
      lastError: ""
    };

    await setSiteConfigs(sites);
    await setNativeHostConfig(nativeHostConfig);
    await setLastSessionSnapshot(snapshot);

    expect(storageSet).toHaveBeenNthCalledWith(1, { [STORAGE_KEYS.SITES]: sites });
    expect(storageSet).toHaveBeenNthCalledWith(2, { [STORAGE_KEYS.NATIVE_HOST]: nativeHostConfig });
    expect(storageSet).toHaveBeenNthCalledWith(3, { [STORAGE_KEYS.LAST_SESSION]: snapshot });
  });

  it("returns the default editor id when none is stored", async () => {
    storageGet.mockResolvedValue({});
    await expect(getPreferredEditorId()).resolves.toBe("cursor");
  });

  it("returns the stored preferred editor id", async () => {
    storageGet.mockResolvedValue({ [STORAGE_KEYS.PREFERRED_EDITOR]: "cursor" });
    await expect(getPreferredEditorId()).resolves.toBe("cursor");
  });

  it("persists the preferred editor id", async () => {
    await setPreferredEditorId("windsurf");
    expect(storageSet).toHaveBeenCalledWith({ [STORAGE_KEYS.PREFERRED_EDITOR]: "windsurf" });
  });

  it("normalizes native host config with the stored preferred editor when persisting", async () => {
    storageGet.mockResolvedValue({ [STORAGE_KEYS.PREFERRED_EDITOR]: "cursor" });

    await setNativeHostConfig({
      ...DEFAULT_NATIVE_HOST_CONFIG,
      hostName: "com.example.host",
      launchPath: "/tmp/fixtures",
      editorLaunchOverrides: {}
    });

    expect(storageSet).toHaveBeenCalledWith({
      [STORAGE_KEYS.NATIVE_HOST]: {
        ...DEFAULT_NATIVE_HOST_CONFIG,
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures",
        editorLaunchOverrides: {}
      }
    });
  });
});
