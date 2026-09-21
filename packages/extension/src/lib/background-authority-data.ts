import { DEFAULT_EDITOR_ID } from "./constants.js";
import type { SiteConfigsResult } from "./messages.js";
import type { ChromeApi } from "./chrome-api.js";
import type {
  BackgroundServerInfo,
  BackgroundState
} from "./background-runtime-shared.js";
import {
  normalizeSiteConfigsResult,
  normalizeEffectiveSiteConfigs,
  toSiteConfigsResult,
  applyEffectiveSiteConfigs,
  currentEffectiveSiteConfigs
} from "./background-authority-shared.js";
import type { BackgroundAuthorityLocalRootApi } from "./background-authority-local-root.js";
import type { BackgroundAuthorityServerSyncApi } from "./background-authority-server-sync.js";
import type {
  FixtureDescriptor,
  NativeHostConfig,
  RequestPayload,
  ResponseMeta,
  RootSentinel,
  SiteConfig,
  StoredFixture
} from "./types.js";
import type { WraithWalkerServerClient } from "./wraithwalker-server.js";

export interface BackgroundAuthorityDataApi {
  repository: {
    exists(descriptor: FixtureDescriptor): Promise<boolean>;
    read(descriptor: FixtureDescriptor): Promise<StoredFixture | null>;
    writeIfAbsent(payload: {
      descriptor: FixtureDescriptor;
      request: RequestPayload;
      response: {
        body: string;
        bodyEncoding: "utf8" | "base64";
        meta: ResponseMeta;
      };
    }): Promise<{
      written: boolean;
      descriptor: FixtureDescriptor;
      sentinel: RootSentinel;
    }>;
  };
  refreshStoredConfig(): Promise<void>;
  withServerFallback<T>(operations: {
    remoteOperation: (info: BackgroundServerInfo) => Promise<T>;
    localOperation: () => Promise<T>;
  }): Promise<T>;
  readConfiguredSiteConfigsForAuthority(): Promise<SiteConfigsResult>;
  readEffectiveSiteConfigsForAuthority(): Promise<SiteConfigsResult>;
  writeConfiguredSiteConfigsForAuthority(
    siteConfigs: SiteConfig[]
  ): Promise<SiteConfigsResult>;
}

interface BackgroundAuthorityDataDependencies {
  state: BackgroundState;
  chromeApi: ChromeApi;
  serverClient: WraithWalkerServerClient;
  getSiteConfigs?: () => Promise<SiteConfig[]>;
  getLegacySiteConfigsMigrated: () => Promise<boolean>;
  getNativeHostConfig: () => Promise<NativeHostConfig>;
  getOrCreateExtensionClientId: () => Promise<string>;
  normalizeSiteConfigs: (
    siteConfigs: Array<Partial<SiteConfig> & { origin: string }>
  ) => SiteConfig[];
  reconcileTabs: () => Promise<void>;
  localRoot: BackgroundAuthorityLocalRootApi;
  serverSync: BackgroundAuthorityServerSyncApi;
}

export function createBackgroundAuthorityData({
  state,
  chromeApi,
  serverClient,
  getSiteConfigs,
  getLegacySiteConfigsMigrated,
  getNativeHostConfig,
  getOrCreateExtensionClientId,
  normalizeSiteConfigs,
  reconcileTabs,
  localRoot,
  serverSync
}: BackgroundAuthorityDataDependencies): BackgroundAuthorityDataApi {
  let lastConfiguredServerSiteConfigs: SiteConfig[] | null = null;

  async function withServerFallback<T>({
    remoteOperation,
    localOperation
  }: {
    remoteOperation: (info: BackgroundServerInfo) => Promise<T>;
    localOperation: () => Promise<T>;
  }): Promise<T> {
    const serverInfo = await serverSync.refreshServerInfo();
    if (!serverInfo) {
      return localOperation();
    }

    try {
      return await remoteOperation(serverInfo);
    } catch (error) {
      if (await revalidateTimedOutServer(error)) {
        throw asError(error);
      }
      if (isNonFallbackServerRequestError(error)) {
        throw asError(error);
      }

      serverSync.markServerOffline();
      const localRootResult = await localRoot.ensureLocalRootReady({
        silent: true
      });
      if (localRootResult.ok) {
        return localOperation();
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Local WraithWalker server is unavailable and no fallback root is ready. ${message}`
      );
    }
  }

  function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  function isServerRequestTimeout(error: unknown): boolean {
    return asError(error).message.includes("Timed out after");
  }

  function isServerPayloadTooLarge(error: unknown): boolean {
    const message = asError(error).message.toLowerCase();
    return (
      message.includes("payload_too_large") ||
      message.includes("payload too large") ||
      message.includes("status code 413") ||
      message.includes("413 payload")
    );
  }

  function isNonFallbackServerRequestError(error: unknown): boolean {
    return isServerPayloadTooLarge(error);
  }

  async function revalidateTimedOutServer(
    error: unknown
  ): Promise<BackgroundServerInfo | null> {
    if (!isServerRequestTimeout(error)) {
      return null;
    }

    return serverSync.refreshServerInfo({ force: true });
  }

  function currentServerSiteConfigsResult(
    serverInfo: BackgroundServerInfo
  ): SiteConfigsResult {
    return toSiteConfigsResult(
      currentEffectiveSiteConfigs(state, normalizeSiteConfigs),
      serverInfo.sentinel,
      normalizeSiteConfigs
    );
  }

  function currentConfiguredServerSiteConfigsResult(
    serverInfo: BackgroundServerInfo
  ): SiteConfigsResult | null {
    if (!lastConfiguredServerSiteConfigs) {
      return null;
    }

    return toSiteConfigsResult(
      lastConfiguredServerSiteConfigs,
      serverInfo.sentinel,
      normalizeSiteConfigs
    );
  }

  function rememberConfiguredServerSiteConfigs(
    result: SiteConfigsResult
  ): SiteConfigsResult {
    if (result.ok) {
      lastConfiguredServerSiteConfigs = result.siteConfigs;
    }
    return result;
  }

  async function refreshStoredConfig(): Promise<void> {
    const [nativeHostConfig, extensionClientId, legacySiteConfigsMigrated] =
      await Promise.all([
        getNativeHostConfig(),
        getOrCreateExtensionClientId(),
        state.legacySiteConfigsMigrated
          ? Promise.resolve(true)
          : getLegacySiteConfigsMigrated()
      ]);
    state.legacySiteConfigsMigrated ||= legacySiteConfigsMigrated;

    if (!getSiteConfigs) {
      await localRoot.ensureLegacySiteConfigsMigrated();
    }

    const sites = await (getSiteConfigs
      ? getSiteConfigs()
      : localRoot.readLocalEffectiveSiteConfigs());
    const normalizedSites = normalizeEffectiveSiteConfigs(
      sites,
      normalizeSiteConfigs
    );
    state.localEnabledOrigins = normalizedSites.map((site) => site.origin);
    state.localSiteConfigsByOrigin = new Map(
      normalizedSites.map((site) => [site.origin, site])
    );
    if (!state.serverInfo) {
      applyEffectiveSiteConfigs(state, normalizedSites, normalizeSiteConfigs);
    }
    state.nativeHostConfig = { ...state.nativeHostConfig, ...nativeHostConfig };
    state.preferredEditorId = DEFAULT_EDITOR_ID;
    state.extensionClientId = extensionClientId;
    state.extensionVersion =
      chromeApi.runtime.getManifest?.().version ||
      state.extensionVersion ||
      "0.0.0";
  }

  async function readConfiguredSiteConfigsForAuthority(): Promise<SiteConfigsResult> {
    const serverInfo = await serverSync.refreshServerInfo({ force: true });
    if (!serverInfo) {
      await localRoot.ensureLegacySiteConfigsMigrated();
      return normalizeSiteConfigsResult(
        await localRoot.readLocalConfiguredSiteConfigsResult(),
        normalizeSiteConfigs
      );
    }

    try {
      const result = await serverClient.readConfiguredSiteConfigs();
      return rememberConfiguredServerSiteConfigs(
        toSiteConfigsResult(
          result.siteConfigs ?? [],
          result.sentinel,
          normalizeSiteConfigs
        )
      );
    } catch (error) {
      const revalidatedServerInfo = await revalidateTimedOutServer(error);
      if (revalidatedServerInfo) {
        return (
          currentConfiguredServerSiteConfigsResult(revalidatedServerInfo) ?? {
            ok: false,
            error: asError(error).message
          }
        );
      }
      if (isNonFallbackServerRequestError(error)) {
        return {
          ok: false,
          error: asError(error).message
        };
      }

      serverSync.markServerOffline();
      const localRootResult = await localRoot.ensureLocalRootReady({
        silent: true
      });
      if (localRootResult.ok) {
        await localRoot.ensureLegacySiteConfigsMigrated();
        return normalizeSiteConfigsResult(
          await localRoot.readLocalConfiguredSiteConfigsResult(),
          normalizeSiteConfigs
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: `Local WraithWalker server is unavailable and no fallback root is ready. ${message}`
      };
    }
  }

  async function readEffectiveSiteConfigsForAuthority(): Promise<SiteConfigsResult> {
    const serverInfo = await serverSync.refreshServerInfo({ force: true });
    if (!serverInfo) {
      await localRoot.ensureLegacySiteConfigsMigrated();
      return normalizeSiteConfigsResult(
        await localRoot.readLocalEffectiveSiteConfigsResult(),
        normalizeSiteConfigs
      );
    }

    try {
      const result = await serverClient.readEffectiveSiteConfigs();
      return toSiteConfigsResult(
        result.siteConfigs ?? [],
        result.sentinel,
        normalizeSiteConfigs
      );
    } catch (error) {
      const revalidatedServerInfo = await revalidateTimedOutServer(error);
      if (revalidatedServerInfo) {
        return currentServerSiteConfigsResult(revalidatedServerInfo);
      }
      if (isNonFallbackServerRequestError(error)) {
        return {
          ok: false,
          error: asError(error).message
        };
      }

      serverSync.markServerOffline();
      const localRootResult = await localRoot.ensureLocalRootReady({
        silent: true
      });
      if (localRootResult.ok) {
        await localRoot.ensureLegacySiteConfigsMigrated();
        return normalizeSiteConfigsResult(
          await localRoot.readLocalEffectiveSiteConfigsResult(),
          normalizeSiteConfigs
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: `Local WraithWalker server is unavailable and no fallback root is ready. ${message}`
      };
    }
  }

  async function writeConfiguredSiteConfigsForAuthority(
    siteConfigs: SiteConfig[]
  ): Promise<SiteConfigsResult> {
    const normalizedSiteConfigs = normalizeEffectiveSiteConfigs(
      siteConfigs,
      normalizeSiteConfigs
    );
    const serverInfo = await serverSync.refreshServerInfo({ force: true });
    if (!serverInfo) {
      await localRoot.ensureLegacySiteConfigsMigrated();
      const result = normalizeSiteConfigsResult(
        await localRoot.writeLocalConfiguredSiteConfigsResult(
          normalizedSiteConfigs
        ),
        normalizeSiteConfigs
      );
      if (result.ok) {
        await refreshStoredConfig();
        if (state.sessionActive && !state.serverInfo) {
          await reconcileTabs();
        }
      }
      return result;
    }

    try {
      const result = await serverClient.writeConfiguredSiteConfigs(
        normalizedSiteConfigs
      );
      await serverSync.refreshServerInfo({ force: true });
      return rememberConfiguredServerSiteConfigs(
        toSiteConfigsResult(
          result.siteConfigs ?? [],
          result.sentinel,
          normalizeSiteConfigs
        )
      );
    } catch (error) {
      if (await revalidateTimedOutServer(error)) {
        return {
          ok: false,
          error: asError(error).message
        };
      }
      if (isNonFallbackServerRequestError(error)) {
        return {
          ok: false,
          error: asError(error).message
        };
      }

      serverSync.markServerOffline();
      const localRootResult = await localRoot.ensureLocalRootReady({
        silent: true
      });
      if (!localRootResult.ok) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: `Local WraithWalker server is unavailable and no fallback root is ready. ${message}`
        };
      }

      await localRoot.ensureLegacySiteConfigsMigrated();
      const result = normalizeSiteConfigsResult(
        await localRoot.writeLocalConfiguredSiteConfigsResult(
          normalizedSiteConfigs
        ),
        normalizeSiteConfigs
      );
      if (result.ok) {
        await refreshStoredConfig();
        if (state.sessionActive && !state.serverInfo) {
          await reconcileTabs();
        }
      }
      return result;
    }
  }

  return {
    repository: {
      exists: (descriptor) =>
        withServerFallback({
          remoteOperation: () =>
            serverClient.hasFixture(descriptor).then((result) => result.exists),
          localOperation: () => localRoot.localFixtureExists(descriptor)
        }),
      read: (descriptor) =>
        withServerFallback({
          remoteOperation: async () => {
            const result = await serverClient.readFixture(descriptor);
            if (!result.exists) {
              return null;
            }

            return {
              request: result.request,
              meta: result.meta,
              bodyBase64: result.bodyBase64,
              size: result.size
            };
          },
          localOperation: () => localRoot.localReadFixture(descriptor)
        }),
      writeIfAbsent: (payload) =>
        withServerFallback({
          remoteOperation: () => serverClient.writeFixtureIfAbsent(payload),
          localOperation: () => localRoot.localWriteFixture(payload)
        })
    },
    refreshStoredConfig,
    withServerFallback,
    readConfiguredSiteConfigsForAuthority,
    readEffectiveSiteConfigsForAuthority,
    writeConfiguredSiteConfigsForAuthority
  };
}
