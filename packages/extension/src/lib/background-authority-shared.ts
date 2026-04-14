import type { SiteConfigsResult, RootReadySuccess } from "./messages.js";
import type { BackgroundState } from "./background-runtime-shared.js";
import type { RootSentinel, SiteConfig } from "./types.js";

export function normalizeEffectiveSiteConfigs(
  siteConfigs: SiteConfig[],
  normalizeSiteConfigs: (siteConfigs: Array<Partial<SiteConfig> & { origin: string }>) => SiteConfig[]
): SiteConfig[] {
  return normalizeSiteConfigs(siteConfigs as Array<Partial<SiteConfig> & { origin: string }>);
}

export function haveSameSiteConfigs(left: SiteConfig[], right: SiteConfig[]): boolean {
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

export function currentEffectiveSiteConfigs(
  state: BackgroundState,
  normalizeSiteConfigs: (siteConfigs: Array<Partial<SiteConfig> & { origin: string }>) => SiteConfig[]
): SiteConfig[] {
  return normalizeEffectiveSiteConfigs([...state.siteConfigsByOrigin.values()], normalizeSiteConfigs);
}

export function applyEffectiveSiteConfigs(
  state: BackgroundState,
  siteConfigs: SiteConfig[],
  normalizeSiteConfigs: (siteConfigs: Array<Partial<SiteConfig> & { origin: string }>) => SiteConfig[]
): boolean {
  const normalized = normalizeEffectiveSiteConfigs(siteConfigs, normalizeSiteConfigs);
  if (haveSameSiteConfigs(currentEffectiveSiteConfigs(state, normalizeSiteConfigs), normalized)) {
    return false;
  }

  state.enabledOrigins = normalized.map((siteConfig) => siteConfig.origin);
  state.siteConfigsByOrigin = new Map(normalized.map((siteConfig) => [siteConfig.origin, siteConfig]));
  return true;
}

export function restoreLocalEffectiveSiteConfigs(
  state: BackgroundState,
  normalizeSiteConfigs: (siteConfigs: Array<Partial<SiteConfig> & { origin: string }>) => SiteConfig[]
): boolean {
  return applyEffectiveSiteConfigs(state, [...state.localSiteConfigsByOrigin.values()], normalizeSiteConfigs);
}

export function updateEffectiveRootState(state: BackgroundState): void {
  if (state.serverInfo) {
    state.rootReady = true;
    state.rootSentinel = state.serverInfo.sentinel;
    return;
  }

  state.rootReady = state.localRootReady;
  state.rootSentinel = state.localRootSentinel;
}

export function toSiteConfigsResult(
  siteConfigs: SiteConfig[],
  sentinel: RootSentinel,
  normalizeSiteConfigs: (siteConfigs: Array<Partial<SiteConfig> & { origin: string }>) => SiteConfig[]
): SiteConfigsResult {
  return {
    ok: true,
    siteConfigs: normalizeEffectiveSiteConfigs(siteConfigs, normalizeSiteConfigs),
    sentinel
  };
}

export function normalizeSiteConfigsResult(
  result: SiteConfigsResult,
  normalizeSiteConfigs: (siteConfigs: Array<Partial<SiteConfig> & { origin: string }>) => SiteConfig[]
): SiteConfigsResult {
  if (result.ok !== true) {
    return result;
  }

  return toSiteConfigsResult(
    Array.isArray(result.siteConfigs) ? result.siteConfigs : [],
    result.sentinel,
    normalizeSiteConfigs
  );
}

export function mergeLegacySiteConfigs(
  configuredSiteConfigs: SiteConfig[],
  legacySiteConfigs: SiteConfig[],
  normalizeSiteConfigs: (siteConfigs: Array<Partial<SiteConfig> & { origin: string }>) => SiteConfig[]
): SiteConfig[] {
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

  return normalizeEffectiveSiteConfigs([...merged.values()], normalizeSiteConfigs);
}

export function getRequiredRootId(rootResult: RootReadySuccess): string | null {
  const rootId = (rootResult.sentinel as RootSentinel | undefined)?.rootId;
  return typeof rootId === "string" && rootId.trim() ? rootId : null;
}
