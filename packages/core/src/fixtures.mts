import { promises as fs } from "node:fs";
import path from "node:path";

import {
  CAPTURE_HTTP_DIR,
  MANIFESTS_DIR,
  ROOT_SENTINEL_RELATIVE_PATH,
  SCENARIOS_DIR,
  STATIC_RESOURCE_MANIFEST_FILE,
  WRAITHWALKER_DIR
} from "./constants.mjs";
import {
  getFixtureDisplayPath,
  originToKey,
  type ResponseMeta,
  type StaticResourceManifest,
  type StaticResourceManifestEntry
} from "./fixture-layout.mjs";
import { createProjectedFixturePayload, prettifyFixtureText } from "./fixture-presentation.mjs";
import { readEffectiveSiteConfigs } from "./project-config.mjs";
import { createFixtureRootFs, resolveWithinRoot, type FixtureRootFs } from "./root-fs.mjs";
import { mergeSiteConfigs, type SiteConfig } from "./site-config.mjs";

export type { ResponseMeta, StaticResourceManifest, StaticResourceManifestEntry } from "./fixture-layout.mjs";

export interface ApiEndpoint {
  origin: string;
  method: string;
  pathname: string;
  status: number;
  mimeType: string;
  resourceType: string;
  fixtureDir: string;
  metaPath: string;
  bodyPath: string;
}

export interface SiteConfigLike {
  origin: string;
}

export interface OriginInfo {
  origin: string;
  originKey: string;
  manifestPath: string | null;
  manifest: StaticResourceManifest | null;
  apiEndpoints: ApiEndpoint[];
}

export interface ApiFixture {
  fixtureDir: string;
  metaPath: string;
  bodyPath: string;
  meta: ResponseMeta;
  body: string | null;
}

export interface AssetListOptions {
  resourceTypes?: string[];
  mimeTypes?: string[];
  pathnameContains?: string;
  requestOrigin?: string;
  limit?: number;
  cursor?: string;
}

export interface AssetInfo extends StaticResourceManifestEntry {
  origin: string;
  path: string;
  hasBody: boolean;
  bodySize: number | null;
  editable: boolean;
  canonicalPath: string | null;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  totalMatched: number;
}

export interface SearchContentOptions {
  query: string;
  origin?: string;
  pathContains?: string;
  mimeTypes?: string[];
  resourceTypes?: string[];
  limit?: number;
  cursor?: string;
}

export interface SearchContentMatch {
  path: string;
  sourceKind: "asset" | "endpoint" | "file";
  matchKind: "body" | "path";
  matchCount: number;
  origin: string | null;
  pathname: string | null;
  mimeType: string | null;
  resourceType: string | null;
  excerpt: string;
  matchLine: number;
  matchColumn: number;
  editable: boolean;
  canonicalPath: string | null;
}

export interface ProjectionFileInfo {
  path: string;
  canonicalPath: string;
  metaPath: string;
  currentText: string | null;
  editable: boolean;
}

export interface PatchProjectionFileOptions {
  path: string;
  startLine: number;
  endLine: number;
  expectedText: string;
  replacement: string;
}

export interface FixtureSnippetOptions {
  pretty?: boolean;
  startLine?: number;
  lineCount?: number;
  maxBytes?: number;
}

export interface FixtureReadOptions {
  pretty?: boolean;
}

export interface FixtureSnippet {
  path: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
  text: string;
}

export interface DiscoveryResult<T> extends PaginatedResult<T> {
  matchedOrigins: string[];
}

export interface EndpointListResult {
  items: ApiEndpoint[];
  matchedOrigins: string[];
}

interface SearchableFixtureEntry {
  path: string;
  sourceKind: "asset" | "endpoint" | "file";
  origin: string | null;
  pathname: string | null;
  mimeType: string | null;
  resourceType: string | null;
  editable: boolean;
  canonicalPath: string | null;
}

interface ResolvedProjectionFile extends ProjectionFileInfo {
  projectionPayload: {
    body: string;
    bodyEncoding: "utf8" | "base64";
  };
}

type TextFixtureReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: "invalid-path" | "missing" | "binary" };

interface FixturePresentationContext {
  mimeType?: string | null;
  resourceType?: string | null;
}

const DEFAULT_ASSET_LIMIT = 50;
const MAX_ASSET_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
const DEFAULT_SNIPPET_LINE_COUNT = 80;
const MAX_SNIPPET_LINE_COUNT = 400;
const DEFAULT_SNIPPET_MAX_BYTES = 16000;
const MAX_SNIPPET_MAX_BYTES = 64000;
const MAX_FULL_READ_BYTES = 64 * 1024;
const EDITABLE_PROJECTION_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".htm",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt"
]);
const SEARCH_EXACT_EXCLUDE = new Set([
  ROOT_SENTINEL_RELATIVE_PATH,
  path.join(WRAITHWALKER_DIR, "cli.json")
]);
const SEARCH_SUFFIX_EXCLUDE = [
  STATIC_RESOURCE_MANIFEST_FILE,
  "__request.json",
  "__response.json",
  "response.meta.json"
];

function keyToOrigin(key: string): string {
  const match = key.match(/^(https?)__([^_](?:[^_]|_(?!_))*)(?:__(\d+))?$/);
  if (!match) return key;
  const [, protocol, hostname, port] = match;
  return port ? `${protocol}://${hostname}:${port}` : `${protocol}://${hostname}`;
}

function compareAssetEntries(a: StaticResourceManifestEntry, b: StaticResourceManifestEntry): number {
  return a.pathname.localeCompare(b.pathname)
    || a.requestUrl.localeCompare(b.requestUrl)
    || getFixtureDisplayPath(a).localeCompare(getFixtureDisplayPath(b))
    || a.bodyPath.localeCompare(b.bodyPath);
}

function normalizeLimit(limit: number | undefined, defaultLimit: number, maxLimit: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return defaultLimit;
  }

  const normalized = Math.trunc(limit);
  if (normalized < 1) {
    return defaultLimit;
  }

  return Math.min(normalized, maxLimit);
}

function encodeCursor(offset: number): string | null {
  return offset > 0
    ? Buffer.from(String(offset), "utf8").toString("base64url")
    : null;
}

function decodeCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new Error(`Invalid cursor: ${cursor}`);
  }

  const offset = Number.parseInt(decoded, 10);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`Invalid cursor: ${cursor}`);
  }

  return offset;
}

function paginateItems<T>(
  items: T[],
  limit: number,
  cursor?: string
): PaginatedResult<T> {
  const offset = decodeCursor(cursor);
  const pagedItems = items.slice(offset, offset + limit);
  const nextCursor = offset + limit < items.length
    ? encodeCursor(offset + limit)
    : null;

  return {
    items: pagedItems,
    nextCursor,
    totalMatched: items.length
  };
}

function normalizeSearchPath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function isHiddenFixturePath(relativePath: string): boolean {
  const normalized = normalizeSearchPath(relativePath);
  return normalized === WRAITHWALKER_DIR || normalized.startsWith(`${WRAITHWALKER_DIR}/`);
}

function isApiResponseBodyPath(relativePath: string): boolean {
  return normalizeSearchPath(relativePath).endsWith("/response.body");
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function isExcludedSearchPath(relativePath: string): boolean {
  const normalized = normalizeSearchPath(relativePath);
  if (isHiddenFixturePath(normalized)) {
    return true;
  }

  if (normalized.startsWith(`${normalizeSearchPath(SCENARIOS_DIR)}/`)) {
    return true;
  }

  if (SEARCH_EXACT_EXCLUDE.has(relativePath) || SEARCH_EXACT_EXCLUDE.has(normalized)) {
    return true;
  }

  return SEARCH_SUFFIX_EXCLUDE.some((suffix) => normalized.endsWith(normalizeSearchPath(suffix)));
}

function guessMimeType(relativePath: string): string | null {
  const extension = path.extname(relativePath).toLowerCase();

  switch (extension) {
    case ".css":
      return "text/css";
    case ".html":
    case ".htm":
      return "text/html";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "application/javascript";
    case ".json":
      return "application/json";
    case ".md":
      return "text/markdown";
    case ".svg":
      return "image/svg+xml";
    case ".ts":
      return "application/typescript";
    case ".tsx":
      return "text/tsx";
    case ".txt":
      return "text/plain";
    default:
      return null;
  }
}

function isEditableProjectionMimeType(value?: string | null): boolean {
  const mimeType = (value || "").split(";")[0]?.trim().toLowerCase() || "";
  if (!mimeType) {
    return false;
  }

  if (mimeType.startsWith("text/")) {
    return true;
  }

  return mimeType === "application/javascript"
    || mimeType === "text/javascript"
    || mimeType === "application/ecmascript"
    || mimeType === "text/ecmascript"
    || mimeType === "application/typescript"
    || mimeType === "text/typescript"
    || mimeType === "application/json"
    || mimeType.endsWith("+json")
    || mimeType === "image/svg+xml"
    || mimeType === "application/xml"
    || mimeType === "text/xml";
}

function isEditableProjectionResourceType(value?: string | null): boolean {
  const resourceType = (value || "").trim().toLowerCase();
  return resourceType === "document"
    || resourceType === "fetch"
    || resourceType === "script"
    || resourceType === "stylesheet"
    || resourceType === "xhr";
}

function isEditableProjectionPath(relativePath?: string | null): boolean {
  if (!relativePath) {
    return false;
  }

  return EDITABLE_PROJECTION_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function isEditableProjectionAsset(
  projectionPath: string | null | undefined,
  {
    mimeType,
    resourceType
  }: {
    mimeType?: string | null;
    resourceType?: string | null;
  }
): boolean {
  if (!projectionPath) {
    return false;
  }

  return isEditableProjectionMimeType(mimeType)
    || isEditableProjectionResourceType(resourceType)
    || isEditableProjectionPath(projectionPath);
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

async function readTextFixture(rootPath: string, relativePath: string): Promise<TextFixtureReadResult> {
  const absolutePath = resolveWithinRoot(rootPath, relativePath);
  if (!absolutePath) {
    return { ok: false, reason: "invalid-path" };
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(absolutePath);
  } catch {
    return { ok: false, reason: "missing" };
  }

  if (looksBinary(buffer)) {
    return { ok: false, reason: "binary" };
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "binary" };
  }
}

function splitTextLines(text: string): { lines: string[]; endsWithNewline: boolean } {
  const normalized = normalizeLineEndings(text);
  const endsWithNewline = normalized.endsWith("\n");
  if (!normalized) {
    return { lines: [], endsWithNewline: false };
  }

  const lines = normalized.split("\n");
  if (endsWithNewline) {
    lines.pop();
  }

  return { lines, endsWithNewline };
}

function joinTextLines(lines: string[], endsWithNewline: boolean): string {
  const joined = lines.join("\n");
  return endsWithNewline ? `${joined}\n` : joined;
}

function applyLinePatch(
  text: string,
  {
    startLine,
    endLine,
    expectedText,
    replacement
  }: Omit<PatchProjectionFileOptions, "path">
): string {
  if (!Number.isInteger(startLine) || startLine < 1) {
    throw new Error("startLine must be a positive integer.");
  }
  if (!Number.isInteger(endLine) || endLine < startLine) {
    throw new Error("endLine must be a positive integer greater than or equal to startLine.");
  }

  const { lines, endsWithNewline } = splitTextLines(text);
  if (endLine > lines.length) {
    throw new Error(`Patch range ${startLine}-${endLine} is outside the current file.`);
  }

  const currentRange = lines.slice(startLine - 1, endLine).join("\n");
  if (currentRange !== normalizeLineEndings(expectedText)) {
    throw new Error(`Patch conflict for ${startLine}-${endLine}: current file content no longer matches expectedText.`);
  }

  const replacementText = normalizeLineEndings(replacement);
  const replacementLines = replacementText === ""
    ? []
    : splitTextLines(replacementText).lines;

  lines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines);
  return joinTextLines(lines, endsWithNewline);
}

function createExcerpt(text: string, matchIndex: number, queryLength: number): string {
  const contextRadius = 60;
  const start = Math.max(0, matchIndex - contextRadius);
  const end = Math.min(text.length, matchIndex + queryLength + contextRadius);
  const excerpt = text
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim();

  return `${start > 0 ? "..." : ""}${excerpt}${end < text.length ? "..." : ""}`;
}

function findSubstringMatch(
  text: string,
  query: string
): Omit<
  SearchContentMatch,
  "path" | "sourceKind" | "matchKind" | "origin" | "pathname" | "mimeType" | "resourceType" | "editable" | "canonicalPath"
> | null {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);
  if (matchIndex === -1) {
    return null;
  }

  let matchCount = 0;
  let searchIndex = 0;
  while (true) {
    const nextIndex = lowerText.indexOf(lowerQuery, searchIndex);
    if (nextIndex === -1) {
      break;
    }
    matchCount += 1;
    searchIndex = nextIndex + lowerQuery.length;
  }

  const leadingText = text.slice(0, matchIndex);
  const lines = leadingText.split(/\r\n|\n|\r/);
  const line = lines.length;
  const column = (lines.at(-1) ?? "").length + 1;

  return {
    excerpt: createExcerpt(text, matchIndex, query.length),
    matchCount,
    matchLine: line,
    matchColumn: column
  };
}

function findPathMatch(
  entry: SearchableFixtureEntry,
  query: string
): Omit<
  SearchContentMatch,
  "path" | "sourceKind" | "matchKind" | "origin" | "pathname" | "mimeType" | "resourceType" | "editable" | "canonicalPath"
> | null {
  const candidates = [entry.pathname, entry.path]
    .filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const match = findSubstringMatch(candidate, query);
    if (!match) {
      continue;
    }

    return {
      excerpt: `Matched path: ${candidate}`,
      matchCount: 1,
      matchLine: 1,
      matchColumn: match.matchColumn
    };
  }

  return null;
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

function normalizeSiteConfigs(siteConfigOrConfigs: SiteConfigLike | SiteConfigLike[]): SiteConfigLike[] {
  const normalized = Array.isArray(siteConfigOrConfigs)
    ? siteConfigOrConfigs
    : [siteConfigOrConfigs];

  return [...normalized]
    .sort((left, right) => left.origin.localeCompare(right.origin));
}

function uniqueOrigins(origins: Array<string | null | undefined>): string[] {
  return [...new Set(origins.filter((origin): origin is string => Boolean(origin)))].sort();
}

function compareAssetInfos(a: AssetInfo, b: AssetInfo): number {
  return compareAssetEntries(a, b)
    || a.origin.localeCompare(b.origin);
}

function compareApiEndpoints(a: ApiEndpoint, b: ApiEndpoint): number {
  return a.pathname.localeCompare(b.pathname)
    || a.method.localeCompare(b.method)
    || a.fixtureDir.localeCompare(b.fixtureDir)
    || a.origin.localeCompare(b.origin);
}

async function assertWithinFullReadLimit(
  rootFs: FixtureRootFs,
  relativePath: string,
  createError: (byteLength: number, limit: number) => Error
): Promise<void> {
  const stat = await rootFs.stat(relativePath);
  if (!stat?.isFile()) {
    return;
  }

  if (stat.size > MAX_FULL_READ_BYTES) {
    throw createError(stat.size, MAX_FULL_READ_BYTES);
  }
}

function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return { text, truncated: false };
  }

  return {
    text: buffer.subarray(0, maxBytes).toString("utf8"),
    truncated: true
  };
}

async function findAssetPresentationContext(
  rootPath: string,
  relativePath: string
): Promise<FixturePresentationContext | null> {
  const configs = await readSiteConfigs(rootPath);

  for (const config of configs) {
    const info = await readOriginInfo(rootPath, config);
    for (const asset of flattenStaticResourceManifest(info.manifest)) {
      if (asset.bodyPath !== relativePath) {
        if (getFixtureDisplayPath(asset) !== relativePath) {
          continue;
        }
      }

      return {
        mimeType: asset.mimeType,
        resourceType: asset.resourceType
      };
    }
  }

  return null;
}

async function resolveFixturePresentationContext(
  rootPath: string,
  relativePath: string
): Promise<FixturePresentationContext | null> {
  if (path.basename(relativePath) === "response.body") {
    const metaPath = path.join(path.dirname(relativePath), "response.meta.json");
    const meta = await createFixtureRootFs(rootPath).readOptionalJson<ResponseMeta>(metaPath);
    if (meta) {
      return {
        mimeType: meta.mimeType,
        resourceType: meta.resourceType
      };
    }
  }

  return findAssetPresentationContext(rootPath, relativePath);
}

async function maybePrettifyFixtureText(
  rootPath: string,
  relativePath: string,
  text: string,
  options: FixtureReadOptions,
  context?: FixturePresentationContext | null
): Promise<string> {
  if (!options.pretty) {
    return text;
  }

  const resolvedContext = context ?? await resolveFixturePresentationContext(rootPath, relativePath);
  return prettifyFixtureText({
    relativePath,
    text,
    mimeType: resolvedContext?.mimeType,
    resourceType: resolvedContext?.resourceType
  });
}

async function listAllFiles(rootPath: string, relativeDir = ""): Promise<string[]> {
  const rootFs = createFixtureRootFs(rootPath);
  const entries = await rootFs.listOptionalDirectory(relativeDir);
  const files: string[] = [];

  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = relativeDir
      ? path.join(relativeDir, entry.name)
      : entry.name;

    if (entry.kind === "directory") {
      if (normalizeSearchPath(relativePath) === normalizeSearchPath(SCENARIOS_DIR)) {
        continue;
      }
      files.push(...await listAllFiles(rootPath, relativePath));
      continue;
    }

    files.push(relativePath);
  }

  return files;
}

async function buildSearchableFixtureEntries(rootPath: string): Promise<SearchableFixtureEntry[]> {
  const entries = new Map<string, SearchableFixtureEntry>();
  const configs = [...await readSiteConfigs(rootPath)]
    .sort((a, b) => a.origin.localeCompare(b.origin));

  for (const config of configs) {
    const info = await readOriginInfo(rootPath, config);

    for (const asset of flattenStaticResourceManifest(info.manifest)) {
      const displayPath = getFixtureDisplayPath(asset);
      if (!entries.has(displayPath)) {
        entries.set(displayPath, {
          path: displayPath,
          sourceKind: "asset",
          origin: info.origin,
          pathname: asset.pathname,
          mimeType: asset.mimeType || null,
          resourceType: asset.resourceType || null,
          editable: isEditableProjectionAsset(asset.projectionPath, asset),
          canonicalPath: asset.bodyPath
        });
      }
    }

    for (const endpoint of [...info.apiEndpoints].sort((a, b) => a.bodyPath.localeCompare(b.bodyPath))) {
      if (!entries.has(endpoint.bodyPath)) {
        entries.set(endpoint.bodyPath, {
          path: endpoint.bodyPath,
          sourceKind: "endpoint",
          origin: info.origin,
          pathname: endpoint.pathname,
          mimeType: endpoint.mimeType || null,
          resourceType: endpoint.resourceType || null,
          editable: false,
          canonicalPath: null
        });
      }
    }
  }

  for (const relativePath of await listAllFiles(rootPath)) {
    if (isExcludedSearchPath(relativePath) || entries.has(relativePath)) {
      continue;
    }

    entries.set(relativePath, {
      path: relativePath,
      sourceKind: "file",
      origin: null,
      pathname: null,
      mimeType: guessMimeType(relativePath),
      resourceType: null,
      editable: false,
      canonicalPath: null
    });
  }

  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
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
      if (!meta) continue;

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

async function findProjectionAsset(
  rootPath: string,
  relativePath: string
): Promise<StaticResourceManifestEntry | null> {
  const configs = await readSiteConfigs(rootPath);
  const normalizedTarget = normalizeSearchPath(relativePath);

  for (const config of configs) {
    const info = await readOriginInfo(rootPath, config);
    for (const asset of flattenStaticResourceManifest(info.manifest)) {
      if (asset.projectionPath && normalizeSearchPath(asset.projectionPath) === normalizedTarget) {
        return asset;
      }
    }
  }

  return null;
}

async function resolveProjectionFileDetails(
  rootPath: string,
  relativePath: string
): Promise<ResolvedProjectionFile | null> {
  if (isHiddenFixturePath(relativePath) || isApiResponseBodyPath(relativePath)) {
    return null;
  }

  const asset = await findProjectionAsset(rootPath, relativePath);
  if (!asset?.projectionPath) {
    return null;
  }

  const rootFs = createFixtureRootFs(rootPath);
  const [meta, currentTextResult, canonicalBodyBase64] = await Promise.all([
    rootFs.readOptionalJson<ResponseMeta>(asset.metaPath),
    readTextFixture(rootPath, asset.projectionPath),
    rootFs.readBodyAsBase64(asset.bodyPath).catch(() => null)
  ]);
  if (!meta || !canonicalBodyBase64) {
    return null;
  }

  const projectionPayload = await createProjectedFixturePayload({
    relativePath: asset.projectionPath,
    payload: {
      body: canonicalBodyBase64,
      bodyEncoding: "base64"
    },
    mimeType: meta.mimeType,
    resourceType: meta.resourceType
  });

  return {
    path: asset.projectionPath,
    canonicalPath: asset.bodyPath,
    metaPath: asset.metaPath,
    currentText: isEditableProjectionAsset(asset.projectionPath, meta) && currentTextResult.ok ? currentTextResult.text : null,
    editable: isEditableProjectionAsset(asset.projectionPath, meta) && projectionPayload.bodyEncoding === "utf8",
    projectionPayload
  };
}

function createProjectionEditError(relativePath: string): Error {
  if (isApiResponseBodyPath(relativePath)) {
    return new Error(`API response fixtures are read-only in this pass: ${relativePath}`);
  }
  if (isHiddenFixturePath(relativePath)) {
    return new Error(`Hidden canonical files under .wraithwalker cannot be edited with projection tools: ${relativePath}`);
  }
  return new Error(`File is not a projection-backed captured asset: ${relativePath}`);
}

async function requireProjectionFile(
  rootPath: string,
  relativePath: string
): Promise<ResolvedProjectionFile> {
  const resolvedPath = resolveWithinRoot(rootPath, relativePath);
  if (!resolvedPath) {
    throw new Error(`Invalid fixture path: ${relativePath}. Paths must stay within the fixture root.`);
  }

  const details = await resolveProjectionFileDetails(rootPath, relativePath);
  if (!details) {
    throw createProjectionEditError(relativePath);
  }

  return details;
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

export async function listAssets(
  rootPath: string,
  siteConfigOrConfigs: SiteConfigLike | SiteConfigLike[],
  options: AssetListOptions = {}
): Promise<DiscoveryResult<AssetInfo>> {
  const infos = await Promise.all(normalizeSiteConfigs(siteConfigOrConfigs).map(async (siteConfig) => (
    readOriginInfo(rootPath, siteConfig)
  )));
  const rootFs = createFixtureRootFs(rootPath);
  const normalizedPathnameContains = options.pathnameContains?.toLowerCase();

  const filteredItems = infos
    .flatMap((info) => flattenStaticResourceManifest(info.manifest).map((entry) => ({
      ...entry,
      origin: info.origin,
      path: getFixtureDisplayPath(entry)
    })))
    .filter((entry) => {
    if (options.resourceTypes?.length && !options.resourceTypes.includes(entry.resourceType)) {
      return false;
    }
    if (options.mimeTypes?.length && !options.mimeTypes.includes(entry.mimeType)) {
      return false;
    }
    if (options.requestOrigin && entry.requestOrigin !== options.requestOrigin) {
      return false;
    }
    if (normalizedPathnameContains && !entry.pathname.toLowerCase().includes(normalizedPathnameContains)) {
      return false;
    }

    return true;
  });

  const items = await Promise.all(filteredItems.map(async (entry) => {
    const stat = await rootFs.stat(entry.bodyPath);
    const hasBody = Boolean(stat?.isFile());

    return {
      ...entry,
      hasBody,
      bodySize: hasBody ? stat!.size : null,
      editable: isEditableProjectionAsset(entry.projectionPath, entry),
      canonicalPath: entry.bodyPath
    };
  })).then((entries) => entries.sort(compareAssetInfos));

  return {
    ...paginateItems(items, normalizeLimit(options.limit, DEFAULT_ASSET_LIMIT, MAX_ASSET_LIMIT), options.cursor),
    matchedOrigins: uniqueOrigins(infos.map((info) => info.origin))
  };
}

export async function listApiEndpoints(
  rootPath: string,
  siteConfigOrConfigs: SiteConfigLike | SiteConfigLike[]
): Promise<EndpointListResult> {
  const infos = await Promise.all(normalizeSiteConfigs(siteConfigOrConfigs).map(async (siteConfig) => (
    readOriginInfo(rootPath, siteConfig)
  )));

  return {
    items: infos.flatMap((info) => info.apiEndpoints).sort(compareApiEndpoints),
    matchedOrigins: uniqueOrigins(infos.map((info) => info.origin))
  };
}

export function resolveFixturePath(rootPath: string, relativePath: string): string | null {
  return resolveWithinRoot(rootPath, relativePath);
}

export async function readFixtureBody(
  rootPath: string,
  relativePath: string,
  options: FixtureReadOptions = {}
): Promise<string | null> {
  const rootFs = createFixtureRootFs(rootPath);
  await assertWithinFullReadLimit(rootFs, relativePath, (byteLength, limit) => (
    new Error(
      `File is too large to read in full: ${relativePath} (${byteLength} bytes; limit ${limit} bytes). `
      + "Use read-file-snippet with this path and specify startLine and lineCount."
    )
  ));
  const text = await rootFs.readOptionalText(relativePath);
  if (text === null) {
    return null;
  }

  return maybePrettifyFixtureText(rootPath, relativePath, text, options);
}

export async function readFixtureSnippet(
  rootPath: string,
  relativePath: string,
  options: FixtureSnippetOptions = {}
): Promise<FixtureSnippet> {
  const startLine = Math.max(1, Math.trunc(options.startLine ?? 1));
  const lineCount = normalizeLimit(
    options.lineCount,
    DEFAULT_SNIPPET_LINE_COUNT,
    MAX_SNIPPET_LINE_COUNT
  );
  const maxBytes = normalizeLimit(
    options.maxBytes,
    DEFAULT_SNIPPET_MAX_BYTES,
    MAX_SNIPPET_MAX_BYTES
  );
  const textFixture = await readTextFixture(rootPath, relativePath);

  if ("reason" in textFixture) {
    switch (textFixture.reason) {
      case "invalid-path":
        throw new Error(`Invalid fixture path: ${relativePath}. Paths must stay within the fixture root.`);
      case "missing":
        throw new Error(`File not found: ${relativePath}`);
      case "binary":
        throw new Error(`Fixture is not a text file: ${relativePath}`);
    }
  }

  const renderedText = await maybePrettifyFixtureText(
    rootPath,
    relativePath,
    textFixture.text,
    options
  );
  const allLines = renderedText.split(/\r\n|\n|\r/);
  const snippetLines = allLines.slice(startLine - 1, startLine - 1 + lineCount);
  const rawSnippet = snippetLines.join("\n");
  const truncatedSnippet = truncateUtf8(rawSnippet, maxBytes);
  const renderedLineCount = truncatedSnippet.text === ""
    ? 0
    : truncatedSnippet.text.split(/\r\n|\n|\r/).length;

  return {
    path: relativePath,
    startLine,
    endLine: renderedLineCount > 0 ? startLine + renderedLineCount - 1 : startLine - 1,
    truncated: truncatedSnippet.truncated,
    text: truncatedSnippet.text
  };
}

export async function readApiFixture(
  rootPath: string,
  fixtureDir: string,
  options: FixtureReadOptions = {}
): Promise<ApiFixture | null> {
  const rootFs = createFixtureRootFs(rootPath);
  const metaPath = path.join(fixtureDir, "response.meta.json");
  const bodyPath = path.join(fixtureDir, "response.body");

  if (!rootFs.resolve(metaPath) || !rootFs.resolve(bodyPath)) {
    return null;
  }

  const meta = await rootFs.readOptionalJson<ResponseMeta>(metaPath);
  if (!meta) {
    return null;
  }

  return {
    fixtureDir,
    metaPath,
    bodyPath,
    meta,
    body: await (async () => {
      await assertWithinFullReadLimit(rootFs, bodyPath, (byteLength, limit) => (
        new Error(
          `Endpoint fixture body is too large to read in full: ${bodyPath} (${byteLength} bytes; limit ${limit} bytes). `
          + `Use read-file-snippet with path "${bodyPath}" and specify startLine and lineCount.`
        )
      ));
      const body = await rootFs.readOptionalText(bodyPath);
      if (body === null) {
        return null;
      }

      return maybePrettifyFixtureText(rootPath, bodyPath, body, options, {
        mimeType: meta.mimeType,
        resourceType: meta.resourceType
      });
    })()
  };
}

export async function searchFixtureContent(
  rootPath: string,
  options: SearchContentOptions
): Promise<DiscoveryResult<SearchContentMatch>> {
  const query = options.query.trim();
  if (!query) {
    return { items: [], nextCursor: null, totalMatched: 0, matchedOrigins: [] };
  }

  const configs = await readSiteConfigs(rootPath);
  const matchedConfigs = options.origin
    ? matchSiteConfigsByOrigin(configs, options.origin)
    : configs;
  const matchedOriginSet = new Set(matchedConfigs.map((config) => config.origin));
  const normalizedPathContains = options.pathContains?.toLowerCase();
  const searchableEntries = (await buildSearchableFixtureEntries(rootPath)).filter((entry) => {
    if (options.origin && (!entry.origin || !matchedOriginSet.has(entry.origin))) {
      return false;
    }
    if (normalizedPathContains && !entry.path.toLowerCase().includes(normalizedPathContains)) {
      return false;
    }
    if (options.mimeTypes?.length && (!entry.mimeType || !options.mimeTypes.includes(entry.mimeType))) {
      return false;
    }
    if (options.resourceTypes?.length && (!entry.resourceType || !options.resourceTypes.includes(entry.resourceType))) {
      return false;
    }

    return true;
  });

  const matches: SearchContentMatch[] = [];

  for (const entry of searchableEntries) {
    const result = await readTextFixture(rootPath, entry.path);
    if (result.ok) {
      const match = findSubstringMatch(result.text, query);
      if (match) {
        matches.push({
          path: entry.path,
          sourceKind: entry.sourceKind,
          matchKind: "body",
          matchCount: match.matchCount,
          origin: entry.origin,
          pathname: entry.pathname,
          mimeType: entry.mimeType,
          resourceType: entry.resourceType,
          excerpt: match.excerpt,
          matchLine: match.matchLine,
          matchColumn: match.matchColumn,
          editable: entry.editable,
          canonicalPath: entry.canonicalPath
        });
        continue;
      }
    }

    const pathMatch = findPathMatch(entry, query);
    if (!pathMatch) {
      continue;
    }

    matches.push({
      path: entry.path,
      sourceKind: entry.sourceKind,
      matchKind: "path",
      matchCount: pathMatch.matchCount,
      origin: entry.origin,
      pathname: entry.pathname,
      mimeType: entry.mimeType,
      resourceType: entry.resourceType,
      excerpt: pathMatch.excerpt,
      matchLine: pathMatch.matchLine,
      matchColumn: pathMatch.matchColumn,
      editable: entry.editable,
      canonicalPath: entry.canonicalPath
    });
  }

  return {
    ...paginateItems(matches, normalizeLimit(options.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT), options.cursor),
    matchedOrigins: options.origin
      ? uniqueOrigins(matchedConfigs.map((config) => config.origin))
      : uniqueOrigins(matches.map((match) => match.origin))
  };
}

export async function readSiteConfigs(rootPath: string): Promise<SiteConfig[]> {
  return readEffectiveSiteConfigs(rootPath);
}

export async function resolveProjectionFile(
  rootPath: string,
  relativePath: string
): Promise<ProjectionFileInfo | null> {
  const details = await resolveProjectionFileDetails(rootPath, relativePath);
  if (!details) {
    return null;
  }

  return {
    path: details.path,
    canonicalPath: details.canonicalPath,
    metaPath: details.metaPath,
    currentText: details.currentText,
    editable: details.editable
  };
}

export async function writeProjectionFile(
  rootPath: string,
  relativePath: string,
  content: string
): Promise<ProjectionFileInfo> {
  const details = await requireProjectionFile(rootPath, relativePath);
  if (!details.editable) {
    throw new Error(`Projection file is not text-editable: ${relativePath}`);
  }

  await createFixtureRootFs(rootPath).writeText(details.path, content);
  return {
    path: details.path,
    canonicalPath: details.canonicalPath,
    metaPath: details.metaPath,
    currentText: content,
    editable: true
  };
}

export async function patchProjectionFile(
  rootPath: string,
  options: PatchProjectionFileOptions
): Promise<ProjectionFileInfo> {
  const details = await requireProjectionFile(rootPath, options.path);
  if (!details.editable) {
    throw new Error(`Projection file is not text-editable: ${options.path}`);
  }
  if (details.currentText === null) {
    throw new Error(`Projection file is missing or not currently readable as UTF-8 text: ${options.path}`);
  }

  const nextText = applyLinePatch(details.currentText, options);
  await createFixtureRootFs(rootPath).writeText(details.path, nextText);
  return {
    path: details.path,
    canonicalPath: details.canonicalPath,
    metaPath: details.metaPath,
    currentText: nextText,
    editable: true
  };
}

export async function restoreProjectionFile(
  rootPath: string,
  relativePath: string
): Promise<ProjectionFileInfo> {
  const details = await requireProjectionFile(rootPath, relativePath);
  await createFixtureRootFs(rootPath).writeBody(details.path, details.projectionPayload);

  return {
    path: details.path,
    canonicalPath: details.canonicalPath,
    metaPath: details.metaPath,
    currentText: details.projectionPayload.bodyEncoding === "utf8"
      ? details.projectionPayload.body
      : null,
    editable: details.projectionPayload.bodyEncoding === "utf8"
  };
}
