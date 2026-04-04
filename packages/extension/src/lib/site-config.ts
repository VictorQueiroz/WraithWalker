import { DEFAULT_DUMP_ALLOWLIST_PATTERNS, DEFAULT_SITE_MODE, LEGACY_SITE_MODE } from "./constants.js";
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

export function isValidDumpAllowlistPatterns(patterns: string[]): boolean {
  return patterns.every(isValidDumpAllowlistPattern);
}

export function normalizeDumpAllowlistPatterns(patterns: unknown): string[] {
  if (Array.isArray(patterns)) {
    const valid = patterns.filter(
      (p): p is string => typeof p === "string" && p.trim() !== "" && isValidDumpAllowlistPattern(p)
    );
    return valid.length > 0 ? valid : DEFAULT_DUMP_ALLOWLIST_PATTERNS;
  }

  // Migrate legacy single-pattern string
  if (typeof patterns === "string" && patterns.trim() && isValidDumpAllowlistPattern(patterns)) {
    return [patterns];
  }

  return DEFAULT_DUMP_ALLOWLIST_PATTERNS;
}

export function normalizeSiteConfig(siteConfig: Partial<SiteConfig> & { origin: string } & { dumpAllowlistPattern?: string }): SiteConfig {
  // Support legacy single-pattern field during migration
  const rawPatterns = siteConfig.dumpAllowlistPatterns ?? siteConfig.dumpAllowlistPattern;
  return {
    origin: normalizeSiteInput(siteConfig.origin),
    createdAt: typeof siteConfig.createdAt === "string" && siteConfig.createdAt
      ? siteConfig.createdAt
      : new Date().toISOString(),
    mode: isSiteMode(siteConfig.mode) ? siteConfig.mode : LEGACY_SITE_MODE,
    dumpAllowlistPatterns: normalizeDumpAllowlistPatterns(rawPatterns)
  };
}

export function normalizeSiteConfigs(siteConfigs: Array<Partial<SiteConfig> & { origin: string } & { dumpAllowlistPattern?: string }>): SiteConfig[] {
  return siteConfigs
    .map(normalizeSiteConfig)
    .sort((left, right) => left.origin.localeCompare(right.origin));
}

export function createSiteConfig(originInput: string): SiteConfig {
  return {
    origin: normalizeSiteInput(originInput),
    createdAt: new Date().toISOString(),
    mode: DEFAULT_SITE_MODE,
    dumpAllowlistPatterns: [...DEFAULT_DUMP_ALLOWLIST_PATTERNS]
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

  return siteConfig.dumpAllowlistPatterns.some(
    (pattern) => new RegExp(pattern).test(requestUrl.pathname)
  );
}
