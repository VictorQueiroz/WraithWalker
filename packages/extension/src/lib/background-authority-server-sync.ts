import { SERVER_HEARTBEAT_INTERVAL_MS } from "./constants.js";
import type { ChromeApi } from "./chrome-api.js";
import type {
  BackgroundServerInfo,
  BackgroundState
} from "./background-runtime-shared.js";
import {
  isServerCacheFresh,
  type ExtensionServerCommand,
  type ExtensionServerCommandResult,
  type WraithWalkerServerClient
} from "./wraithwalker-server.js";
import type { SiteConfig } from "./types.js";

const HEARTBEAT_ALARM_NAME = "wraithwalker-server-heartbeat";

export interface BackgroundAuthorityServerSyncApi {
  refreshServerInfo(opts?: {
    force?: boolean;
  }): Promise<BackgroundServerInfo | null>;
  queueServerRefresh(opts?: { force?: boolean }): void;
  scheduleHeartbeat(): void;
  markServerOffline(): void;
}

interface BackgroundAuthorityServerSyncDependencies {
  state: BackgroundState;
  chromeApi: ChromeApi;
  serverClient: WraithWalkerServerClient;
  getOrCreateExtensionClientId: () => Promise<string>;
  setLastError: (message: string) => void;
  syncTraceBindings: () => Promise<void>;
  reconcileTabs: () => Promise<void>;
  persistSnapshot: () => Promise<void>;
  applyEffectiveSiteConfigs: (siteConfigs: SiteConfig[]) => boolean;
  restoreLocalEffectiveSiteConfigs: () => boolean;
  updateEffectiveRootState: () => void;
  onServerHeartbeatSuccess?: () => void;
}

export function createBackgroundAuthorityServerSync({
  state,
  chromeApi,
  serverClient,
  getOrCreateExtensionClientId,
  setLastError,
  syncTraceBindings,
  reconcileTabs,
  persistSnapshot,
  applyEffectiveSiteConfigs,
  restoreLocalEffectiveSiteConfigs,
  updateEffectiveRootState,
  onServerHeartbeatSuccess
}: BackgroundAuthorityServerSyncDependencies): BackgroundAuthorityServerSyncApi {
  let serverRefreshPromise: Promise<BackgroundServerInfo | null> | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  const bufferedCommandResults = new Map<
    string,
    ExtensionServerCommandResult
  >();
  const runningCommandIds = new Set<string>();

  function shouldKeepHeartbeatAlive(): boolean {
    return (
      state.sessionActive ||
      Boolean(state.activeTrace) ||
      Boolean(state.serverInfo)
    );
  }

  function clearHeartbeatTimer(): void {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function scheduleHeartbeatAlarm(): void {
    if (!chromeApi.alarms) {
      return;
    }

    chromeApi.alarms.create(HEARTBEAT_ALARM_NAME, {
      when: Date.now() + SERVER_HEARTBEAT_INTERVAL_MS
    });
  }

  async function clearHeartbeatAlarm(): Promise<void> {
    if (!chromeApi.alarms) {
      return;
    }

    await chromeApi.alarms.clear(HEARTBEAT_ALARM_NAME);
  }

  function scheduleHeartbeat(): void {
    clearHeartbeatTimer();
    void clearHeartbeatAlarm().catch(() => undefined);

    if (!shouldKeepHeartbeatAlive()) {
      return;
    }

    heartbeatTimer = setTimeout(() => {
      void refreshServerInfo({ force: true }).catch(() => undefined);
    }, SERVER_HEARTBEAT_INTERVAL_MS);
    scheduleHeartbeatAlarm();
  }

  function markServerOffline(): void {
    state.serverInfo = null;
    state.activeTrace = null;
    state.serverCheckedAt = Date.now();
    const siteConfigsChanged = restoreLocalEffectiveSiteConfigs();
    updateEffectiveRootState();
    scheduleHeartbeat();
    void syncTraceBindings().catch(() => undefined);
    if (siteConfigsChanged && state.sessionActive) {
      void reconcileTabs().catch(() => undefined);
    }
  }

  async function runServerCommand(
    command: ExtensionServerCommand
  ): Promise<ExtensionServerCommandResult> {
    try {
      switch (command.type) {
        case "refresh_config":
          if (state.sessionActive) {
            await reconcileTabs();
          }
          await persistSnapshot();
          return {
            commandId: command.commandId,
            type: command.type,
            ok: true,
            completedAt: new Date().toISOString()
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      return {
        commandId: command.commandId,
        type: command.type,
        ok: false,
        completedAt: new Date().toISOString(),
        error: message
      };
    }
  }

  async function processServerCommands(
    commands: ExtensionServerCommand[]
  ): Promise<boolean> {
    let producedNewResults = false;

    for (const command of commands) {
      if (runningCommandIds.has(command.commandId)) {
        continue;
      }

      if (bufferedCommandResults.has(command.commandId)) {
        continue;
      }

      runningCommandIds.add(command.commandId);
      try {
        const result = await runServerCommand(command);
        bufferedCommandResults.set(result.commandId, result);
        producedNewResults = true;
      } finally {
        runningCommandIds.delete(command.commandId);
      }
    }

    return producedNewResults;
  }

  async function performHeartbeatCycle(): Promise<BackgroundServerInfo> {
    const completedCommands = [...bufferedCommandResults.values()];
    const info = await serverClient.heartbeat({
      clientId: state.extensionClientId,
      extensionVersion: state.extensionVersion,
      sessionActive: state.sessionActive,
      enabledOrigins: [...state.enabledOrigins],
      recentConsoleEntries: [...state.recentConsoleEntries],
      ...(completedCommands.length > 0 ? { completedCommands } : {})
    });

    const redeliveredCommandIds = new Set(
      (info.commands ?? []).map((command) => command.commandId)
    );
    for (const result of completedCommands) {
      if (!redeliveredCommandIds.has(result.commandId)) {
        bufferedCommandResults.delete(result.commandId);
      }
    }

    const previousTraceId =
      (state.activeTrace as { traceId?: string } | null)?.traceId || null;
    const siteConfigsChanged = applyEffectiveSiteConfigs(
      info.siteConfigs ?? [...state.localSiteConfigsByOrigin.values()]
    );
    state.serverInfo = {
      rootPath: info.rootPath,
      sentinel: info.sentinel,
      baseUrl: info.baseUrl,
      mcpUrl: info.mcpUrl,
      trpcUrl: info.trpcUrl
    };
    state.activeTrace = info.activeTrace;
    state.serverCheckedAt = Date.now();
    updateEffectiveRootState();
    scheduleHeartbeat();
    if (previousTraceId !== (info.activeTrace?.traceId || null)) {
      await syncTraceBindings();
    }
    if (siteConfigsChanged && state.sessionActive) {
      await reconcileTabs();
    }

    if (await processServerCommands(info.commands ?? [])) {
      return performHeartbeatCycle();
    }

    onServerHeartbeatSuccess?.();

    return state.serverInfo;
  }

  async function refreshServerInfo({
    force = false
  }: { force?: boolean } = {}): Promise<BackgroundServerInfo | null> {
    if (!force && isServerCacheFresh(state.serverCheckedAt)) {
      return state.serverInfo;
    }

    if (serverRefreshPromise) {
      return serverRefreshPromise;
    }

    serverRefreshPromise = (async () => {
      try {
        if (!state.extensionClientId) {
          state.extensionClientId = await getOrCreateExtensionClientId();
        }
        return await performHeartbeatCycle();
      } catch {
        markServerOffline();
        return null;
      } finally {
        serverRefreshPromise = null;
      }
    })();

    return serverRefreshPromise;
  }

  function queueServerRefresh({
    force = false
  }: { force?: boolean } = {}): void {
    if (!force && isServerCacheFresh(state.serverCheckedAt)) {
      return;
    }

    void refreshServerInfo({ force }).catch(() => undefined);
  }

  return {
    refreshServerInfo,
    queueServerRefresh,
    scheduleHeartbeat,
    markServerOffline
  };
}
