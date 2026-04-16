import {
  createConfiguredSiteConfig,
  createDiscoveredSiteConfig,
  createSiteConfig,
  DEFAULT_DUMP_ALLOWLIST_PATTERN,
  DEFAULT_DUMP_ALLOWLIST_PATTERNS,
  DISCOVERED_SITE_CREATED_AT,
  EXPLICIT_SITE_EXTRA_DUMP_ALLOWLIST_PATTERNS,
  isValidDumpAllowlistPattern,
  isValidDumpAllowlistPatterns,
  mergeSiteConfigs,
  normalizeDumpAllowlistPatterns,
  normalizeSiteConfig as coreNormalizeSiteConfig,
  normalizeSiteConfigs as coreNormalizeSiteConfigs,
  shouldDumpRequest
} from "@wraithwalker/core/site-config";
import type { SiteConfig } from "./types.js";

type RawSiteConfig = Partial<SiteConfig> & {
  origin: string;
  dumpAllowlistPattern?: string;
};

export function normalizeSiteConfig(siteConfig: RawSiteConfig): SiteConfig {
  return coreNormalizeSiteConfig(siteConfig);
}

export function normalizeSiteConfigs(
  siteConfigs: RawSiteConfig[]
): SiteConfig[] {
  return coreNormalizeSiteConfigs(siteConfigs);
}

export {
  createConfiguredSiteConfig,
  createDiscoveredSiteConfig,
  createSiteConfig,
  DEFAULT_DUMP_ALLOWLIST_PATTERN,
  DEFAULT_DUMP_ALLOWLIST_PATTERNS,
  DISCOVERED_SITE_CREATED_AT,
  EXPLICIT_SITE_EXTRA_DUMP_ALLOWLIST_PATTERNS,
  isValidDumpAllowlistPattern,
  isValidDumpAllowlistPatterns,
  mergeSiteConfigs,
  normalizeDumpAllowlistPatterns,
  shouldDumpRequest
};
