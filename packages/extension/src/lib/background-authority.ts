import type {
  DiagnosticsReport,
  OffscreenMessage,
  RootReadyResult,
  RootReadySuccess,
  SiteConfigsResult
} from "./messages.js";
import type {
  ChromeApi
} from "./chrome-api.js";
import type {
  BackgroundState,
  BackgroundServerInfo
} from "./background-runtime-shared.js";
import {
  applyEffectiveSiteConfigs,
  restoreLocalEffectiveSiteConfigs,
  updateEffectiveRootState
} from "./background-authority-shared.js";
import { createBackgroundAuthorityLocalRoot } from "./background-authority-local-root.js";
import { createBackgroundAuthorityServerSync } from "./background-authority-server-sync.js";
import { createBackgroundAuthorityData } from "./background-authority-data.js";
import { createBackgroundAuthorityDiagnostics } from "./background-authority-diagnostics.js";
import type {
  FixtureDescriptor,
  NativeHostConfig,
  RequestPayload,
  ResponseMeta,
  RootSentinel,
  SessionSnapshot,
  SiteConfig,
  StoredFixture
} from "./types.js";
import type { WraithWalkerServerClient } from "./wraithwalker-server.js";

interface BackgroundAuthorityDependencies {
  state: BackgroundState;
  chromeApi: ChromeApi;
  serverClient: WraithWalkerServerClient;
  getSiteConfigs?: () => Promise<SiteConfig[]>;
  getLegacySiteConfigs: () => Promise<SiteConfig[]>;
  getLegacySiteConfigsMigrated: () => Promise<boolean>;
  getNativeHostConfig: () => Promise<NativeHostConfig>;
  getOrCreateExtensionClientId: () => Promise<string>;
  setLegacySiteConfigsMigrated: (value: boolean) => Promise<void>;
  setLastSessionSnapshot: (snapshot: SessionSnapshot) => Promise<void>;
  normalizeSiteConfigs: (
    siteConfigs: Array<Partial<SiteConfig> & { origin: string }>
  ) => SiteConfig[];
  setLastError: (message: string) => void;
  syncTraceBindings: () => Promise<void>;
  reconcileTabs: () => Promise<void>;
  onServerHeartbeatSuccess?: () => void;
}

interface LocalRootReadyOptions {
  requestPermission?: boolean;
  silent?: boolean;
}

export interface BackgroundAuthorityApi {
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
  snapshotState(): Promise<SessionSnapshot>;
  persistSnapshot(): Promise<void>;
  ensureRootReady(opts?: {
    requestPermission?: boolean;
  }): Promise<RootReadyResult>;
  ensureLocalRootReady(opts?: LocalRootReadyOptions): Promise<RootReadyResult>;
  closeOffscreenDocument(): Promise<void>;
  sendOffscreenMessage<T>(
    type: OffscreenMessage["type"],
    payload?: Record<string, unknown>
  ): Promise<T>;
  refreshServerInfo(opts?: {
    force?: boolean;
  }): Promise<BackgroundServerInfo | null>;
  queueServerRefresh(opts?: { force?: boolean }): void;
  scheduleHeartbeat(): void;
  markServerOffline(): void;
  withServerFallback<T>(operations: {
    remoteOperation: (info: BackgroundServerInfo) => Promise<T>;
    localOperation: () => Promise<T>;
  }): Promise<T>;
  readConfiguredSiteConfigsForAuthority(): Promise<SiteConfigsResult>;
  readEffectiveSiteConfigsForAuthority(): Promise<SiteConfigsResult>;
  writeConfiguredSiteConfigsForAuthority(
    siteConfigs: SiteConfig[]
  ): Promise<SiteConfigsResult>;
  getDiagnosticsReport(): Promise<DiagnosticsReport>;
}

export function createBackgroundAuthority({
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
  setLastError,
  syncTraceBindings,
  reconcileTabs,
  onServerHeartbeatSuccess
}: BackgroundAuthorityDependencies): BackgroundAuthorityApi {
  const localRoot = createBackgroundAuthorityLocalRoot({
    state,
    chromeApi,
    getLegacySiteConfigs,
    setLegacySiteConfigsMigrated,
    normalizeSiteConfigs,
    setLastError
  });

  let persistSnapshot = async (): Promise<void> => undefined;

  const serverSync = createBackgroundAuthorityServerSync({
    state,
    chromeApi,
    serverClient,
    getOrCreateExtensionClientId,
    setLastError,
    syncTraceBindings,
    reconcileTabs,
    persistSnapshot: () => persistSnapshot(),
    applyEffectiveSiteConfigs: (siteConfigs) =>
      applyEffectiveSiteConfigs(state, siteConfigs, normalizeSiteConfigs),
    restoreLocalEffectiveSiteConfigs: () =>
      restoreLocalEffectiveSiteConfigs(state, normalizeSiteConfigs),
    updateEffectiveRootState: () => updateEffectiveRootState(state),
    onServerHeartbeatSuccess
  });

  const data = createBackgroundAuthorityData({
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
  });

  const diagnostics = createBackgroundAuthorityDiagnostics({
    state,
    setLastSessionSnapshot,
    queueServerRefresh: serverSync.queueServerRefresh,
    refreshStoredConfig: data.refreshStoredConfig,
    refreshServerInfo: serverSync.refreshServerInfo,
    ensureLocalRootReady: localRoot.ensureLocalRootReady,
    readConfiguredSiteConfigsForAuthority:
      data.readConfiguredSiteConfigsForAuthority,
    readEffectiveSiteConfigsForAuthority:
      data.readEffectiveSiteConfigsForAuthority
  });
  persistSnapshot = diagnostics.persistSnapshot;

  async function ensureRootReady({
    requestPermission = false
  }: { requestPermission?: boolean } = {}): Promise<RootReadyResult> {
    const serverInfo = await serverSync.refreshServerInfo({ force: true });
    if (serverInfo) {
      setLastError("");
      return {
        ok: true,
        sentinel: serverInfo.sentinel,
        permission: "granted"
      };
    }

    return localRoot.ensureLocalRootReady({ requestPermission });
  }

  return {
    repository: data.repository,
    refreshStoredConfig: data.refreshStoredConfig,
    snapshotState: diagnostics.snapshotState,
    persistSnapshot: diagnostics.persistSnapshot,
    ensureRootReady,
    ensureLocalRootReady: localRoot.ensureLocalRootReady,
    closeOffscreenDocument: localRoot.closeOffscreenDocument,
    sendOffscreenMessage: localRoot.sendOffscreenMessage,
    refreshServerInfo: serverSync.refreshServerInfo,
    queueServerRefresh: serverSync.queueServerRefresh,
    scheduleHeartbeat: serverSync.scheduleHeartbeat,
    markServerOffline: serverSync.markServerOffline,
    withServerFallback: data.withServerFallback,
    readConfiguredSiteConfigsForAuthority:
      data.readConfiguredSiteConfigsForAuthority,
    readEffectiveSiteConfigsForAuthority:
      data.readEffectiveSiteConfigsForAuthority,
    writeConfiguredSiteConfigsForAuthority:
      data.writeConfiguredSiteConfigsForAuthority,
    getDiagnosticsReport: diagnostics.getDiagnosticsReport
  };
}

export { getRequiredRootId } from "./background-authority-shared.js";
export type { RootReadySuccess };
