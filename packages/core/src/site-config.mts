import { normalizeSiteInput } from "./fixture-layout.mjs";

export interface SiteConfig {
  origin: string;
  createdAt: string;
  dumpAllowlistPatterns: string[];
}

type RawSiteConfig = Partial<SiteConfig> & {
  origin: string;
  dumpAllowlistPattern?: string;
};

export const DEFAULT_DUMP_ALLOWLIST_PATTERN = "\\.m?(js|ts)x?$";
export const DEFAULT_DUMP_ALLOWLIST_PATTERNS: string[] = [
  DEFAULT_DUMP_ALLOWLIST_PATTERN,
  "\\.css$",
  "\\.wasm$"
];
export const EXPLICIT_SITE_EXTRA_DUMP_ALLOWLIST_PATTERNS: string[] = [
  "\\.json$"
];
export const DISCOVERED_SITE_CREATED_AT = new Date(0).toISOString();

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
      (pattern): pattern is string =>
        typeof pattern === "string" &&
        pattern.trim() !== "" &&
        isValidDumpAllowlistPattern(pattern)
    );
    return valid.length > 0 ? valid : [...DEFAULT_DUMP_ALLOWLIST_PATTERNS];
  }

  if (
    typeof patterns === "string" &&
    patterns.trim() &&
    isValidDumpAllowlistPattern(patterns)
  ) {
    return [patterns];
  }

  return [...DEFAULT_DUMP_ALLOWLIST_PATTERNS];
}

export function normalizeSiteConfig(siteConfig: RawSiteConfig): SiteConfig {
  const rawPatterns =
    siteConfig.dumpAllowlistPatterns ?? siteConfig.dumpAllowlistPattern;

  return {
    origin: normalizeSiteInput(siteConfig.origin),
    createdAt:
      typeof siteConfig.createdAt === "string" && siteConfig.createdAt
        ? siteConfig.createdAt
        : new Date().toISOString(),
    dumpAllowlistPatterns: normalizeDumpAllowlistPatterns(rawPatterns)
  };
}

function isEarlierCreatedAt(candidate: string, current: string): boolean {
  const candidateTime = Date.parse(candidate);
  const currentTime = Date.parse(current);

  if (Number.isFinite(candidateTime) && Number.isFinite(currentTime)) {
    return candidateTime < currentTime;
  }

  if (Number.isFinite(candidateTime)) {
    return true;
  }

  if (Number.isFinite(currentTime)) {
    return false;
  }

  return candidate < current;
}

function mergeDumpAllowlistPatterns(
  current: string[],
  incoming: string[]
): string[] {
  return [
    ...current,
    ...incoming.filter((pattern) => !current.includes(pattern))
  ];
}

export function normalizeSiteConfigs(
  siteConfigs: RawSiteConfig[]
): SiteConfig[] {
  const merged = new Map<string, SiteConfig>();

  for (const siteConfig of siteConfigs.map(normalizeSiteConfig)) {
    const existing = merged.get(siteConfig.origin);
    if (!existing) {
      merged.set(siteConfig.origin, {
        ...siteConfig,
        dumpAllowlistPatterns: [...siteConfig.dumpAllowlistPatterns]
      });
      continue;
    }

    merged.set(siteConfig.origin, {
      origin: siteConfig.origin,
      createdAt: isEarlierCreatedAt(siteConfig.createdAt, existing.createdAt)
        ? siteConfig.createdAt
        : existing.createdAt,
      dumpAllowlistPatterns: mergeDumpAllowlistPatterns(
        existing.dumpAllowlistPatterns,
        siteConfig.dumpAllowlistPatterns
      )
    });
  }

  return [...merged.values()].sort((left, right) =>
    left.origin.localeCompare(right.origin)
  );
}

export function createSiteConfig(originInput: string): SiteConfig {
  return {
    origin: normalizeSiteInput(originInput),
    createdAt: new Date().toISOString(),
    dumpAllowlistPatterns: [...DEFAULT_DUMP_ALLOWLIST_PATTERNS]
  };
}

export function createConfiguredSiteConfig(originInput: string): SiteConfig {
  const siteConfig = createSiteConfig(originInput);

  return {
    ...siteConfig,
    dumpAllowlistPatterns: [
      ...new Set([
        ...siteConfig.dumpAllowlistPatterns,
        ...EXPLICIT_SITE_EXTRA_DUMP_ALLOWLIST_PATTERNS
      ])
    ]
  };
}

export function createDiscoveredSiteConfig(originInput: string): SiteConfig {
  return {
    origin: normalizeSiteInput(originInput),
    createdAt: DISCOVERED_SITE_CREATED_AT,
    dumpAllowlistPatterns: [...DEFAULT_DUMP_ALLOWLIST_PATTERNS]
  };
}

export function mergeSiteConfigs(
  explicitSiteConfigs: SiteConfig[],
  discoveredSiteConfigs: Array<Pick<SiteConfig, "origin">>
): SiteConfig[] {
  const merged = new Map<string, SiteConfig>();

  for (const config of discoveredSiteConfigs) {
    merged.set(
      normalizeSiteInput(config.origin),
      createDiscoveredSiteConfig(config.origin)
    );
  }

  for (const config of normalizeSiteConfigs(explicitSiteConfigs)) {
    merged.set(config.origin, {
      ...config,
      dumpAllowlistPatterns: [...config.dumpAllowlistPatterns]
    });
  }

  return [...merged.values()].sort((left, right) =>
    left.origin.localeCompare(right.origin)
  );
}

export function shouldDumpRequest(
  siteConfig: SiteConfig,
  method: string,
  url: string
): boolean {
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

  return siteConfig.dumpAllowlistPatterns.some((pattern) =>
    new RegExp(pattern).test(requestUrl.pathname)
  );
}
