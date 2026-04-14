import { OFFSCREEN_REASONS, OFFSCREEN_URL } from "./constants.js";
import type {
  ErrorResult,
  OffscreenMessage,
  RootReadyResult,
  SiteConfigsResult
} from "./messages.js";
import {
  getErrorMessage,
  isLocalRootConfigUnavailable,
  type BackgroundState,
  type ChromeApi
} from "./background-runtime-shared.js";
import {
  haveSameSiteConfigs,
  mergeLegacySiteConfigs,
  normalizeEffectiveSiteConfigs,
  updateEffectiveRootState
} from "./background-authority-shared.js";
import type {
  FixtureDescriptor,
  RequestPayload,
  ResponseMeta,
  RootSentinel,
  SiteConfig,
  StoredFixture
} from "./types.js";

export interface BackgroundAuthorityLocalRootApi {
  ensureLocalRootReady(opts?: {
    requestPermission?: boolean;
    silent?: boolean;
  }): Promise<RootReadyResult>;
  ensureLegacySiteConfigsMigrated(): Promise<void>;
  closeOffscreenDocument(): Promise<void>;
  sendOffscreenMessage<T>(
    type: OffscreenMessage["type"],
    payload?: Record<string, unknown>
  ): Promise<T>;
  readLocalEffectiveSiteConfigs(): Promise<SiteConfig[]>;
  readLocalConfiguredSiteConfigs(): Promise<SiteConfig[]>;
  readLocalEffectiveSiteConfigsResult(): Promise<SiteConfigsResult>;
  readLocalConfiguredSiteConfigsResult(): Promise<SiteConfigsResult>;
  writeLocalConfiguredSiteConfigs(
    siteConfigs: SiteConfig[]
  ): Promise<SiteConfig[]>;
  writeLocalConfiguredSiteConfigsResult(
    siteConfigs: SiteConfig[]
  ): Promise<SiteConfigsResult>;
  localFixtureExists(descriptor: FixtureDescriptor): Promise<boolean>;
  localReadFixture(
    descriptor: FixtureDescriptor
  ): Promise<StoredFixture | null>;
  localWriteFixture(payload: {
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
}

interface BackgroundAuthorityLocalRootDependencies {
  state: BackgroundState;
  chromeApi: ChromeApi;
  getLegacySiteConfigs: () => Promise<SiteConfig[]>;
  setLegacySiteConfigsMigrated: (value: boolean) => Promise<void>;
  normalizeSiteConfigs: (
    siteConfigs: Array<Partial<SiteConfig> & { origin: string }>
  ) => SiteConfig[];
  setLastError: (message: string) => void;
}

export function createBackgroundAuthorityLocalRoot({
  state,
  chromeApi,
  getLegacySiteConfigs,
  setLegacySiteConfigsMigrated,
  normalizeSiteConfigs,
  setLastError
}: BackgroundAuthorityLocalRootDependencies): BackgroundAuthorityLocalRootApi {
  let offscreenDocumentPromise: Promise<void> | null = null;

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
          reasons: OFFSCREEN_REASONS.map(
            (reason) => chromeApi.offscreen.Reason?.[reason] ?? reason
          ),
          justification:
            "File System Access requires a DOM document to persist and read local fixtures."
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          !message.includes("Only a single offscreen document may be created.")
        ) {
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
    const result = await sendOffscreenMessage<SiteConfigsResult>(
      "fs.readEffectiveSiteConfigs"
    );
    if (!result) {
      return [];
    }

    if (result.ok === true) {
      if (!Array.isArray(result.siteConfigs)) {
        return [];
      }

      return normalizeEffectiveSiteConfigs(
        result.siteConfigs,
        normalizeSiteConfigs
      );
    }

    if (isLocalRootConfigUnavailable(result)) {
      return [];
    }

    throw new Error(getErrorMessage(result));
  }

  async function readLocalConfiguredSiteConfigs(): Promise<SiteConfig[]> {
    const result = await sendOffscreenMessage<SiteConfigsResult>(
      "fs.readConfiguredSiteConfigs"
    );
    if (!result) {
      return [];
    }

    if (result.ok === true) {
      if (!Array.isArray(result.siteConfigs)) {
        return [];
      }

      return normalizeEffectiveSiteConfigs(
        result.siteConfigs,
        normalizeSiteConfigs
      );
    }

    if (isLocalRootConfigUnavailable(result)) {
      return [];
    }

    throw new Error(getErrorMessage(result));
  }

  async function readLocalEffectiveSiteConfigsResult(): Promise<SiteConfigsResult> {
    return sendOffscreenMessage<SiteConfigsResult>(
      "fs.readEffectiveSiteConfigs"
    );
  }

  async function readLocalConfiguredSiteConfigsResult(): Promise<SiteConfigsResult> {
    return sendOffscreenMessage<SiteConfigsResult>(
      "fs.readConfiguredSiteConfigs"
    );
  }

  async function writeLocalConfiguredSiteConfigsResult(
    siteConfigs: SiteConfig[]
  ): Promise<SiteConfigsResult> {
    return sendOffscreenMessage<SiteConfigsResult>(
      "fs.writeConfiguredSiteConfigs",
      { siteConfigs }
    );
  }

  async function writeLocalConfiguredSiteConfigs(
    siteConfigs: SiteConfig[]
  ): Promise<SiteConfig[]> {
    const result = await writeLocalConfiguredSiteConfigsResult(siteConfigs);
    if (!result) {
      throw new Error("Failed to update root config.");
    }

    if (result.ok === true) {
      return normalizeEffectiveSiteConfigs(
        result.siteConfigs ?? [],
        normalizeSiteConfigs
      );
    }

    throw new Error(getErrorMessage(result));
  }

  async function ensureLegacySiteConfigsMigrated(): Promise<void> {
    if (state.legacySiteConfigsMigrated) {
      return;
    }

    const rootResult = await ensureLocalRootReady({ silent: true });
    if (!rootResult.ok) {
      return;
    }

    const legacySiteConfigs = normalizeEffectiveSiteConfigs(
      await getLegacySiteConfigs(),
      normalizeSiteConfigs
    );
    if (legacySiteConfigs.length > 0) {
      const configuredSiteConfigs = await readLocalConfiguredSiteConfigs();
      const mergedSiteConfigs = mergeLegacySiteConfigs(
        configuredSiteConfigs,
        legacySiteConfigs,
        normalizeSiteConfigs
      );
      if (!haveSameSiteConfigs(configuredSiteConfigs, mergedSiteConfigs)) {
        await writeLocalConfiguredSiteConfigs(mergedSiteConfigs);
      }
    }

    await setLegacySiteConfigsMigrated(true);
    state.legacySiteConfigsMigrated = true;
  }

  async function ensureLocalRootReady({
    requestPermission = false,
    silent = false
  }: {
    requestPermission?: boolean;
    silent?: boolean;
  } = {}): Promise<RootReadyResult> {
    const result = await sendOffscreenMessage<RootReadyResult>(
      "fs.ensureRoot",
      { requestPermission }
    );
    if (!result) {
      state.localRootReady = false;
      state.localRootSentinel = null;
      updateEffectiveRootState(state);
      if (!silent) {
        setLastError("No root directory selected.");
      }
      return { ok: false, error: "No root directory selected." };
    }

    state.localRootReady = Boolean(result.ok);
    state.localRootSentinel = result.ok ? result.sentinel : null;
    updateEffectiveRootState(state);
    if (!silent) {
      setLastError(result.ok ? "" : getErrorMessage(result as ErrorResult));
    }
    return result;
  }

  async function localFixtureExists(
    descriptor: FixtureDescriptor
  ): Promise<boolean> {
    const fixtureCheck = await sendOffscreenMessage<{
      ok: boolean;
      exists?: boolean;
      error?: string;
    }>("fs.hasFixture", { descriptor } as Record<string, unknown>);
    if (!fixtureCheck.ok) {
      throw new Error(fixtureCheck.error || "Fixture lookup failed.");
    }

    return Boolean(fixtureCheck.exists);
  }

  async function localReadFixture(
    descriptor: FixtureDescriptor
  ): Promise<StoredFixture | null> {
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

    if (
      !fixture.exists ||
      !fixture.meta ||
      !fixture.bodyBase64 ||
      !fixture.request
    ) {
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
  }): Promise<{
    written: boolean;
    descriptor: FixtureDescriptor;
    sentinel: RootSentinel;
  }> {
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

  return {
    ensureLocalRootReady,
    ensureLegacySiteConfigsMigrated,
    closeOffscreenDocument,
    sendOffscreenMessage,
    readLocalEffectiveSiteConfigs,
    readLocalConfiguredSiteConfigs,
    readLocalEffectiveSiteConfigsResult,
    readLocalConfiguredSiteConfigsResult,
    writeLocalConfiguredSiteConfigs,
    writeLocalConfiguredSiteConfigsResult,
    localFixtureExists,
    localReadFixture,
    localWriteFixture
  };
}
