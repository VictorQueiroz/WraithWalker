import path from "node:path";

import {
  CAPTURE_HTTP_DIR,
  MANIFESTS_DIR,
  STATIC_RESOURCE_MANIFEST_FILE
} from "./constants.mjs";
import {
  getFixtureDisplayPath,
  originToKey,
  type ResponseMeta,
  type StaticResourceManifest,
  type StaticResourceManifestEntry
} from "./fixture-layout.mjs";
import { readEffectiveSiteConfigs } from "./project-config.mjs";
import { createFixtureRootFs } from "./root-fs.mjs";
import type {
  ApiEndpoint,
  AssetInfo,
  OriginInfo,
  SiteConfigLike
} from "./fixtures-types.mjs";

function compareAssetEntries(a: StaticResourceManifestEntry, b: StaticResourceManifestEntry): number {
  return a.pathname.localeCompare(b.pathname)
    || a.requestUrl.localeCompare(b.requestUrl)
    || getFixtureDisplayPath(a).localeCompare(getFixtureDisplayPath(b))
    || a.bodyPath.localeCompare(b.bodyPath);
}

function normalizeHttpOriginForDiscovery(origin: string): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return null;
  }

  return `${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}`;
}

export function matchesDiscoveryOrigin(candidateOrigin: string, requestedOrigin: string): boolean {
  const candidateKey = normalizeHttpOriginForDiscovery(candidateOrigin);
  const requestedKey = normalizeHttpOriginForDiscovery(requestedOrigin);

  if (candidateKey && requestedKey) {
    return candidateKey === requestedKey;
  }

  return candidateOrigin === requestedOrigin;
}

export function matchSiteConfigsByOrigin(
  configs: SiteConfigLike[],
  origin: string
): SiteConfigLike[] {
  return configs.filter((config) => matchesDiscoveryOrigin(config.origin, origin));
}

export function normalizeSiteConfigs(siteConfigOrConfigs: SiteConfigLike | SiteConfigLike[]): SiteConfigLike[] {
  const normalized = Array.isArray(siteConfigOrConfigs)
    ? siteConfigOrConfigs
    : [siteConfigOrConfigs];

  return [...normalized]
    .sort((left, right) => left.origin.localeCompare(right.origin));
}

export function uniqueOrigins(origins: Array<string | null | undefined>): string[] {
  return [...new Set(origins.filter((origin): origin is string => Boolean(origin)))].sort();
}

export function compareAssetInfos(a: AssetInfo, b: AssetInfo): number {
  return compareAssetEntries(a, b)
    || a.origin.localeCompare(b.origin);
}

export function compareApiEndpoints(a: ApiEndpoint, b: ApiEndpoint): number {
  return a.pathname.localeCompare(b.pathname)
    || a.method.localeCompare(b.method)
    || a.fixtureDir.localeCompare(b.fixtureDir)
    || a.origin.localeCompare(b.origin);
}

async function collectApiEndpoints(rootPath: string, baseRelativePath: string): Promise<ApiEndpoint[]> {
  const rootFs = createFixtureRootFs(rootPath);
  const endpoints: ApiEndpoint[] = [];
  const methods = await rootFs.listOptionalDirectories(path.join(baseRelativePath, "http"));

  for (const method of methods) {
    const fixtures = await rootFs.listOptionalDirectories(path.join(baseRelativePath, "http", method));
    for (const fixture of fixtures) {
      const fixtureRelativeDir = path.join(baseRelativePath, "http", method, fixture);
      const meta = await rootFs.readOptionalJson<ResponseMeta>(path.join(fixtureRelativeDir, "response.meta.json"));
      if (!meta) {
        continue;
      }

      const pathname = meta.url
        ? new URL(meta.url).pathname
        : fixture.replace(/__q-.*/, "").replace(/-/g, "/");

      endpoints.push({
        origin: "",
        method,
        pathname,
        status: meta.status,
        mimeType: meta.mimeType || "",
        resourceType: meta.resourceType || "",
        fixtureDir: fixtureRelativeDir,
        metaPath: path.join(fixtureRelativeDir, "response.meta.json"),
        bodyPath: path.join(fixtureRelativeDir, "response.body")
      });
    }
  }

  return endpoints;
}

export async function readOriginInfo(rootPath: string, siteConfig: SiteConfigLike): Promise<OriginInfo> {
  const rootFs = createFixtureRootFs(rootPath);
  const originKey = originToKey(siteConfig.origin);
  const manifestRelative = path.join(MANIFESTS_DIR, originKey, STATIC_RESOURCE_MANIFEST_FILE);
  const manifest = await rootFs.readOptionalJson<StaticResourceManifest>(manifestRelative);

  const originsBaseRelative = path.join(CAPTURE_HTTP_DIR, originKey, "origins");

  const apiEndpoints: ApiEndpoint[] = [];
  const originDirs = await rootFs.listOptionalDirectories(originsBaseRelative);
  for (const dir of originDirs) {
    const relativeBasePath = path.join(CAPTURE_HTTP_DIR, originKey, "origins", dir);
    const endpoints = await collectApiEndpoints(rootPath, relativeBasePath);
    apiEndpoints.push(...endpoints.map((endpoint) => ({
      ...endpoint,
      origin: siteConfig.origin
    })));
  }

  return {
    origin: siteConfig.origin,
    originKey,
    manifestPath: (await rootFs.exists(manifestRelative)) ? manifestRelative : null,
    manifest,
    apiEndpoints
  };
}

export function flattenStaticResourceManifest(
  manifest: StaticResourceManifest | null
): StaticResourceManifestEntry[] {
  if (!manifest) {
    return [];
  }

  return Object.values(manifest.resourcesByPathname)
    .flat()
    .sort(compareAssetEntries);
}

export async function readSiteConfigs(rootPath: string) {
  return readEffectiveSiteConfigs(rootPath);
}
