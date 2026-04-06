import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import ignore from "ignore";

import {
  SIMPLE_MODE_METADATA_DIR,
  SIMPLE_MODE_METADATA_TREE,
  STATIC_RESOURCE_MANIFEST_FILE,
  STATIC_RESOURCE_MANIFEST_SCHEMA_VERSION,
  buildRequestPayload,
  buildResponseMeta,
  deriveMimeTypeFromPathname,
  originToKey,
  shortHash,
  upsertStaticResourceManifest,
  type HeaderEntry,
  type StaticResourceManifest
} from "./fixture-layout.mjs";
import type {
  HarImportEvent,
  HarImportedEntry,
  HarSkippedEntry
} from "./har-import.mjs";
import { createRoot, type RootSentinel } from "./root.mjs";
import { createFixtureRootFs } from "./root-fs.mjs";

export interface SyncOverridesDirectoryOptions {
  dir: string;
  onEvent?: (event: HarImportEvent) => void | Promise<void>;
}

export interface SyncOverridesDirectoryResult {
  dir: string;
  sentinel: RootSentinel;
  topOrigin: string;
  topOrigins: string[];
  imported: HarImportedEntry[];
  skipped: HarSkippedEntry[];
}

interface HeaderOverrideRule {
  sourcePath: string;
  basePath: string;
  applyTo: string;
  headers: HeaderEntry[];
  order: number;
}

interface OverrideAssetCandidate {
  relativePath: string;
  requestPath: string;
  topOrigin: string;
  requestUrl: string;
  capturedAt: string;
  bodyEncoding: "utf8" | "base64";
  bodySize: number;
}

interface IgnoreContext {
  baseDir: string;
  matcher: ReturnType<typeof ignore>;
}

function joinRelativePath(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

function decodeOverrideSegment(segment: string): string {
  return decodeURIComponent(segment);
}

function parseOverrideHost(segment: string): string | null {
  const candidateUrl = `https://${segment}`;
  if (!URL.canParse(candidateUrl)) {
    return null;
  }

  const candidate = new URL(candidateUrl);
  if (
    candidate.hostname !== "localhost"
    && !candidate.hostname.includes(".")
    && !candidate.hostname.includes(":")
  ) {
    return null;
  }
  return candidate.host;
}

function escapeRegex(pattern: string): string {
  return pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*");
}

function detectBodyEncoding(buffer: Buffer): "utf8" | "base64" {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return Buffer.from(decoded, "utf8").equals(buffer)
      ? "utf8"
      : "base64";
  } catch {
    return "base64";
  }
}

function inferResourceTypeFromMime(mimeType: string): string {
  const lowerMimeType = mimeType.toLowerCase();
  if (["text/html", "application/xhtml+xml"].includes(lowerMimeType)) {
    return "Document";
  }
  if (lowerMimeType === "text/css") {
    return "Stylesheet";
  }
  if (["application/javascript", "text/javascript"].includes(lowerMimeType)) {
    return "Script";
  }
  if (lowerMimeType.startsWith("image/")) {
    return "Image";
  }
  if (lowerMimeType.startsWith("font/")) {
    return "Font";
  }
  if (lowerMimeType.startsWith("audio/") || lowerMimeType.startsWith("video/")) {
    return "Media";
  }
  return "Other";
}

function createManifest(topOrigin: string): StaticResourceManifest {
  return {
    schemaVersion: STATIC_RESOURCE_MANIFEST_SCHEMA_VERSION,
    topOrigin,
    topOriginKey: originToKey(topOrigin),
    generatedAt: new Date().toISOString(),
    resourcesByPathname: {}
  };
}

function getMetadataPaths(topOrigin: string, visiblePath: string) {
  const topOriginKey = originToKey(topOrigin);
  const hiddenRoot = joinRelativePath(
    SIMPLE_MODE_METADATA_DIR,
    SIMPLE_MODE_METADATA_TREE,
    topOriginKey,
    visiblePath
  );

  return {
    manifestPath: joinRelativePath(
      SIMPLE_MODE_METADATA_DIR,
      SIMPLE_MODE_METADATA_TREE,
      topOriginKey,
      STATIC_RESOURCE_MANIFEST_FILE
    ),
    requestPath: `${hiddenRoot}.__request.json`,
    metaPath: `${hiddenRoot}.__response.json`
  };
}

function buildRequestPathFromOverridePath(decodedParts: string[]): string {
  return decodedParts.join("/");
}

function buildRequestUrl(host: string, requestPath: string, scheme: "http" | "https"): URL {
  const relative = requestPath.slice(host.length);
  const pathWithLeadingSlash = `/${relative.replace(/^\/+/, "")}`;

  const queryIndex = pathWithLeadingSlash.indexOf("?");
  const pathname = queryIndex >= 0 ? pathWithLeadingSlash.slice(0, queryIndex) : pathWithLeadingSlash;
  const search = queryIndex >= 0 ? pathWithLeadingSlash.slice(queryIndex) : "";

  return new URL(`${scheme}://${host}${pathname}${search}`);
}

function isHeaderOverrideRecord(value: unknown): value is { applyTo: string; headers: HeaderEntry[] } {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { applyTo?: unknown }).applyTo === "string"
    && Array.isArray((value as { headers?: unknown }).headers)
    && (value as { headers: unknown[] }).headers.length > 0
    && (value as { headers: unknown[] }).headers.every((header) => (
      header
      && typeof header === "object"
      && typeof (header as { name?: unknown }).name === "string"
      && typeof (header as { value?: unknown }).value === "string"
    ))
  );
}

function createHeaderMatcher(rule: HeaderOverrideRule): RegExp {
  return new RegExp(`^${escapeRegex(`${rule.basePath}${rule.applyTo}`)}$`);
}

function mergeHeaders(baseHeaders: HeaderEntry[], overrideHeaders: HeaderEntry[]): HeaderEntry[] {
  const replacementHeaders = new Map<string, HeaderEntry>();
  const appendedSetCookies = overrideHeaders.filter((header) => header.name.toLowerCase() === "set-cookie");

  for (const header of overrideHeaders) {
    const name = header.name.toLowerCase();
    if (name === "set-cookie") {
      continue;
    }
    replacementHeaders.set(name, header);
  }

  const merged = baseHeaders.filter((header) => {
    const name = header.name.toLowerCase();
    return name === "set-cookie" || !replacementHeaders.has(name);
  });

  merged.push(...replacementHeaders.values());
  merged.push(...appendedSetCookies);

  return merged;
}

function applyHeaderOverrides(
  requestPath: string,
  mimeType: string,
  rules: HeaderOverrideRule[]
): HeaderEntry[] {
  let headers: HeaderEntry[] = [{ name: "Content-Type", value: mimeType }];

  for (const rule of rules) {
    if (!createHeaderMatcher(rule).test(requestPath)) {
      continue;
    }
    headers = mergeHeaders(headers, rule.headers);
  }

  return headers;
}

function normalizeIgnorePath(relativePath: string, isDirectory = false): string {
  const normalized = relativePath
    .split(path.sep)
    .join("/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  if (!normalized) {
    return "";
  }

  return isDirectory
    ? `${normalized}/`
    : normalized;
}

function relativeIgnorePath(baseDir: string, relativePath: string, isDirectory: boolean): string {
  const normalizedBaseDir = normalizeIgnorePath(baseDir);
  const normalizedRelativePath = normalizeIgnorePath(relativePath);
  const candidate = normalizedBaseDir
    ? path.posix.relative(normalizedBaseDir, normalizedRelativePath)
    : normalizedRelativePath;

  return isDirectory
    ? normalizeIgnorePath(candidate, true)
    : normalizeIgnorePath(candidate);
}

function isIgnoredByContexts(
  relativePath: string,
  isDirectory: boolean,
  contexts: IgnoreContext[]
): boolean {
  let ignored = false;

  for (const context of contexts) {
    const candidate = relativeIgnorePath(context.baseDir, relativePath, isDirectory);
    const result = context.matcher.test(candidate);
    if (result.ignored) {
      ignored = true;
      continue;
    }

    if (result.unignored) {
      ignored = false;
    }
  }

  return ignored;
}

async function ensureExistingOverrideDirectory(dir: string): Promise<void> {
  let directoryStat;
  try {
    directoryStat = await fs.stat(dir);
  } catch {
    throw new Error(`Overrides directory not found: ${dir}`);
  }

  if (!directoryStat.isDirectory()) {
    throw new Error(`Overrides path is not a directory: ${dir}`);
  }
}

async function walkOverrideDirectory(
  dir: string
): Promise<{ visibleFiles: string[]; rules: HeaderOverrideRule[]; skipped: HarSkippedEntry[] }> {
  const visibleFiles: string[] = [];
  const rules: HeaderOverrideRule[] = [];
  const skipped: HarSkippedEntry[] = [];
  let nextRuleOrder = 0;

  async function visit(relativeDir = "", inheritedContexts: IgnoreContext[] = []): Promise<void> {
    const absoluteDir = path.resolve(dir, relativeDir);
    const entries: Dirent[] = await fs.readdir(absoluteDir, { withFileTypes: true });
    const contexts = [...inheritedContexts];
    const gitignoreEntry = entries.find((entry) => entry.isFile() && entry.name === ".gitignore");

    if (gitignoreEntry) {
      const gitignoreContent = await fs.readFile(path.resolve(absoluteDir, gitignoreEntry.name), "utf8");
      contexts.push({
        baseDir: relativeDir,
        matcher: ignore().add(gitignoreContent)
      });
    }

    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = relativeDir
        ? joinRelativePath(relativeDir, entry.name)
        : entry.name;

      if (entry.name === ".gitignore") {
        continue;
      }

      if (isIgnoredByContexts(relativePath, entry.isDirectory(), contexts)) {
        continue;
      }

      if (entry.isDirectory()) {
        if (entry.name === SIMPLE_MODE_METADATA_DIR) {
          continue;
        }
        await visit(relativePath, contexts);
        continue;
      }

      if (entry.name === ".headers") {
        try {
          const content = await fs.readFile(path.resolve(dir, relativePath), "utf8");
          const parsed = JSON.parse(content) as unknown;
          if (!Array.isArray(parsed) || !parsed.every(isHeaderOverrideRecord)) {
            throw new Error("Invalid .headers JSON payload");
          }

          const parentRelative = relativePath.includes("/")
            ? relativePath.slice(0, relativePath.lastIndexOf("/"))
            : "";
          const baseParts = parentRelative
            ? parentRelative.split("/").map(decodeOverrideSegment)
            : [];
          const basePath = baseParts.length > 0
            ? `${baseParts.join("/")}/`
            : "";

          for (const rule of parsed) {
            rules.push({
              sourcePath: relativePath,
              basePath,
              applyTo: rule.applyTo,
              headers: rule.headers,
              order: nextRuleOrder++
            });
          }
        } catch (error) {
          skipped.push({
            requestUrl: relativePath,
            method: "GET",
            reason: `Failed to parse ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
          });
        }
        continue;
      }

      visibleFiles.push(relativePath);
    }
  }

  await visit();
  rules.sort((left, right) => (
    left.basePath.length - right.basePath.length
    || left.order - right.order
  ));

  return { visibleFiles, rules, skipped };
}

async function buildOverrideCandidates(
  dir: string,
  visibleFiles: string[]
): Promise<{ prepared: OverrideAssetCandidate[]; skipped: HarSkippedEntry[] }> {
  const prepared: OverrideAssetCandidate[] = [];
  const skipped: HarSkippedEntry[] = [];

  for (const relativePath of visibleFiles) {
    let decodedParts: string[];
    try {
      decodedParts = relativePath.split("/").map(decodeOverrideSegment);
    } catch {
      skipped.push({
        requestUrl: relativePath,
        method: "GET",
        reason: "Override path contains invalid percent-encoding"
      });
      continue;
    }

    if (decodedParts[0]?.startsWith("file:")) {
      skipped.push({
        requestUrl: relativePath,
        method: "GET",
        reason: "Only http and https override paths are supported"
      });
      continue;
    }

    const host = parseOverrideHost(decodedParts[0]);
    if (!host) {
      skipped.push({
        requestUrl: relativePath,
        method: "GET",
        reason: "Override path does not start with a valid host segment"
      });
      continue;
    }

    if (decodedParts[1] === "longurls") {
      skipped.push({
        requestUrl: relativePath,
        method: "GET",
        reason: "Cannot reconstruct original URLs from DevTools longurls overrides"
      });
      continue;
    }

    if (decodedParts.length < 2) {
      skipped.push({
        requestUrl: relativePath,
        method: "GET",
        reason: "Override file does not map to a request path"
      });
      continue;
    }

    const absolutePath = path.resolve(dir, relativePath);
    const fileStat = await fs.stat(absolutePath);
    const requestPath = buildRequestPathFromOverridePath(decodedParts);
    const buffer = await fs.readFile(absolutePath);
    const bodyEncoding = detectBodyEncoding(buffer);
    const capturedAt = fileStat.mtime.toISOString();

    for (const scheme of ["http", "https"] as const) {
      const requestUrl = buildRequestUrl(host, requestPath, scheme);
      prepared.push({
        relativePath,
        requestPath,
        topOrigin: requestUrl.origin,
        requestUrl: requestUrl.toString(),
        capturedAt,
        bodyEncoding,
        bodySize: buffer.byteLength
      });
    }
  }

  return { prepared, skipped };
}

export async function syncOverridesDirectory(
  options: SyncOverridesDirectoryOptions
): Promise<SyncOverridesDirectoryResult> {
  const dir = path.resolve(options.dir);
  await ensureExistingOverrideDirectory(dir);
  const sentinel = await createRoot(dir);
  const rootFs = createFixtureRootFs(dir);
  const { visibleFiles, rules, skipped: scanSkipped } = await walkOverrideDirectory(dir);
  const { prepared, skipped: candidateSkipped } = await buildOverrideCandidates(dir, visibleFiles);
  const skipped = [...scanSkipped, ...candidateSkipped];
  const imported: HarImportedEntry[] = [];
  const manifests = new Map<string, StaticResourceManifest>();
  const topOrigins = [...new Set(prepared.map((candidate) => candidate.topOrigin))].sort();
  const topOrigin = topOrigins[0] || "";

  if (options.onEvent) {
    await options.onEvent({
      type: "scan-complete",
      totalEntries: visibleFiles.length,
      totalCandidates: prepared.length,
      topOrigin,
      topOrigins
    });

    let skippedEntries = 0;
    for (const skippedEntry of skipped) {
      skippedEntries += 1;
      await options.onEvent({
        type: "entry-skipped",
        topOrigin: skippedEntry.topOrigin,
        requestUrl: skippedEntry.requestUrl,
        method: skippedEntry.method,
        reason: skippedEntry.reason,
        skippedEntries,
        totalCandidates: visibleFiles.length
      });
    }
  }

  for (const [index, candidate] of prepared.entries()) {
    const requestUrl = new URL(candidate.requestUrl);
    const mimeType = deriveMimeTypeFromPathname(requestUrl.pathname);
    const resourceType = inferResourceTypeFromMime(mimeType);
    const headers = applyHeaderOverrides(candidate.requestPath, mimeType, rules);
    const metadataPaths = getMetadataPaths(candidate.topOrigin, candidate.relativePath);
    const queryHash = await shortHash(requestUrl.search || "");
    const bodyHash = await shortHash("");
    const completedEntries = index;
    const totalEntries = prepared.length;

    if (options.onEvent) {
      await options.onEvent({
        type: "entry-start",
        topOrigin: candidate.topOrigin,
        requestUrl: candidate.requestUrl,
        bodyPath: candidate.relativePath,
        completedEntries,
        totalEntries,
        writtenBytes: 0,
        totalBytes: candidate.bodySize
      });
    }

    await rootFs.writeJson(metadataPaths.requestPath, buildRequestPayload({
      topOrigin: candidate.topOrigin,
      url: candidate.requestUrl,
      method: "GET",
      requestHeaders: [],
      requestBody: "",
      requestBodyEncoding: "utf8",
      descriptor: {
        bodyHash,
        queryHash
      }
    }, candidate.capturedAt));

    await rootFs.writeJson(metadataPaths.metaPath, buildResponseMeta({
      responseStatus: 200,
      responseStatusText: "OK",
      responseHeaders: headers,
      mimeType,
      resourceType,
      url: candidate.requestUrl,
      method: "GET"
    }, candidate.bodyEncoding, candidate.capturedAt));

    const manifest = manifests.get(metadataPaths.manifestPath)
      || createManifest(candidate.topOrigin);
    manifests.set(metadataPaths.manifestPath, upsertStaticResourceManifest(manifest, {
      requestUrl: candidate.requestUrl,
      requestOrigin: candidate.topOrigin,
      pathname: requestUrl.pathname,
      search: requestUrl.search,
      bodyPath: candidate.relativePath,
      requestPath: metadataPaths.requestPath,
      metaPath: metadataPaths.metaPath,
      mimeType,
      resourceType,
      capturedAt: candidate.capturedAt
    }));

    imported.push({
      requestUrl: candidate.requestUrl,
      bodyPath: candidate.relativePath,
      method: "GET",
      topOrigin: candidate.topOrigin
    });

    if (options.onEvent) {
      await options.onEvent({
        type: "entry-progress",
        topOrigin: candidate.topOrigin,
        requestUrl: candidate.requestUrl,
        bodyPath: candidate.relativePath,
        completedEntries,
        totalEntries,
        writtenBytes: candidate.bodySize,
        totalBytes: candidate.bodySize
      });
      await options.onEvent({
        type: "entry-complete",
        topOrigin: candidate.topOrigin,
        requestUrl: candidate.requestUrl,
        bodyPath: candidate.relativePath,
        completedEntries: index + 1,
        totalEntries
      });
    }
  }

  for (const [manifestPath, manifest] of manifests) {
    await rootFs.writeJson(manifestPath, manifest);
  }

  return {
    dir,
    sentinel,
    topOrigin,
    topOrigins,
    imported,
    skipped
  };
}
