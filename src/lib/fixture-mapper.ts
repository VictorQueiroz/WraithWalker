import {
  FIXTURE_FILE_NAMES,
  LEGACY_SITE_MODE,
  SIMPLE_MODE_METADATA_DIR,
  SIMPLE_MODE_METADATA_TREE,
  STATIC_RESOURCE_MANIFEST_FILE
} from "./constants.js";
import { shortHash } from "./hash.js";
import {
  appendHashToFileName,
  getRequestHostKey,
  isAssetLikeRequest,
  originToKey,
  sanitizeSegment,
  splitPathSegments,
  splitSimpleModePath
} from "./path-utils.js";
import type { FixtureDescriptor, HeaderEntry, SiteMode } from "./types.js";

function joinParts(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join("/");
}

export async function createFixtureDescriptor({
  topOrigin,
  method,
  url,
  postData = "",
  postDataEncoding = "utf8",
  siteMode = LEGACY_SITE_MODE,
  resourceType = "",
  mimeType = ""
}: {
  topOrigin: string;
  method: string;
  url: string;
  postData?: string;
  postDataEncoding?: string;
  siteMode?: SiteMode;
  resourceType?: string;
  mimeType?: string;
}): Promise<FixtureDescriptor> {
  const requestUrl = new URL(url);
  const requestOrigin = requestUrl.origin;
  const methodUpper = method.toUpperCase();
  const queryHash = await shortHash(requestUrl.search || "");
  const bodyHashSource = postData ? `${postDataEncoding}:${postData}` : "";
  const bodyHash = await shortHash(bodyHashSource);
  const topOriginKey = originToKey(topOrigin);
  const requestOriginKey = originToKey(requestOrigin);

  if (siteMode === "simple" && methodUpper === "GET") {
    const pathSegments = splitSimpleModePath(requestUrl.pathname);
    const fileName = pathSegments[pathSegments.length - 1] || "index";
    const slug = sanitizeSegment(fileName);
    const requestHostKey = sanitizeSegment(getRequestHostKey(url));
    const visiblePathParts = [requestHostKey, ...pathSegments];
    const bodyPath = joinParts(visiblePathParts);
    const hiddenFixtureRoot = joinParts([
      SIMPLE_MODE_METADATA_DIR,
      SIMPLE_MODE_METADATA_TREE,
      topOriginKey,
      ...visiblePathParts
    ]);

    return {
      assetLike: true,
      topOrigin,
      topOriginKey,
      requestOrigin,
      requestOriginKey,
      requestUrl: requestUrl.toString(),
      method: methodUpper,
      siteMode,
      postDataEncoding,
      queryHash,
      bodyHash,
      bodyPath,
      requestPath: `${hiddenFixtureRoot}.__request.json`,
      metaPath: `${hiddenFixtureRoot}.__response.json`,
      manifestPath: joinParts([
        SIMPLE_MODE_METADATA_DIR,
        SIMPLE_MODE_METADATA_TREE,
        topOriginKey,
        STATIC_RESOURCE_MANIFEST_FILE
      ]),
      metadataOptional: true,
      slug,
      storageMode: "asset"
    };
  }

  const baseParts =
    siteMode === "simple"
      ? [SIMPLE_MODE_METADATA_DIR, SIMPLE_MODE_METADATA_TREE, topOriginKey, "origins", requestOriginKey]
      : [topOriginKey, "origins", requestOriginKey];
  const assetLike = isAssetLikeRequest({ method: methodUpper, url, resourceType, mimeType });

  if (assetLike) {
    const pathSegments = splitPathSegments(requestUrl.pathname);
    const originalFileName = pathSegments.pop() || "index";
    const hashedFileName = requestUrl.search
      ? appendHashToFileName(originalFileName, `__q-${queryHash}`)
      : originalFileName;
    const directory = joinParts([...baseParts, "assets", ...pathSegments]);
    const bodyPath = joinParts([directory, hashedFileName]);

    return {
      assetLike,
      topOrigin,
      topOriginKey,
      requestOrigin,
      requestOriginKey,
      requestUrl: requestUrl.toString(),
      method: methodUpper,
      siteMode,
      postDataEncoding,
      queryHash,
      bodyHash,
      bodyPath,
      requestPath: `${bodyPath}.__request.json`,
      metaPath: `${bodyPath}.__response.json`,
      manifestPath: siteMode === "simple"
        ? joinParts([
            SIMPLE_MODE_METADATA_DIR,
            SIMPLE_MODE_METADATA_TREE,
            topOriginKey,
            STATIC_RESOURCE_MANIFEST_FILE
          ])
        : `${topOriginKey}/${STATIC_RESOURCE_MANIFEST_FILE}`,
      metadataOptional: false,
      slug: sanitizeSegment(originalFileName),
      storageMode: "asset"
    };
  }

  const pathSegments = splitPathSegments(requestUrl.pathname);
  const slug = sanitizeSegment(pathSegments.join("-") || "root");
  const directory = joinParts([
    ...baseParts,
    "http",
    methodUpper,
    `${slug}__q-${queryHash}__b-${bodyHash}`
  ]);
  return {
    assetLike: false,
    topOrigin,
    topOriginKey,
    requestOrigin,
    requestOriginKey,
    requestUrl: requestUrl.toString(),
    method: methodUpper,
    siteMode,
    postDataEncoding,
    queryHash,
    bodyHash,
    directory,
    requestPath: joinParts([directory, FIXTURE_FILE_NAMES.API_REQUEST]),
    metaPath: joinParts([directory, FIXTURE_FILE_NAMES.API_META]),
    bodyPath: joinParts([directory, "response.body"]),
    manifestPath: null,
    metadataOptional: false,
    slug,
    storageMode: "api"
  };
}

export function sanitizeResponseHeaders(headers: HeaderEntry[] = []): HeaderEntry[] {
  const filtered: HeaderEntry[] = [];
  const seen = new Set<string>();

  for (const header of headers) {
    const name = header.name.toLowerCase();
    if (seen.has(name) && name !== "set-cookie") {
      continue;
    }
    seen.add(name);
    filtered.push({ name: header.name, value: header.value });
  }

  return filtered;
}
