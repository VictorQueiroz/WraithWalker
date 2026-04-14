import {
  CAPTURE_ASSETS_DIR,
  CAPTURE_HTTP_DIR,
  FIXTURE_FILE_NAMES,
  MANIFESTS_DIR,
  STATIC_RESOURCE_MANIFEST_FILE
} from "./constants.mjs";
export {
  CAPTURE_ASSETS_DIR,
  CAPTURE_HTTP_DIR,
  FIXTURE_FILE_NAMES,
  MANIFESTS_DIR,
  STATIC_RESOURCE_MANIFEST_FILE
} from "./constants.mjs";

const SAFE_SEGMENT_REGEX = /[^a-zA-Z0-9._-]+/g;

const SIMPLE_MIME_BY_EXTENSION = new Map<string, string>([
  ["css", "text/css"],
  ["gif", "image/gif"],
  ["html", "text/html"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["js", "application/javascript"],
  ["jsx", "application/javascript"],
  ["json", "application/json"],
  ["mjs", "application/javascript"],
  ["mp3", "audio/mpeg"],
  ["mp4", "video/mp4"],
  ["otf", "font/otf"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["ts", "text/plain"],
  ["tsx", "application/javascript"],
  ["txt", "text/plain"],
  ["wasm", "application/wasm"],
  ["woff", "font/woff"],
  ["woff2", "font/woff2"],
  ["xml", "application/xml"]
]);

const DIRECT_EXTENSION_MATCHES = new Map<string, string>([
  ["application/json", "json"],
  ["application/javascript", "js"],
  ["text/javascript", "js"],
  ["text/css", "css"],
  ["text/html", "html"],
  ["text/plain", "txt"],
  ["text/xml", "xml"],
  ["application/xml", "xml"],
  ["application/wasm", "wasm"],
  ["font/ttf", "ttf"],
  ["font/otf", "otf"],
  ["font/woff", "woff"],
  ["font/woff2", "woff2"],
  ["image/svg+xml", "svg"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"]
]);

const BODY_DERIVED_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding"
]);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade"
]);

export const STATIC_RESOURCE_MANIFEST_SCHEMA_VERSION = 2;

export interface HeaderEntry {
  name: string;
  value: string;
}

export interface AssetLikeRequestInput {
  method: string;
  url: string;
  resourceType?: string;
  mimeType?: string;
}

export interface FixtureDescriptorBase {
  topOrigin: string;
  topOriginKey: string;
  requestOrigin: string;
  requestOriginKey: string;
  requestUrl: string;
  method: string;
  postDataEncoding: string;
  queryHash: string;
  bodyHash: string;
  bodyPath: string;
  projectionPath?: string | null;
  requestPath: string;
  metaPath: string;
  manifestPath: string | null;
  metadataOptional: boolean;
  slug: string;
}

export interface AssetFixtureDescriptor extends FixtureDescriptorBase {
  assetLike: true;
  storageMode: "asset";
}

export interface ApiFixtureDescriptor extends FixtureDescriptorBase {
  assetLike: false;
  directory: string;
  storageMode: "api";
}

export type FixtureDescriptor = AssetFixtureDescriptor | ApiFixtureDescriptor;

export interface RequestPayload {
  topOrigin: string;
  url: string;
  method: string;
  headers: HeaderEntry[];
  body: string;
  bodyEncoding: string;
  bodyHash: string;
  queryHash: string;
  capturedAt: string;
}

export interface ResponseMeta {
  status: number;
  statusText: string;
  headers: HeaderEntry[];
  headerStrategy?: "live" | "stored";
  mimeType: string;
  resourceType: string;
  url: string;
  method: string;
  capturedAt: string;
  bodyEncoding: string;
  bodySuggestedExtension: string;
}

export interface StoredFixture {
  request: RequestPayload;
  meta: ResponseMeta;
  bodyBase64: string;
  size: number;
}

export interface StaticResourceManifestEntry {
  requestUrl: string;
  requestOrigin: string;
  pathname: string;
  search: string;
  bodyPath: string;
  projectionPath?: string | null;
  requestPath: string;
  metaPath: string;
  mimeType: string;
  resourceType: string;
  capturedAt: string;
}

export interface StaticResourceManifest {
  schemaVersion: number;
  topOrigin: string;
  topOriginKey: string;
  generatedAt: string;
  resourcesByPathname: Record<string, StaticResourceManifestEntry[]>;
}

interface RequestPayloadBuilderInput {
  topOrigin: string;
  url: string;
  method: string;
  requestHeaders: HeaderEntry[];
  requestBody: string;
  requestBodyEncoding: string;
  descriptor?: Pick<FixtureDescriptorBase, "bodyHash" | "queryHash"> | null;
}

interface ResponseMetaBuilderInput {
  responseStatus: number;
  responseStatusText: string;
  responseHeaders: HeaderEntry[];
  mimeType: string;
  resourceType: string;
  url: string;
  method: string;
}

const encoder = new TextEncoder();

function joinParts(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join("/");
}

function buildSimpleAssetSidecarPath(
  hiddenFixtureRoot: string,
  queryHash: string,
  search: string,
  suffix: string
): string {
  const queryVariantSuffix = search ? `.__q-${queryHash}` : "";
  return `${hiddenFixtureRoot}${queryVariantSuffix}${suffix}`;
}

function buildSimpleAssetBodyPath(
  hiddenFixtureRoot: string,
  queryHash: string,
  search: string
): string {
  return buildSimpleAssetSidecarPath(
    hiddenFixtureRoot,
    queryHash,
    search,
    ".__body"
  );
}

export function normalizeSiteInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Origin is required.");
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(candidate);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https origins are supported.");
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

export function originToPermissionPattern(origin: string): string {
  const url = new URL(origin);
  return `${url.origin}/*`;
}

export function sanitizeSegment(value: string): string {
  return (
    String(value)
      .trim()
      .replace(SAFE_SEGMENT_REGEX, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "root"
  );
}

export function originToKey(origin: string): string {
  const url = new URL(origin);
  const protocol = url.protocol.replace(":", "");
  const port = url.port ? `__${url.port}` : "";
  return `${protocol}__${sanitizeSegment(url.hostname)}${port}`;
}

export function splitPathSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => sanitizeSegment(decodeURIComponent(segment)));
}

export function getRequestHostKey(url: string): string {
  const requestUrl = new URL(url);
  return requestUrl.port
    ? `${requestUrl.hostname}__${requestUrl.port}`
    : requestUrl.hostname;
}

export function splitSimpleModePath(pathname: string): string[] {
  const pathSegments = splitPathSegments(pathname);
  if (!pathSegments.length || pathname.endsWith("/")) {
    return [...pathSegments, "index"];
  }

  return pathSegments;
}

export function getFileNameParts(fileName: string): {
  stem: string;
  extension: string;
} {
  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
    return { stem: fileName, extension: "" };
  }

  return {
    stem: fileName.slice(0, lastDotIndex),
    extension: fileName.slice(lastDotIndex + 1)
  };
}

export function appendHashToFileName(
  fileName: string,
  hashLabel: string
): string {
  const { stem, extension } = getFileNameParts(fileName);
  return extension ? `${stem}${hashLabel}.${extension}` : `${stem}${hashLabel}`;
}

export function isAssetLikeRequest({
  method,
  url,
  resourceType = "",
  mimeType = ""
}: AssetLikeRequestInput): boolean {
  if (method.toUpperCase() !== "GET") {
    return false;
  }

  const pathname = new URL(url).pathname;
  const lowerPath = pathname.toLowerCase();
  const lowerType = resourceType.toLowerCase();
  const lowerMime = mimeType.toLowerCase();

  if (/\.[a-z0-9]{1,8}$/i.test(lowerPath)) {
    return true;
  }

  return (
    ["document", "script", "stylesheet", "image", "font", "media"].includes(
      lowerType
    ) ||
    [
      "text/html",
      "application/javascript",
      "text/javascript",
      "text/css",
      "font/",
      "image/",
      "audio/",
      "video/"
    ].some((prefix) => lowerMime.startsWith(prefix))
  );
}

export function deriveExtensionFromMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();

  if (DIRECT_EXTENSION_MATCHES.has(normalized)) {
    return DIRECT_EXTENSION_MATCHES.get(normalized)!;
  }

  const [type, subtype = ""] = normalized.split("/");
  if (!type || !subtype) {
    return "body";
  }

  if (subtype.includes("+json")) {
    return "json";
  }

  if (subtype.includes("+xml")) {
    return "xml";
  }

  if (["image", "audio", "video", "font", "text"].includes(type)) {
    return sanitizeSegment(subtype);
  }

  return "body";
}

export function deriveMimeTypeFromPathname(pathname: string): string {
  const pathSegments = splitSimpleModePath(pathname);
  const fileName = pathSegments[pathSegments.length - 1];
  const { extension } = getFileNameParts(fileName);
  return (
    SIMPLE_MIME_BY_EXTENSION.get(extension.toLowerCase()) ||
    "application/octet-stream"
  );
}

export async function sha256Hex(
  value: string | ArrayBuffer | ArrayBufferView
): Promise<string> {
  const bytes =
    typeof value === "string"
      ? encoder.encode(value)
      : ArrayBuffer.isView(value)
        ? value
        : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes as never);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function shortHash(
  value: string | ArrayBuffer | ArrayBufferView,
  length = 12
): Promise<string> {
  const fullHash = await sha256Hex(value);
  return fullHash.slice(0, length);
}

export async function createFixtureDescriptor({
  topOrigin,
  method,
  url,
  postData = "",
  postDataEncoding = "utf8",
  resourceType = "",
  mimeType = ""
}: {
  topOrigin: string;
  method: string;
  url: string;
  postData?: string;
  postDataEncoding?: string;
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
  const assetLike = isAssetLikeRequest({
    method: methodUpper,
    url,
    resourceType,
    mimeType
  });
  const hasTypeHints =
    resourceType.trim().length > 0 || mimeType.trim().length > 0;
  const useVisibleAssetProjection =
    methodUpper === "GET" && (assetLike || !hasTypeHints);

  if (useVisibleAssetProjection) {
    const pathSegments = splitSimpleModePath(requestUrl.pathname);
    const fileName = pathSegments[pathSegments.length - 1];
    const slug = sanitizeSegment(fileName);
    const requestHostKey = sanitizeSegment(getRequestHostKey(url));
    const visiblePathParts = [requestHostKey, ...pathSegments];
    const projectionPath = joinParts(visiblePathParts);
    const hiddenFixtureRoot = joinParts([
      CAPTURE_ASSETS_DIR,
      topOriginKey,
      ...visiblePathParts
    ]);
    const bodyPath = buildSimpleAssetBodyPath(
      hiddenFixtureRoot,
      queryHash,
      requestUrl.search
    );

    return {
      assetLike: true,
      topOrigin,
      topOriginKey,
      requestOrigin,
      requestOriginKey,
      requestUrl: requestUrl.toString(),
      method: methodUpper,
      postDataEncoding,
      queryHash,
      bodyHash,
      bodyPath,
      projectionPath,
      requestPath: buildSimpleAssetSidecarPath(
        hiddenFixtureRoot,
        queryHash,
        requestUrl.search,
        ".__request.json"
      ),
      metaPath: buildSimpleAssetSidecarPath(
        hiddenFixtureRoot,
        queryHash,
        requestUrl.search,
        ".__response.json"
      ),
      manifestPath: joinParts([
        MANIFESTS_DIR,
        topOriginKey,
        STATIC_RESOURCE_MANIFEST_FILE
      ]),
      metadataOptional: false,
      slug,
      storageMode: "asset"
    };
  }

  const baseParts = [
    CAPTURE_HTTP_DIR,
    topOriginKey,
    "origins",
    requestOriginKey
  ];

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
    postDataEncoding,
    queryHash,
    bodyHash,
    directory,
    requestPath: joinParts([directory, FIXTURE_FILE_NAMES.API_REQUEST]),
    metaPath: joinParts([directory, FIXTURE_FILE_NAMES.API_META]),
    bodyPath: joinParts([directory, "response.body"]),
    projectionPath: null,
    manifestPath: null,
    metadataOptional: false,
    slug,
    storageMode: "api"
  };
}

export function sanitizeResponseHeaders(
  headers: HeaderEntry[] = []
): HeaderEntry[] {
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

export function replayResponseHeaders(
  headers: HeaderEntry[] = []
): HeaderEntry[] {
  return sanitizeResponseHeaders(headers).filter((header) => {
    const lowerName = header.name.toLowerCase();
    return (
      !BODY_DERIVED_HEADERS.has(lowerName) && !HOP_BY_HOP_HEADERS.has(lowerName)
    );
  });
}

export function buildRequestPayload(
  input: RequestPayloadBuilderInput,
  capturedAt = new Date().toISOString()
): RequestPayload {
  return {
    topOrigin: input.topOrigin,
    url: input.url,
    method: input.method,
    headers: input.requestHeaders,
    body: input.requestBody,
    bodyEncoding: input.requestBodyEncoding,
    bodyHash: input.descriptor?.bodyHash || "",
    queryHash: input.descriptor?.queryHash || "",
    capturedAt
  };
}

export function buildResponseMeta(
  input: ResponseMetaBuilderInput,
  bodyEncoding: string,
  capturedAt = new Date().toISOString()
): ResponseMeta {
  return {
    status: input.responseStatus,
    statusText: input.responseStatusText,
    headers: sanitizeResponseHeaders(input.responseHeaders),
    mimeType: input.mimeType,
    resourceType: input.resourceType,
    url: input.url,
    method: input.method,
    capturedAt,
    bodyEncoding,
    bodySuggestedExtension: deriveExtensionFromMime(input.mimeType)
  };
}

export function getStaticResourceManifestPath(
  descriptor: AssetFixtureDescriptor
): string;
export function getStaticResourceManifestPath(descriptor: {
  assetLike: boolean;
  topOriginKey: string;
  manifestPath?: string | null;
}): string | null;
export function getStaticResourceManifestPath(descriptor: {
  assetLike: boolean;
  topOriginKey: string;
  manifestPath?: string | null;
}): string | null {
  if (!descriptor.assetLike) {
    return null;
  }

  return (
    descriptor.manifestPath ||
    `${MANIFESTS_DIR}/${descriptor.topOriginKey}/${STATIC_RESOURCE_MANIFEST_FILE}`
  );
}

export function createStaticResourceManifestEntry(
  descriptor: AssetFixtureDescriptor,
  responseMeta: ResponseMeta,
  options: { projectionPath?: string | null } = {}
): StaticResourceManifestEntry {
  const requestUrl = new URL(descriptor.requestUrl);
  const projectionPath =
    options.projectionPath !== undefined
      ? options.projectionPath
      : (descriptor.projectionPath ?? null);

  return {
    requestUrl: descriptor.requestUrl,
    requestOrigin: descriptor.requestOrigin,
    pathname: requestUrl.pathname,
    search: requestUrl.search,
    bodyPath: descriptor.bodyPath,
    ...(projectionPath ? { projectionPath } : {}),
    requestPath: descriptor.requestPath,
    metaPath: descriptor.metaPath,
    mimeType: responseMeta.mimeType,
    resourceType: responseMeta.resourceType,
    capturedAt: responseMeta.capturedAt
  };
}

export function getFixtureDisplayPath(
  fixture:
    | Pick<FixtureDescriptorBase, "bodyPath" | "projectionPath">
    | Pick<StaticResourceManifestEntry, "bodyPath" | "projectionPath">
): string {
  return fixture.projectionPath || fixture.bodyPath;
}

export function createStaticResourceManifest(
  descriptor: AssetFixtureDescriptor
): StaticResourceManifest {
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
    ...currentEntries.filter(
      (currentEntry) => currentEntry.requestUrl !== entry.requestUrl
    ),
    entry
  ].sort((left, right) => left.requestUrl.localeCompare(right.requestUrl));

  resourcesByPathname[entry.pathname] = nextEntries;

  return {
    ...manifest,
    generatedAt: entry.capturedAt,
    resourcesByPathname
  };
}
