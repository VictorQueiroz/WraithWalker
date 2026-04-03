import { DEFAULT_DUMP_ALLOWLIST_PATTERN, DEFAULT_SITE_MODE, LEGACY_SITE_MODE } from "./constants.js";
import { normalizeSiteInput } from "./path-utils.js";
import type { SiteConfig, SiteMode } from "./types.js";

function isSiteMode(value: unknown): value is SiteMode {
  return value === "simple" || value === "advanced";
}

export function isValidDumpAllowlistPattern(pattern: string): boolean {
  try {
    void new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export function normalizeDumpAllowlistPattern(pattern: unknown): string {
  if (typeof pattern !== "string" || !pattern.trim()) {
    return DEFAULT_DUMP_ALLOWLIST_PATTERN;
  }

  return isValidDumpAllowlistPattern(pattern)
    ? pattern
    : DEFAULT_DUMP_ALLOWLIST_PATTERN;
}

export function normalizeSiteConfig(siteConfig: Partial<SiteConfig> & { origin: string }): SiteConfig {
  return {
    origin: normalizeSiteInput(siteConfig.origin),
    createdAt: typeof siteConfig.createdAt === "string" && siteConfig.createdAt
      ? siteConfig.createdAt
      : new Date().toISOString(),
    mode: isSiteMode(siteConfig.mode) ? siteConfig.mode : LEGACY_SITE_MODE,
    dumpAllowlistPattern: normalizeDumpAllowlistPattern(siteConfig.dumpAllowlistPattern)
  };
}

export function normalizeSiteConfigs(siteConfigs: Array<Partial<SiteConfig> & { origin: string }>): SiteConfig[] {
  return siteConfigs
    .map(normalizeSiteConfig)
    .sort((left, right) => left.origin.localeCompare(right.origin));
}

export function createSiteConfig(originInput: string): SiteConfig {
  return {
    origin: normalizeSiteInput(originInput),
    createdAt: new Date().toISOString(),
    mode: DEFAULT_SITE_MODE,
    dumpAllowlistPattern: DEFAULT_DUMP_ALLOWLIST_PATTERN
  };
}

export function shouldDumpRequest(siteConfig: SiteConfig, method: string, url: string): boolean {
  if (method.toUpperCase() !== "GET") {
    return false;
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(url);
  } catch {
    return false;
  }

  if (!["http:", "https:"].includes(requestUrl.protocol)) {
    return false;
  }

  return new RegExp(siteConfig.dumpAllowlistPattern).test(requestUrl.pathname);
}
