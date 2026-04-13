import { buildSessionSnapshot } from "./background-helpers.js";
import {
  DEFAULT_EDITOR_ID,
  OFFSCREEN_REASONS,
  OFFSCREEN_URL,
  SERVER_HEARTBEAT_INTERVAL_MS
} from "./constants.js";
import type {
  DiagnosticsReport,
  ErrorResult,
  OffscreenMessage,
  RootReadyResult,
  RootReadySuccess,
  SiteConfigsResult
} from "./messages.js";
import type {
  ChromeApi,
  BackgroundState,
  BackgroundServerInfo
} from "./background-runtime-shared.js";
import {
  getErrorMessage,
  isLocalRootConfigUnavailable
} from "./background-runtime-shared.js";
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
import {
  isServerCacheFresh,
  type ExtensionServerCommand,
  type ExtensionServerCommandResult,
  type WraithWalkerServerClient
} from "./wraithwalker-server.js";

const HEARTBEAT_ALARM_NAME = "wraithwalker-server-heartbeat";

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
  normalizeSiteConfigs: (siteConfigs: Array<Partial<SiteConfig> & { origin: string }>) => SiteConfig[];
  setLastError: (message: string) => void;
  syncTraceBindings: () => Promise<void>;
  reconcileTabs: () => Promise<void>;
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
    }): Promise<{ written: boolean; descriptor: FixtureDescriptor; sentinel: RootSentinel }>;
  };
  refreshStoredConfig(): Promise<void>;
  snapshotState(): Promise<SessionSnapshot>;
  persistSnapshot(): Promise<void>;
  ensureRootReady(opts?: { requestPermission?: boolean }): Promise<RootReadyResult>;
  ensureLocalRootReady(opts?: LocalRootReadyOptions): Promise<RootReadyResult>;
  closeOffscreenDocument(): Promise<void>;
  sendOffscreenMessage<T>(type: OffscreenMessage["type"], payload?: Record<string, unknown>): Promise<T>;
  refreshServerInfo(opts?: { force?: boolean }): Promise<BackgroundServerInfo | null>;
  queueServerRefresh(opts?: { force?: boolean }): void;
  scheduleHeartbeat(): void;
  markServerOffline(): void;
  withServerFallback<T>(operations: {
    remoteOperation: (info: BackgroundServerInfo) => Promise<T>;
    localOperation: () => Promise<T>;
  }): Promise<T>;
  readConfiguredSiteConfigsForAuthority(): Promise<SiteConfigsResult>;
  readEffectiveSiteConfigsForAuthority(): Promise<SiteConfigsResult>;
  writeConfiguredSiteConfigsForAuthority(siteConfigs: SiteConfig[]): Promise<SiteConfigsResult>;
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
  reconcileTabs
}: BackgroundAuthorityDependencies): BackgroundAuthorityApi {
  let serverRefreshPromise: Promise<BackgroundServerInfo | null> | null = null;
  let offscreenDocumentPromise: Promise<void> | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  const bufferedCommandResults = new Map<string, ExtensionServerCommandResult>();
  const knownCommandResults = new Map<string, ExtensionServerCommandResult>();
  const runningCommandIds = new Set<string>();

  function normalizeEffectiveSiteConfigs(siteConfigs: SiteConfig[]): SiteConfig[] {
    return normalizeSiteConfigs(siteConfigs as Array<Partial<SiteConfig> & { origin: string }>);
  }

  function haveSameSiteConfigs(left: SiteConfig[], right: SiteConfig[]): boolean {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((siteConfig, index) => (
      siteConfig.origin === right[index]?.origin
      && siteConfig.createdAt === right[index]?.createdAt
      && siteConfig.dumpAllowlistPatterns.length === right[index]?.dumpAllowlistPatterns.length
      && siteConfig.dumpAllowlistPatterns.every(
        (pattern, patternIndex) => pattern === right[index]?.dumpAllowlistPatterns[patternIndex]
      )
    ));
  }

  function currentEffectiveSiteConfigs(): SiteConfig[] {
    return normalizeEffectiveSiteConfigs([...state.siteConfigsByOrigin.values()]);
  }

  function applyEffectiveSiteConfigs(siteConfigs: SiteConfig[]): boolean {
    const normalized = normalizeEffectiveSiteConfigs(siteConfigs);
    if (haveSameSiteConfigs(currentEffectiveSiteConfigs(), normalized)) {
      return false;
    }

    state.enabledOrigins = normalized.map((siteConfig) => siteConfig.origin);
    state.siteConfigsByOrigin = new Map(normalized.map((siteConfig) => [siteConfig.origin, siteConfig]));
    return true;
  }

  function restoreLocalEffectiveSiteConfigs(): boolean {
    return applyEffectiveSiteConfigs([...state.localSiteConfigsByOrigin.values()]);
  }

  function updateEffectiveRootState(): void {
    if (state.serverInfo) {
      state.rootReady = true;
      state.rootSentinel = state.serverInfo.sentinel;
      return;
    }

    state.rootReady = state.localRootReady;
    state.rootSentinel = state.localRootSentinel;
  }

  function shouldKeepHeartbeatAlive(): boolean {
    return state.sessionActive || Boolean(state.activeTrace) || Boolean(state.serverInfo);
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

  async function runServerCommand(command: ExtensionServerCommand): Promise<ExtensionServerCommandResult> {
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

  async function processServerCommands(commands: ExtensionServerCommand[]): Promise<boolean> {
    let producedNewResults = false;

    for (const command of commands) {
      if (runningCommandIds.has(command.commandId)) {
        continue;
      }

      const knownResult = knownCommandResults.get(command.commandId);
      if (knownResult) {
        bufferedCommandResults.set(command.commandId, knownResult);
        continue;
      }

      runningCommandIds.add(command.commandId);
      try {
        const result = await runServerCommand(command);
        knownCommandResults.set(result.commandId, result);
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

    for (const result of completedCommands) {
      bufferedCommandResults.delete(result.commandId);
    }

    const previousTraceId = (state.activeTrace as { traceId?: string } | null)?.traceId || null;
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

    return state.serverInfo;
  }

  async function refreshServerInfo({ force = false }: { force?: boolean } = {}): Promise<BackgroundServerInfo | null> {
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

  function queueServerRefresh({ force = false }: { force?: boolean } = {}): void {
    if (!force && isServerCacheFresh(state.serverCheckedAt)) {
      return;
    }

    void refreshServerInfo({ force }).catch(() => undefined);
  }

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

  async function ensureOffscreenDocument(): Promise<void> {
    if (offscreenDocumentPromise) {
      return offscreenDocumentPromise;
    }

    const documentUrl = chromeApi.runtime.getURL(OFFSCREEN_URL);
    const contexts = chromeApi.runtime.getContexts
      ? await chromeApi.runtime.getContexts({
          contextTypes: ["OFFSCREEN_DOCUMENT"],
          documentUrls: [documentUrl]
        })
      : [];

    if (contexts.length) {
      return;
    }

    offscreenDocumentPromise = (async () => {
      try {
        await chromeApi.offscreen.createDocument({
          url: OFFSCREEN_URL,
          reasons: OFFSCREEN_REASONS.map((reason) => chromeApi.offscreen.Reason?.[reason] ?? reason),
          justification: "File System Access requires a DOM document to persist and read local fixtures."
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("Only a single offscreen document may be created.")) {
          throw error;
        }
      }
    })();

    try {
      await offscreenDocumentPromise;
    } finally {
      offscreenDocumentPromise = null;
    }
  }

  async function closeOffscreenDocument(): Promise<void> {
    if (offscreenDocumentPromise) {
      await offscreenDocumentPromise;
    }

    const contexts = chromeApi.runtime.getContexts
      ? await chromeApi.runtime.getContexts({
          contextTypes: ["OFFSCREEN_DOCUMENT"],
          documentUrls: [chromeApi.runtime.getURL(OFFSCREEN_URL)]
        })
      : [];

    if (contexts.length) {
      await chromeApi.offscreen.closeDocument();
    }
  }

  async function sendOffscreenMessage<T>(
    type: OffscreenMessage["type"],
    payload: Record<string, unknown> = {}
  ): Promise<T> {
    await ensureOffscreenDocument();
    return chromeApi.runtime.sendMessage({
      target: "offscreen",
      type,
      payload
    } as OffscreenMessage) as Promise<T>;
  }

  async function readLocalEffectiveSiteConfigs(): Promise<SiteConfig[]> {
    const result = await sendOffscreenMessage<SiteConfigsResult>("fs.readEffectiveSiteConfigs");
    if (!result) {
      return [];
    }

    if (result.ok === true) {
      if (!Array.isArray(result.siteConfigs)) {
        return [];
      }

      return normalizeEffectiveSiteConfigs(result.siteConfigs);
    }

    if (isLocalRootConfigUnavailable(result)) {
      return [];
    }

    throw new Error(getErrorMessage(result));
  }

  async function readLocalConfiguredSiteConfigs(): Promise<SiteConfig[]> {
    const result = await sendOffscreenMessage<SiteConfigsResult>("fs.readConfiguredSiteConfigs");
    if (!result) {
      return [];
    }

    if (result.ok === true) {
      if (!Array.isArray(result.siteConfigs)) {
        return [];
      }

      return normalizeEffectiveSiteConfigs(result.siteConfigs);
    }

    if (isLocalRootConfigUnavailable(result)) {
      return [];
    }

    throw new Error(getErrorMessage(result));
  }

  async function writeLocalConfiguredSiteConfigs(siteConfigs: SiteConfig[]): Promise<SiteConfig[]> {
    const result = await sendOffscreenMessage<SiteConfigsResult>("fs.writeConfiguredSiteConfigs", { siteConfigs });
    if (!result) {
      throw new Error("Failed to update root config.");
    }

    if (result.ok === true) {
      return normalizeEffectiveSiteConfigs(result.siteConfigs ?? []);
    }

    throw new Error(getErrorMessage(result));
  }

  function toSiteConfigsResult(siteConfigs: SiteConfig[], sentinel: RootSentinel): SiteConfigsResult {
    return {
      ok: true,
      siteConfigs: normalizeEffectiveSiteConfigs(siteConfigs),
      sentinel
    };
  }

  function normalizeSiteConfigsResult(result: SiteConfigsResult): SiteConfigsResult {
    if (result.ok !== true) {
      return result;
    }

    return toSiteConfigsResult(
      Array.isArray(result.siteConfigs) ? result.siteConfigs : [],
      result.sentinel
    );
  }

  function mergeLegacySiteConfigs(configuredSiteConfigs: SiteConfig[], legacySiteConfigs: SiteConfig[]): SiteConfig[] {
    const merged = new Map<string, SiteConfig>();

    for (const siteConfig of legacySiteConfigs) {
      merged.set(siteConfig.origin, {
        ...siteConfig,
        dumpAllowlistPatterns: [...siteConfig.dumpAllowlistPatterns]
      });
    }

    for (const siteConfig of configuredSiteConfigs) {
      merged.set(siteConfig.origin, {
        ...siteConfig,
        dumpAllowlistPatterns: [...siteConfig.dumpAllowlistPatterns]
      });
    }

    return normalizeEffectiveSiteConfigs([...merged.values()]);
  }

  async function ensureLegacySiteConfigsMigrated(): Promise<void> {
    if (state.legacySiteConfigsMigrated) {
      return;
    }

    const rootResult = await ensureLocalRootReady({ silent: true });
    if (!rootResult.ok) {
      return;
    }

    const legacySiteConfigs = normalizeEffectiveSiteConfigs(await getLegacySiteConfigs());
    if (legacySiteConfigs.length > 0) {
      const configuredSiteConfigs = await readLocalConfiguredSiteConfigs();
      const mergedSiteConfigs = mergeLegacySiteConfigs(configuredSiteConfigs, legacySiteConfigs);
      if (!haveSameSiteConfigs(configuredSiteConfigs, mergedSiteConfigs)) {
        await writeLocalConfiguredSiteConfigs(mergedSiteConfigs);
      }
    }

    await setLegacySiteConfigsMigrated(true);
    state.legacySiteConfigsMigrated = true;
  }

  async function ensureLocalRootReady(
    { requestPermission = false, silent = false }: LocalRootReadyOptions = {}
  ): Promise<RootReadyResult> {
    const result = await sendOffscreenMessage<RootReadyResult>("fs.ensureRoot", { requestPermission });
    if (!result) {
      state.localRootReady = false;
      state.localRootSentinel = null;
      updateEffectiveRootState();
      if (!silent) {
        setLastError("No root directory selected.");
      }
      return { ok: false, error: "No root directory selected." };
    }
    state.localRootReady = Boolean(result.ok);
    state.localRootSentinel = result.ok ? result.sentinel : null;
    updateEffectiveRootState();
    if (!silent) {
      setLastError(result.ok ? "" : getErrorMessage(result as ErrorResult));
    }
    return result;
  }

  async function ensureRootReady({ requestPermission = false }: { requestPermission?: boolean } = {}): Promise<RootReadyResult> {
    const serverInfo = await refreshServerInfo({ force: true });
    if (serverInfo) {
      setLastError("");
      return {
        ok: true,
        sentinel: serverInfo.sentinel,
        permission: "granted"
      };
    }

    return ensureLocalRootReady({ requestPermission });
  }

  async function localFixtureExists(descriptor: FixtureDescriptor): Promise<boolean> {
    const fixtureCheck = await sendOffscreenMessage<{ ok: boolean; exists?: boolean; error?: string }>(
      "fs.hasFixture",
      { descriptor } as Record<string, unknown>
    );
    if (!fixtureCheck.ok) {
      throw new Error(fixtureCheck.error || "Fixture lookup failed.");
    }

    return Boolean(fixtureCheck.exists);
  }

  async function localReadFixture(descriptor: FixtureDescriptor): Promise<StoredFixture | null> {
    const fixture = await sendOffscreenMessage<{
      ok: boolean;
      exists?: boolean;
      request?: RequestPayload;
      meta?: ResponseMeta;
      bodyBase64?: string;
      size?: number;
      error?: string;
    }>("fs.readFixture", { descriptor } as Record<string, unknown>);
    if (!fixture.ok) {
      throw new Error(fixture.error || "Fixture lookup failed.");
    }

    if (!fixture.exists || !fixture.meta || !fixture.bodyBase64 || !fixture.request) {
      return null;
    }

    return {
      request: fixture.request,
      meta: fixture.meta,
      bodyBase64: fixture.bodyBase64,
      size: fixture.size || 0
    };
  }

  async function localWriteFixture(payload: {
    descriptor: FixtureDescriptor;
    request: RequestPayload;
    response: {
      body: string;
      bodyEncoding: "utf8" | "base64";
      meta: ResponseMeta;
    };
  }): Promise<{ written: boolean; descriptor: FixtureDescriptor; sentinel: RootSentinel }> {
    const result = await sendOffscreenMessage<{
      ok: boolean;
      descriptor?: FixtureDescriptor;
      sentinel?: RootSentinel;
      error?: string;
    }>("fs.writeFixture", payload);
    if (!result.ok) {
      throw new Error(result.error || "Fixture write failed.");
    }

    return {
      written: true,
      descriptor: result.descriptor || payload.descriptor,
      sentinel: result.sentinel || state.rootSentinel || { rootId: "" }
    };
  }

  async function withServerFallback<T>({
    remoteOperation,
    localOperation
  }: {
    remoteOperation: (info: BackgroundServerInfo) => Promise<T>;
    localOperation: () => Promise<T>;
  }): Promise<T> {
    const serverInfo = await refreshServerInfo();
    if (!serverInfo) {
      return localOperation();
    }

    try {
      return await remoteOperation(serverInfo);
    } catch (error) {
      markServerOffline();
      const localRoot = await ensureLocalRootReady({ silent: true });
      if (localRoot.ok) {
        return localOperation();
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Local WraithWalker server is unavailable and no fallback root is ready. ${message}`);
    }
  }

  async function readConfiguredSiteConfigsForAuthority(): Promise<SiteConfigsResult> {
    const serverInfo = await refreshServerInfo({ force: true });
    if (!serverInfo) {
      await ensureLegacySiteConfigsMigrated();
      return normalizeSiteConfigsResult(
        await sendOffscreenMessage<SiteConfigsResult>("fs.readConfiguredSiteConfigs")
      );
    }

    try {
      const result = await serverClient.readConfiguredSiteConfigs();
      return toSiteConfigsResult(result.siteConfigs ?? [], result.sentinel);
    } catch (error) {
      markServerOffline();
      const localRoot = await ensureLocalRootReady({ silent: true });
      if (localRoot.ok) {
        await ensureLegacySiteConfigsMigrated();
        return normalizeSiteConfigsResult(
          await sendOffscreenMessage<SiteConfigsResult>("fs.readConfiguredSiteConfigs")
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
    const serverInfo = await refreshServerInfo({ force: true });
    if (!serverInfo) {
      await ensureLegacySiteConfigsMigrated();
      return normalizeSiteConfigsResult(
        await sendOffscreenMessage<SiteConfigsResult>("fs.readEffectiveSiteConfigs")
      );
    }

    try {
      const result = await serverClient.readEffectiveSiteConfigs();
      return toSiteConfigsResult(result.siteConfigs ?? [], result.sentinel);
    } catch (error) {
      markServerOffline();
      const localRoot = await ensureLocalRootReady({ silent: true });
      if (localRoot.ok) {
        await ensureLegacySiteConfigsMigrated();
        return normalizeSiteConfigsResult(
          await sendOffscreenMessage<SiteConfigsResult>("fs.readEffectiveSiteConfigs")
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: `Local WraithWalker server is unavailable and no fallback root is ready. ${message}`
      };
    }
  }

  async function writeConfiguredSiteConfigsForAuthority(siteConfigs: SiteConfig[]): Promise<SiteConfigsResult> {
    const serverInfo = await refreshServerInfo({ force: true });
    if (!serverInfo) {
      await ensureLegacySiteConfigsMigrated();
      const result = normalizeSiteConfigsResult(await sendOffscreenMessage<SiteConfigsResult>(
        "fs.writeConfiguredSiteConfigs",
        { siteConfigs }
      ));
      if (result.ok) {
        await refreshStoredConfig();
        if (state.sessionActive && !state.serverInfo) {
          await reconcileTabs();
        }
      }
      return result;
    }

    try {
      const result = await serverClient.writeConfiguredSiteConfigs(siteConfigs);
      await refreshServerInfo({ force: true });
      return toSiteConfigsResult(result.siteConfigs ?? [], result.sentinel);
    } catch (error) {
      markServerOffline();
      const localRoot = await ensureLocalRootReady({ silent: true });
      if (!localRoot.ok) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: `Local WraithWalker server is unavailable and no fallback root is ready. ${message}`
        };
      }

      await ensureLegacySiteConfigsMigrated();
      const result = normalizeSiteConfigsResult(await sendOffscreenMessage<SiteConfigsResult>(
        "fs.writeConfiguredSiteConfigs",
        { siteConfigs }
      ));
      if (result.ok) {
        await refreshStoredConfig();
        if (state.sessionActive && !state.serverInfo) {
          await reconcileTabs();
        }
      }
      return result;
    }
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

  async function refreshStoredConfig(): Promise<void> {
    const [nativeHostConfig, extensionClientId, legacySiteConfigsMigrated] = await Promise.all([
      getNativeHostConfig(),
      getOrCreateExtensionClientId(),
      state.legacySiteConfigsMigrated
        ? Promise.resolve(true)
        : getLegacySiteConfigsMigrated()
    ]);
    state.legacySiteConfigsMigrated ||= legacySiteConfigsMigrated;

    if (!getSiteConfigs) {
      await ensureLegacySiteConfigsMigrated();
    }

    const sites = await (getSiteConfigs ? getSiteConfigs() : readLocalEffectiveSiteConfigs());
    const normalizedSites = normalizeEffectiveSiteConfigs(sites);
    state.localEnabledOrigins = normalizedSites.map((site: SiteConfig) => site.origin);
    state.localSiteConfigsByOrigin = new Map(normalizedSites.map((site: SiteConfig) => [site.origin, site]));
    if (!state.serverInfo) {
      applyEffectiveSiteConfigs(normalizedSites);
    }
    state.nativeHostConfig = { ...state.nativeHostConfig, ...nativeHostConfig };
    state.preferredEditorId = DEFAULT_EDITOR_ID;
    state.extensionClientId = extensionClientId;
    state.extensionVersion = chromeApi.runtime.getManifest?.().version || state.extensionVersion || "0.0.0";
  }

  return {
    repository: {
      exists: (descriptor) => withServerFallback({
        remoteOperation: () => serverClient.hasFixture(descriptor).then((result) => result.exists),
        localOperation: () => localFixtureExists(descriptor)
      }),
      read: (descriptor) => withServerFallback({
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
        localOperation: () => localReadFixture(descriptor)
      }),
      writeIfAbsent: (payload) => withServerFallback({
        remoteOperation: () => serverClient.writeFixtureIfAbsent(payload),
        localOperation: () => localWriteFixture(payload)
      })
    },
    refreshStoredConfig,
    snapshotState,
    persistSnapshot,
    ensureRootReady,
    ensureLocalRootReady,
    closeOffscreenDocument,
    sendOffscreenMessage,
    refreshServerInfo,
    queueServerRefresh,
    scheduleHeartbeat,
    markServerOffline,
    withServerFallback,
    readConfiguredSiteConfigsForAuthority,
    readEffectiveSiteConfigsForAuthority,
    writeConfiguredSiteConfigsForAuthority,
    getDiagnosticsReport
  };
}

export function getRequiredRootId(rootResult: RootReadySuccess): string | null {
  const rootId = (rootResult.sentinel as RootSentinel | undefined)?.rootId;
  return typeof rootId === "string" && rootId.trim() ? rootId : null;
}
