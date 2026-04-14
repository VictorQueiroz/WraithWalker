import { buildSessionSnapshot } from "./background-helpers.js";
import { DEFAULT_EDITOR_ID } from "./constants.js";
import type { DiagnosticsReport, RootReadyResult, SiteConfigsResult } from "./messages.js";
import { getErrorMessage, type BackgroundServerInfo, type BackgroundState } from "./background-runtime-shared.js";
import type { SessionSnapshot } from "./types.js";

export interface BackgroundAuthorityDiagnosticsApi {
  snapshotState(): Promise<SessionSnapshot>;
  persistSnapshot(): Promise<void>;
  getDiagnosticsReport(): Promise<DiagnosticsReport>;
}

interface BackgroundAuthorityDiagnosticsDependencies {
  state: BackgroundState;
  setLastSessionSnapshot: (snapshot: SessionSnapshot) => Promise<void>;
  queueServerRefresh: (opts?: { force?: boolean }) => void;
  refreshStoredConfig: () => Promise<void>;
  refreshServerInfo: (opts?: { force?: boolean }) => Promise<BackgroundServerInfo | null>;
  ensureLocalRootReady: (opts?: { requestPermission?: boolean; silent?: boolean }) => Promise<RootReadyResult>;
  readConfiguredSiteConfigsForAuthority: () => Promise<SiteConfigsResult>;
  readEffectiveSiteConfigsForAuthority: () => Promise<SiteConfigsResult>;
}

export function createBackgroundAuthorityDiagnostics({
  state,
  setLastSessionSnapshot,
  queueServerRefresh,
  refreshStoredConfig,
  refreshServerInfo,
  ensureLocalRootReady,
  readConfiguredSiteConfigsForAuthority,
  readEffectiveSiteConfigsForAuthority
}: BackgroundAuthorityDiagnosticsDependencies): BackgroundAuthorityDiagnosticsApi {
  async function snapshotState(): Promise<SessionSnapshot> {
    queueServerRefresh();

    return buildSessionSnapshot({
      sessionActive: state.sessionActive,
      attachedTabIds: [...state.attachedTabs.keys()],
      enabledOrigins: [...state.enabledOrigins],
      rootReady: state.rootReady,
      captureDestination: state.serverInfo
        ? "server"
        : state.localRootReady
          ? "local"
          : "none",
      captureRootPath: state.serverInfo?.rootPath || "",
      lastError: state.lastError
    });
  }

  async function persistSnapshot(): Promise<void> {
    await setLastSessionSnapshot(await snapshotState());
  }

  async function getDiagnosticsReport(): Promise<DiagnosticsReport> {
    await refreshStoredConfig();
    const serverInfo = await refreshServerInfo({ force: true });
    const localRootResult = await ensureLocalRootReady({ silent: true });
    const [configuredResult, effectiveResult, sessionSnapshot] = await Promise.all([
      readConfiguredSiteConfigsForAuthority(),
      readEffectiveSiteConfigsForAuthority(),
      snapshotState()
    ]);

    const configuredSiteConfigs = configuredResult.ok ? configuredResult.siteConfigs : [];
    const effectiveSiteConfigs = effectiveResult.ok ? effectiveResult.siteConfigs : [];
    const localRootError = "error" in localRootResult ? localRootResult.error : undefined;
    const issues = new Set<string>();

    if (!sessionSnapshot.rootReady) {
      issues.add("No active capture root is ready.");
    }
    if (!effectiveSiteConfigs.length) {
      issues.add("No enabled origins are configured.");
    }
    if (!state.nativeHostConfig.hostName.trim()) {
      issues.add("Native host name is not configured.");
    }
    if (!state.nativeHostConfig.launchPath.trim() && !serverInfo) {
      issues.add("Shared editor launch path is not configured for local-root actions.");
    }
    if (state.lastError) {
      issues.add(`Last runtime error: ${state.lastError}`);
    }
    if (!configuredResult.ok) {
      issues.add(`Configured-site read failed: ${getErrorMessage(configuredResult)}`);
    }
    if (!effectiveResult.ok) {
      issues.add(`Effective-site read failed: ${getErrorMessage(effectiveResult)}`);
    }
    if (!serverInfo) {
      issues.add("Local WraithWalker server is not connected.");
    }
    if (!localRootResult.ok && localRootError !== "No root directory selected.") {
      issues.add(`Local root check failed: ${getErrorMessage(localRootResult)}`);
    }

    return {
      generatedAt: new Date().toISOString(),
      extensionVersion: state.extensionVersion,
      extensionClientId: state.extensionClientId,
      sessionSnapshot,
      localRoot: {
        ready: localRootResult.ok,
        permission: localRootResult.ok ? localRootResult.permission : (localRootResult.permission ?? null),
        sentinel: localRootResult.ok ? localRootResult.sentinel : null,
        ...(localRootResult.ok ? {} : { error: localRootError }),
        legacySiteConfigsMigrated: state.legacySiteConfigsMigrated
      },
      server: {
        connected: Boolean(serverInfo),
        checkedAt: state.serverCheckedAt ? new Date(state.serverCheckedAt).toISOString() : null,
        rootPath: serverInfo?.rootPath || "",
        sentinel: serverInfo?.sentinel || null,
        baseUrl: serverInfo?.baseUrl || "",
        trpcUrl: serverInfo?.trpcUrl || "",
        mcpUrl: serverInfo?.mcpUrl || "",
        activeTraceId: (state.activeTrace as { traceId?: string } | null)?.traceId || null
      },
      config: {
        configuredSiteConfigs,
        effectiveSiteConfigs,
        ...(!configuredResult.ok ? { configuredSiteError: getErrorMessage(configuredResult) } : {}),
        ...(!effectiveResult.ok ? { effectiveSiteError: getErrorMessage(effectiveResult) } : {})
      },
      nativeHost: {
        configured: Boolean(state.nativeHostConfig.hostName.trim()),
        hostName: state.nativeHostConfig.hostName,
        launchPath: state.nativeHostConfig.launchPath,
        preferredEditorId: state.preferredEditorId || DEFAULT_EDITOR_ID
      },
      runtime: {
        attachedTabs: [...state.attachedTabs.entries()].map(([tabId, tabState]) => ({
          tabId,
          topOrigin: tabState.topOrigin,
          traceArmedForTraceId: tabState.traceArmedForTraceId || null,
          hasTraceScriptIdentifier: Boolean(tabState.traceScriptIdentifier)
        })),
        pendingRequests: [...state.requests.values()].map((entry) => ({
          tabId: entry.tabId,
          requestId: entry.requestId,
          method: entry.method,
          url: entry.url,
          replayed: entry.replayed
        })),
        lastError: state.lastError
      },
      issues: [...issues]
    };
  }

  return {
    snapshotState,
    persistSnapshot,
    getDiagnosticsReport
  };
}
