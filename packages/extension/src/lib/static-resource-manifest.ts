import { STATIC_RESOURCE_MANIFEST_FILE, STATIC_RESOURCE_MANIFEST_SCHEMA_VERSION } from "./constants.js";
import type { AssetFixtureDescriptor, ResponseMeta, StaticResourceManifest, StaticResourceManifestEntry } from "./types.js";

function stripTopOriginPrefix(topOriginKey: string, relativePath: string): string {
  const prefix = `${topOriginKey}/`;
  return relativePath.startsWith(prefix) ? relativePath.slice(prefix.length) : relativePath;
}

export function getStaticResourceManifestPath(descriptor: AssetFixtureDescriptor): string;
export function getStaticResourceManifestPath(
  descriptor: { assetLike: boolean; topOriginKey: string; manifestPath?: string | null }
): string | null;
export function getStaticResourceManifestPath(
  descriptor: { assetLike: boolean; topOriginKey: string; manifestPath?: string | null }
): string | null {
  if (!descriptor.assetLike) {
    return null;
  }

  return descriptor.manifestPath || `${descriptor.topOriginKey}/${STATIC_RESOURCE_MANIFEST_FILE}`;
}

function toRootRelativePath(descriptor: AssetFixtureDescriptor, relativePath: string): string {
  return descriptor.siteMode === "advanced"
    ? stripTopOriginPrefix(descriptor.topOriginKey, relativePath)
    : relativePath;
}

export function createStaticResourceManifestEntry(
  descriptor: AssetFixtureDescriptor,
  responseMeta: ResponseMeta
): StaticResourceManifestEntry {
  const requestUrl = new URL(descriptor.requestUrl);

  return {
    requestUrl: descriptor.requestUrl,
    requestOrigin: descriptor.requestOrigin,
    pathname: requestUrl.pathname || "/",
    search: requestUrl.search,
    bodyPath: toRootRelativePath(descriptor, descriptor.bodyPath),
    requestPath: toRootRelativePath(descriptor, descriptor.requestPath),
    metaPath: toRootRelativePath(descriptor, descriptor.metaPath),
    mimeType: responseMeta.mimeType,
    resourceType: responseMeta.resourceType,
    capturedAt: responseMeta.capturedAt
  };
}

export function createStaticResourceManifest(descriptor: AssetFixtureDescriptor): StaticResourceManifest {
  return {
    schemaVersion: STATIC_RESOURCE_MANIFEST_SCHEMA_VERSION,
    topOrigin: descriptor.topOrigin,
    topOriginKey: descriptor.topOriginKey,
    generatedAt: new Date().toISOString(),
    resourcesByPathname: {}
  };
}

export function upsertStaticResourceManifest(
  manifest: StaticResourceManifest,
  entry: StaticResourceManifestEntry
): StaticResourceManifest {
  const resourcesByPathname = { ...manifest.resourcesByPathname };
  const currentEntries = resourcesByPathname[entry.pathname] || [];
  const nextEntries = [
    ...currentEntries.filter((currentEntry) => currentEntry.requestUrl !== entry.requestUrl),
    entry
  ].sort((left, right) => left.requestUrl.localeCompare(right.requestUrl));

  resourcesByPathname[entry.pathname] = nextEntries;

  return {
    ...manifest,
    generatedAt: entry.capturedAt,
    resourcesByPathname
  };
}
