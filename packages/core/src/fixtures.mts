import { promises as fs } from "node:fs";
import path from "node:path";

import {
  ROOT_SENTINEL_RELATIVE_PATH,
  SCENARIOS_DIR,
  SIMPLE_METADATA_DIR,
  SIMPLE_METADATA_TREE,
  STATIC_RESOURCE_MANIFEST_FILE
} from "./constants.mjs";
import {
  originToKey,
  type ResponseMeta,
  type StaticResourceManifest,
  type StaticResourceManifestEntry
} from "./fixture-layout.mjs";
import { prettifyFixtureText } from "./fixture-presentation.mjs";
import { createFixtureRootFs, resolveWithinRoot } from "./root-fs.mjs";

export type { ResponseMeta, StaticResourceManifest, StaticResourceManifestEntry } from "./fixture-layout.mjs";

export interface ApiEndpoint {
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
  mode: "simple" | "advanced";
}

export interface OriginInfo {
  origin: string;
  originKey: string;
  mode: "simple" | "advanced";
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
  origin: string | null;
  pathname: string | null;
  mimeType: string | null;
  resourceType: string | null;
  excerpt: string;
  matchLine: number;
  matchColumn: number;
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

interface SearchableFixtureEntry {
  path: string;
  sourceKind: "asset" | "endpoint" | "file";
  origin: string | null;
  pathname: string | null;
  mimeType: string | null;
  resourceType: string | null;
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
const SEARCH_EXACT_EXCLUDE = new Set([
  ROOT_SENTINEL_RELATIVE_PATH,
  path.join(SIMPLE_METADATA_DIR, "cli.json")
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

function isExcludedSearchPath(relativePath: string): boolean {
  const normalized = normalizeSearchPath(relativePath);
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
): Omit<SearchContentMatch, "path" | "sourceKind" | "origin" | "pathname" | "mimeType" | "resourceType"> | null {
  const matchIndex = text.toLowerCase().indexOf(query.toLowerCase());
  if (matchIndex === -1) {
    return null;
  }

  const leadingText = text.slice(0, matchIndex);
  const lines = leadingText.split(/\r\n|\n|\r/);
  const line = lines.length;
  const column = (lines.at(-1) ?? "").length + 1;

  return {
    excerpt: createExcerpt(text, matchIndex, query.length),
    matchLine: line,
    matchColumn: column
  };
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
        continue;
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
      if (!entries.has(asset.bodyPath)) {
        entries.set(asset.bodyPath, {
          path: asset.bodyPath,
          sourceKind: "asset",
          origin: info.origin,
          pathname: asset.pathname,
          mimeType: asset.mimeType || null,
          resourceType: asset.resourceType || null
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
          resourceType: endpoint.resourceType || null
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
      resourceType: null
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
  const isSimple = siteConfig.mode === "simple";

  const manifestRelative = isSimple
    ? path.join(SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE, originKey, STATIC_RESOURCE_MANIFEST_FILE)
    : path.join(originKey, STATIC_RESOURCE_MANIFEST_FILE);
  const manifest = await rootFs.readOptionalJson<StaticResourceManifest>(manifestRelative);

  const originsBaseRelative = isSimple
    ? path.join(SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE, originKey, "origins")
    : path.join(originKey, "origins");

  const apiEndpoints: ApiEndpoint[] = [];
  const originDirs = await rootFs.listOptionalDirectories(originsBaseRelative);
  for (const dir of originDirs) {
    const relativeBasePath = isSimple
      ? path.join(SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE, originKey, "origins", dir)
      : path.join(originKey, "origins", dir);
    const endpoints = await collectApiEndpoints(rootPath, relativeBasePath);
    apiEndpoints.push(...endpoints);
  }

  return {
    origin: siteConfig.origin,
    originKey,
    mode: siteConfig.mode,
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
  siteConfig: SiteConfigLike,
  options: AssetListOptions = {}
): Promise<PaginatedResult<StaticResourceManifestEntry>> {
  const info = await readOriginInfo(rootPath, siteConfig);
  const normalizedPathnameContains = options.pathnameContains?.toLowerCase();

  const items = flattenStaticResourceManifest(info.manifest).filter((entry) => {
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

  return paginateItems(items, normalizeLimit(options.limit, DEFAULT_ASSET_LIMIT, MAX_ASSET_LIMIT), options.cursor);
}

export function resolveFixturePath(rootPath: string, relativePath: string): string | null {
  return resolveWithinRoot(rootPath, relativePath);
}

export async function readFixtureBody(
  rootPath: string,
  relativePath: string,
  options: FixtureReadOptions = {}
): Promise<string | null> {
  const text = await createFixtureRootFs(rootPath).readOptionalText(relativePath);
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
): Promise<PaginatedResult<SearchContentMatch>> {
  const query = options.query.trim();
  if (!query) {
    return { items: [], nextCursor: null, totalMatched: 0 };
  }

  const normalizedPathContains = options.pathContains?.toLowerCase();
  const searchableEntries = (await buildSearchableFixtureEntries(rootPath)).filter((entry) => {
    if (options.origin && entry.origin !== options.origin) {
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
    if (!result.ok) {
      continue;
    }

    const match = findSubstringMatch(result.text, query);
    if (!match) {
      continue;
    }

    matches.push({
      path: entry.path,
      sourceKind: entry.sourceKind,
      origin: entry.origin,
      pathname: entry.pathname,
      mimeType: entry.mimeType,
      resourceType: entry.resourceType,
      excerpt: match.excerpt,
      matchLine: match.matchLine,
      matchColumn: match.matchColumn
    });
  }

  return paginateItems(matches, normalizeLimit(options.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT), options.cursor);
}

export async function readSiteConfigs(rootPath: string): Promise<SiteConfigLike[]> {
  const rootFs = createFixtureRootFs(rootPath);
  const simpleOrigins = await rootFs.listOptionalDirectories(path.join(SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE));

  const configs: SiteConfigLike[] = [];
  for (const originKey of simpleOrigins) {
    configs.push({ origin: keyToOrigin(originKey), mode: "simple" });
  }

  const topEntries = await rootFs.listOptionalDirectory("");
  for (const entry of topEntries) {
    if (entry.kind !== "directory") continue;
    if (entry.name === path.dirname(SCENARIOS_DIR)) continue;
    if (!entry.name.startsWith("http")) continue;
    const origin = keyToOrigin(entry.name);
    if (!configs.some((config) => config.origin === origin)) {
      configs.push({ origin, mode: "advanced" });
    }
  }

  return configs;
}
