import { vi } from "vitest";

import { createBackgroundAuthority } from "../../src/lib/background-authority.js";
import {
  createBackgroundState,
  createTestChromeApi,
  createMockServerClient
} from "./background-service-test-helpers.js";

type NormalizeSiteConfigs = NonNullable<
  Parameters<typeof createBackgroundAuthority>[0]["normalizeSiteConfigs"]
>;

export function createAuthorityHarness({
  stateOverrides = {},
  chromeApi = createTestChromeApi(),
  serverClientOverrides = {},
  getSiteConfigs = vi.fn().mockResolvedValue([]),
  getLegacySiteConfigs = vi.fn().mockResolvedValue([]),
  getLegacySiteConfigsMigrated = vi.fn().mockResolvedValue(true),
  getNativeHostConfig = vi.fn().mockResolvedValue({
    hostName: "",
    launchPath: "",
    editorLaunchOverrides: {}
  }),
  getOrCreateExtensionClientId = vi.fn().mockResolvedValue("client-1"),
  setLegacySiteConfigsMigrated = vi.fn().mockResolvedValue(undefined),
  setLastSessionSnapshot = vi.fn().mockResolvedValue(undefined),
  normalizeSiteConfigs = vi.fn((siteConfigs) => siteConfigs as any),
  setLastError,
  syncTraceBindings = vi.fn().mockResolvedValue(undefined),
  reconcileTabs = vi.fn().mockResolvedValue(undefined)
}: {
  stateOverrides?: Record<string, unknown>;
  chromeApi?: ReturnType<typeof createTestChromeApi>;
  serverClientOverrides?: Record<string, unknown>;
  getSiteConfigs?: ReturnType<typeof vi.fn>;
  getLegacySiteConfigs?: ReturnType<typeof vi.fn>;
  getLegacySiteConfigsMigrated?: ReturnType<typeof vi.fn>;
  getNativeHostConfig?: ReturnType<typeof vi.fn>;
  getOrCreateExtensionClientId?: ReturnType<typeof vi.fn>;
  setLegacySiteConfigsMigrated?: ReturnType<typeof vi.fn>;
  setLastSessionSnapshot?: ReturnType<typeof vi.fn>;
  normalizeSiteConfigs?: NormalizeSiteConfigs;
  setLastError?: ReturnType<typeof vi.fn>;
  syncTraceBindings?: ReturnType<typeof vi.fn>;
  reconcileTabs?: ReturnType<typeof vi.fn>;
} = {}) {
  const state = createBackgroundState(
    stateOverrides as Parameters<typeof createBackgroundState>[0]
  );
  const appliedSetLastError =
    setLastError ??
    vi.fn((message: string) => {
      state.lastError = message;
    });
  const serverClient = createMockServerClient(
    serverClientOverrides as Parameters<typeof createMockServerClient>[0]
  );
  const authority = createBackgroundAuthority({
    state,
    chromeApi,
    serverClient,
    getSiteConfigs,
    getLegacySiteConfigs,
    getLegacySiteConfigsMigrated,
    getNativeHostConfig,
    getOrCreateExtensionClientId,
    setLegacySiteConfigsMigrated,
    setLastSessionSnapshot,
    normalizeSiteConfigs,
    setLastError: appliedSetLastError,
    syncTraceBindings,
    reconcileTabs
  });

  return {
    state,
    chromeApi,
    serverClient,
    authority,
    setLastError: appliedSetLastError,
    setLastSessionSnapshot,
    syncTraceBindings,
    reconcileTabs,
    getSiteConfigs,
    getLegacySiteConfigs,
    getLegacySiteConfigsMigrated,
    getNativeHostConfig,
    getOrCreateExtensionClientId,
    setLegacySiteConfigsMigrated,
    normalizeSiteConfigs
  };
}
