import { promises as fs } from "node:fs";
import path from "node:path";

import {
  buildRequestPayload,
  buildResponseMeta,
  createFixtureDescriptor,
  createStaticResourceManifest,
  createStaticResourceManifestEntry,
  getStaticResourceManifestPath,
  normalizeSiteInput,
  sanitizeResponseHeaders,
  upsertStaticResourceManifest,
  type AssetFixtureDescriptor,
  type FixtureDescriptor,
  type HeaderEntry,
  type RequestPayload,
  type ResponseMeta,
  type StaticResourceManifest
} from "./fixture-layout.mjs";
import { createProjectedFixturePayload } from "./fixture-presentation.mjs";
import { createRoot, type RootSentinel } from "./root.mjs";
import { createFixtureRootFs } from "./root-fs.mjs";

type HarValueRecord = { name: string; value: string };

interface HarPostDataParam {
  name: string;
  value?: string;
}

interface HarPostData {
  mimeType?: string;
  text?: string;
  params?: HarPostDataParam[];
}

interface HarContent {
  mimeType?: string;
  text?: string;
  encoding?: string;
}

interface HarRequest {
  method: string;
  url: string;
  headers?: HarValueRecord[];
  postData?: HarPostData;
}

interface HarResponse {
  status: number;
  statusText: string;
  headers?: HarValueRecord[];
  content?: HarContent;
}

interface HarTimings {
  blocked?: number | string | null;
  connect?: number | string | null;
  dns?: number | string | null;
  receive?: number | string | null;
  send?: number | string | null;
  wait?: number | string | null;
  ssl?: number | string | null;
}

interface HarPage {
  id?: string;
  startedDateTime?: string;
  title?: string;
}

interface HarEntry {
  startedDateTime: string;
  time?: number | string;
  request: HarRequest;
  response: HarResponse;
  timings?: HarTimings;
  pageref?: string;
}

interface HarArchive {
  log: {
    version?: string;
    entries: HarEntry[];
    pages?: HarPage[];
  };
}

export interface HarImportedEntry {
  requestUrl: string;
  bodyPath: string;
  method: string;
  topOrigin: string;
}

export interface HarSkippedEntry {
  requestUrl: string;
  method: string;
  reason: string;
  topOrigin?: string;
}

export type HarImportEvent =
  | {
      type: "scan-complete";
      totalEntries: number;
      totalCandidates: number;
      topOrigin: string;
      topOrigins: string[];
    }
  | {
      type: "entry-start";
      topOrigin: string;
      requestUrl: string;
      bodyPath: string;
      completedEntries: number;
      totalEntries: number;
      writtenBytes: number;
      totalBytes: number;
    }
  | {
      type: "entry-progress";
      topOrigin: string;
      requestUrl: string;
      bodyPath: string;
      completedEntries: number;
      totalEntries: number;
      writtenBytes: number;
      totalBytes: number;
    }
  | {
      type: "entry-complete";
      topOrigin: string;
      requestUrl: string;
      bodyPath: string;
      completedEntries: number;
      totalEntries: number;
    }
  | {
      type: "entry-skipped";
      topOrigin?: string;
      requestUrl: string;
      method: string;
      reason: string;
      skippedEntries: number;
      totalCandidates: number;
    };

export interface ImportHarFileOptions {
  harPath: string;
  dir: string;
  topOrigin?: string;
  onEvent?: (event: HarImportEvent) => void | Promise<void>;
}

export interface ImportHarFileResult {
  dir: string;
  sentinel: RootSentinel;
  topOrigin: string;
  topOrigins: string[];
  imported: HarImportedEntry[];
  skipped: HarSkippedEntry[];
}

interface ResolvedHarEntry {
  entry: HarEntry;
  topOrigin: string;
}

interface PreparedHarEntry {
  entry: HarEntry;
  topOrigin: string;
  descriptor: FixtureDescriptor;
  request: RequestPayload;
  response: {
    body: string;
    bodyEncoding: "utf8" | "base64";
    meta: ResponseMeta;
  };
}

const DOCUMENT_MIME_TYPES = new Set([
  "text/html",
  "application/xhtml+xml"
]);

const TIMING_FIELDS = [
  "blocked",
  "connect",
  "dns",
  "receive",
  "send",
  "wait",
  "ssl"
] as const;

function isRecordArray(value: unknown): value is HarValueRecord[] {
  return Array.isArray(value) && value.every((item) => (
    item !== null &&
    typeof item === "object" &&
    typeof item.name === "string" &&
    typeof item.value === "string"
  ));
}

function asHeaders(headers: unknown): HeaderEntry[] {
  return isRecordArray(headers)
    ? headers.map((header) => ({ name: header.name, value: header.value }))
    : [];
}

function getMimeTypeFromHeaders(headers: HeaderEntry[]): string {
  const contentType = headers.find((header) => header.name.toLowerCase() === "content-type");
  return contentType?.value.split(";")[0]?.trim() || "";
}

function getNormalizedMimeType(entry: HarEntry): string {
  return entry.response.content?.mimeType?.split(";")[0]?.trim()
    || getMimeTypeFromHeaders(asHeaders(entry.response.headers));
}

function inferResourceType(entry: HarEntry, mimeType: string): string {
  const lowerMimeType = mimeType.toLowerCase();
  if (DOCUMENT_MIME_TYPES.has(lowerMimeType)) {
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
  if (entry.request.method.toUpperCase() !== "GET") {
    return "Fetch";
  }
  return "Other";
}

function validateTimingValue(value: unknown, label: string, url: string): void {
  if (value === undefined || value === null) {
    return;
  }

  const numericValue = typeof value === "string" && value.trim()
    ? Number(value)
    : value;

  if (typeof numericValue !== "number" || !Number.isFinite(numericValue) || numericValue < -1) {
    throw new Error(`Invalid HAR timing "${label}" for ${url}. Timings must be numbers >= -1.`);
  }
}

function validateHarEntry(entry: unknown, index: number): asserts entry is HarEntry {
  if (!entry || typeof entry !== "object") {
    throw new Error(`HAR entry ${index} must be an object.`);
  }

  const candidate = entry as {
    startedDateTime?: unknown;
    time?: unknown;
    request?: { method?: unknown; url?: unknown };
    response?: { status?: unknown; statusText?: unknown };
    timings?: Record<string, unknown>;
  };

  if (typeof candidate.startedDateTime !== "string" || Number.isNaN(Date.parse(candidate.startedDateTime))) {
    throw new Error(`HAR entry ${index} is missing a valid startedDateTime.`);
  }

  const totalTime = typeof candidate.time === "string" && candidate.time.trim()
    ? Number(candidate.time)
    : candidate.time;

  if (totalTime !== undefined && (typeof totalTime !== "number" || !Number.isFinite(totalTime) || totalTime < 0)) {
    throw new Error(`HAR entry ${index} has an invalid time value.`);
  }

  if (!candidate.request || typeof candidate.request !== "object") {
    throw new Error(`HAR entry ${index} is missing a request object.`);
  }
  if (typeof candidate.request.method !== "string" || typeof candidate.request.url !== "string") {
    throw new Error(`HAR entry ${index} request must include method and url strings.`);
  }

  if (!candidate.response || typeof candidate.response !== "object") {
    throw new Error(`HAR entry ${index} is missing a response object.`);
  }
  if (typeof candidate.response.status !== "number" || typeof candidate.response.statusText !== "string") {
    throw new Error(`HAR entry ${index} response must include status and statusText.`);
  }

  const url = candidate.request.url;
  if (candidate.timings && typeof candidate.timings === "object") {
    for (const field of TIMING_FIELDS) {
      validateTimingValue(candidate.timings[field], field, url);
    }
  }
}

export function parseHarArchive(content: string): HarArchive {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Failed to parse HAR JSON.");
  }

  if (!parsed || typeof parsed !== "object" || !("log" in parsed) || !parsed.log || typeof parsed.log !== "object") {
    throw new Error("HAR file must contain a top-level log object.");
  }

  const archive = parsed as { log: { entries?: unknown } };

  if (!Array.isArray(archive.log.entries)) {
    throw new Error("HAR file must contain log.entries.");
  }

  archive.log.entries.forEach((entry, index) => validateHarEntry(entry, index));

  return parsed as HarArchive;
}

function sortEntriesByStartedDateTime(entries: HarEntry[]): HarEntry[] {
  return [...entries].sort((left, right) => (
    Date.parse(left.startedDateTime) - Date.parse(right.startedDateTime)
  ));
}

function getHttpOrigin(candidate: unknown): string | null {
  if (typeof candidate !== "string" || !candidate.trim()) {
    return null;
  }

  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

function resolveSingleTopOrigin(entries: HarEntry[]): string {
  const documentOrigins = new Set<string>();
  for (const entry of entries) {
    if (entry.request.method.toUpperCase() !== "GET") {
      continue;
    }

    const mimeType = getNormalizedMimeType(entry).toLowerCase();
    if (!DOCUMENT_MIME_TYPES.has(mimeType)) {
      continue;
    }

    const requestUrl = new URL(entry.request.url);
    if (["http:", "https:"].includes(requestUrl.protocol)) {
      documentOrigins.add(requestUrl.origin);
    }
  }

  if (documentOrigins.size === 1) {
    return [...documentOrigins][0];
  }

  const requestOrigins = new Set<string>();
  for (const entry of entries) {
    const requestUrl = new URL(entry.request.url);
    if (!["http:", "https:"].includes(requestUrl.protocol)) {
      continue;
    }
    requestOrigins.add(requestUrl.origin);
  }

  if (requestOrigins.size === 1) {
    return [...requestOrigins][0];
  }

  throw new Error(
    `Unable to infer a single top origin from the HAR. Use --top-origin with one of: ${[...requestOrigins].sort().join(", ")}`
  );
}

function resolveUngroupedEntriesTopOrigin(
  entries: HarEntry[],
  resolvedPageOrigins: Set<string>
): string {
  if (resolvedPageOrigins.size === 1) {
    return [...resolvedPageOrigins][0];
  }

  return resolveSingleTopOrigin(entries);
}

function resolveEntryTopOrigins(entries: HarEntry[], pages?: HarPage[], explicitTopOrigin?: string): ResolvedHarEntry[] {
  if (!entries.length) {
    throw new Error("Unable to infer a top origin from an empty HAR entry set.");
  }

  if (explicitTopOrigin) {
    const topOrigin = normalizeSiteInput(explicitTopOrigin);
    return entries.map((entry) => ({ entry, topOrigin }));
  }

  const pageList = pages || [];
  if (!pageList.length) {
    const topOrigin = resolveSingleTopOrigin(entries);
    return entries.map((entry) => ({ entry, topOrigin }));
  }

  const pageById = new Map<string, HarPage>();
  for (const page of pageList) {
    if (typeof page.id === "string" && page.id) {
      pageById.set(page.id, page);
    }
  }

  const entriesByPage = new Map<string, HarEntry[]>();
  const ungroupedEntries: HarEntry[] = [];

  for (const entry of entries) {
    if (typeof entry.pageref === "string" && entry.pageref && pageById.has(entry.pageref)) {
      const pageEntries = entriesByPage.get(entry.pageref) || [];
      pageEntries.push(entry);
      entriesByPage.set(entry.pageref, pageEntries);
      continue;
    }

    ungroupedEntries.push(entry);
  }

  const resolved: ResolvedHarEntry[] = [];
  const resolvedPageOrigins = new Set<string>();

  for (const [pageId, pageEntries] of entriesByPage) {
    const page = pageById.get(pageId);
    const topOrigin = getHttpOrigin(page?.title) || resolveSingleTopOrigin(pageEntries);
    resolvedPageOrigins.add(topOrigin);

    for (const entry of pageEntries) {
      resolved.push({ entry, topOrigin });
    }
  }

  if (ungroupedEntries.length > 0) {
    const topOrigin = resolveUngroupedEntriesTopOrigin(ungroupedEntries, resolvedPageOrigins);
    for (const entry of ungroupedEntries) {
      resolved.push({ entry, topOrigin });
    }
  }

  return resolved;
}

interface PlannedWrite {
  relativePath: string;
  content: Buffer;
  topOrigin: string;
  kind: "request" | "meta" | "body" | "projection";
}

function isMetadataWritePath(relativePath: string): boolean {
  const fileName = path.basename(relativePath);
  return fileName === "request.json"
    || fileName === "response.meta.json"
    || fileName.endsWith(".__request.json")
    || fileName.endsWith(".__response.json");
}

async function createPlannedWrites(preparedEntries: PreparedHarEntry[]): Promise<PlannedWrite[]> {
  const plannedWrites = await Promise.all(preparedEntries.map(async (prepared) => {
    const requestBuffer = Buffer.from(JSON.stringify(prepared.request, null, 2), "utf8");
    const metaBuffer = Buffer.from(JSON.stringify(prepared.response.meta, null, 2), "utf8");
    const bodyBuffer = prepared.response.bodyEncoding === "base64"
      ? Buffer.from(prepared.response.body, "base64")
      : Buffer.from(prepared.response.body, "utf8");
    const projectionPayload = prepared.descriptor.projectionPath
      ? await createProjectedFixturePayload({
        relativePath: prepared.descriptor.projectionPath,
        payload: {
          body: prepared.response.body,
          bodyEncoding: prepared.response.bodyEncoding
        },
        mimeType: prepared.response.meta.mimeType,
        resourceType: prepared.response.meta.resourceType
      })
      : null;
    const projectionBuffer = projectionPayload
      ? projectionPayload.bodyEncoding === "base64"
        ? Buffer.from(projectionPayload.body, "base64")
        : Buffer.from(projectionPayload.body, "utf8")
      : null;

    const writes: PlannedWrite[] = [
      {
        relativePath: prepared.descriptor.requestPath,
        content: requestBuffer,
        topOrigin: prepared.topOrigin,
        kind: "request"
      },
      {
        relativePath: prepared.descriptor.metaPath,
        content: metaBuffer,
        topOrigin: prepared.topOrigin,
        kind: "meta"
      },
      {
        relativePath: prepared.descriptor.bodyPath,
        content: bodyBuffer,
        topOrigin: prepared.topOrigin,
        kind: "body"
      },
      ...(prepared.descriptor.projectionPath && projectionBuffer
        ? [{
          relativePath: prepared.descriptor.projectionPath,
          content: projectionBuffer,
          topOrigin: prepared.topOrigin,
          kind: "projection" as const
        }]
        : [])
    ];

    return writes;
  }));

  return plannedWrites.flat();
}

async function assertPlannedWritesAreCompatible(
  dir: string,
  preparedEntries: PreparedHarEntry[]
): Promise<void> {
  const rootFs = createFixtureRootFs(dir);
  const plannedByPath = new Map<string, PlannedWrite>();

  for (const write of await createPlannedWrites(preparedEntries)) {
    const existingPlanned = plannedByPath.get(write.relativePath);
    if (existingPlanned) {
      if (write.kind !== "body" && write.kind !== "projection") {
        continue;
      }

      if (existingPlanned.topOrigin === write.topOrigin) {
        if (write.kind === "body") {
          plannedByPath.set(write.relativePath, write);
        }
        continue;
      }

      if (!existingPlanned.content.equals(write.content)) {
        throw new Error(`Cannot import HAR because multiple entries would write different content to ${write.relativePath}.`);
      }
      continue;
    }

    plannedByPath.set(write.relativePath, write);
  }

  for (const [relativePath, write] of plannedByPath) {
    const existingStat = await rootFs.stat(relativePath);
    if (!existingStat) {
      continue;
    }

    if (existingStat.isDirectory()) {
      throw new Error(`Cannot import HAR because ${relativePath} already exists as a directory.`);
    }

    if (isMetadataWritePath(relativePath)) {
      continue;
    }

    const absolutePath = rootFs.resolve(relativePath)!;
    const existingContent = await fs.readFile(absolutePath);
    if (!existingContent.equals(write.content)) {
      throw new Error(`Cannot import HAR because ${relativePath} already exists with different content.`);
    }
  }
}

function resolveRequestBody(entry: HarEntry): { body: string; bodyEncoding: string } | null {
  if (entry.request.method.toUpperCase() === "GET") {
    return { body: "", bodyEncoding: "utf8" };
  }

  const postData = entry.request.postData;
  if (!postData) {
    return null;
  }

  if (typeof postData.text === "string") {
    return {
      body: postData.text,
      bodyEncoding: "utf8"
    };
  }

  if (postData.mimeType === "application/x-www-form-urlencoded" && Array.isArray(postData.params)) {
    const params = new URLSearchParams();
    for (const param of postData.params) {
      if (!param || typeof param !== "object" || typeof param.name !== "string") {
        return null;
      }
      params.append(param.name, typeof param.value === "string" ? param.value : "");
    }
    return {
      body: params.toString(),
      bodyEncoding: "utf8"
    };
  }

  return null;
}

function resolveResponseBody(entry: HarEntry): { body: string; bodyEncoding: "utf8" | "base64" } | null {
  const content = entry.response.content;
  if (!content || typeof content.text !== "string") {
    return null;
  }

  return {
    body: content.text,
    bodyEncoding: content.encoding === "base64" ? "base64" : "utf8"
  };
}

function ensureWritableRoot(dir: string): Promise<RootSentinel> {
  return createRoot(dir);
}

function createResponseMetaForEntry(
  entry: HarEntry,
  bodyEncoding: "utf8" | "base64",
  mimeType: string,
  resourceType: string
): ResponseMeta {
  return buildResponseMeta({
    responseStatus: entry.response.status,
    responseStatusText: entry.response.statusText,
    responseHeaders: sanitizeResponseHeaders(asHeaders(entry.response.headers)),
    mimeType,
    resourceType,
    url: entry.request.url,
    method: entry.request.method.toUpperCase()
  }, bodyEncoding, entry.startedDateTime);
}

async function prepareHarEntries(
  resolvedEntries: ResolvedHarEntry[]
): Promise<{ prepared: PreparedHarEntry[]; skipped: HarSkippedEntry[] }> {
  const prepared: PreparedHarEntry[] = [];
  const skipped: HarSkippedEntry[] = [];

  for (const resolvedEntry of resolvedEntries) {
    const { entry, topOrigin } = resolvedEntry;
    const method = entry.request.method.toUpperCase();
    let requestUrl: URL;

    try {
      requestUrl = new URL(entry.request.url);
    } catch {
      skipped.push({ requestUrl: entry.request.url, method, reason: "Invalid request URL", topOrigin });
      continue;
    }

    if (!["http:", "https:"].includes(requestUrl.protocol)) {
      skipped.push({ requestUrl: entry.request.url, method, reason: "Unsupported request protocol", topOrigin });
      continue;
    }

    const mimeType = getNormalizedMimeType(entry);
    const resourceType = inferResourceType(entry, mimeType);
    const requestBody = resolveRequestBody(entry);
    if (!requestBody) {
      skipped.push({
        requestUrl: entry.request.url,
        method,
        reason: "Cannot reconstruct a stable request body for hashing",
        topOrigin
      });
      continue;
    }

    const responseBody = resolveResponseBody(entry);
    if (!responseBody) {
      skipped.push({
        requestUrl: entry.request.url,
        method,
        reason: "Response body is missing from HAR content.text",
        topOrigin
      });
      continue;
    }

    const descriptor = await createFixtureDescriptor({
      topOrigin,
      method,
      url: entry.request.url,
      postData: requestBody.body,
      postDataEncoding: requestBody.bodyEncoding,
      resourceType,
      mimeType
    });

    prepared.push({
      entry,
      topOrigin,
      descriptor,
      request: buildRequestPayload({
        topOrigin,
        url: entry.request.url,
        method,
        requestHeaders: asHeaders(entry.request.headers),
        requestBody: requestBody.body,
        requestBodyEncoding: requestBody.bodyEncoding,
        descriptor
      }, entry.startedDateTime),
      response: {
        body: responseBody.body,
        bodyEncoding: responseBody.bodyEncoding,
        meta: createResponseMetaForEntry(entry, responseBody.bodyEncoding, mimeType, resourceType)
      }
    });
  }

  return { prepared, skipped };
}

async function writePreparedEntries(
  dir: string,
  preparedEntries: PreparedHarEntry[],
  onEvent?: (event: HarImportEvent) => void | Promise<void>
): Promise<HarImportedEntry[]> {
  const rootFs = createFixtureRootFs(dir);
  const imported: HarImportedEntry[] = [];
  const manifestCache = new Map<string, StaticResourceManifest>();

  for (const [index, prepared] of preparedEntries.entries()) {
    const { descriptor, request, response, entry } = prepared;
    const displayPath = descriptor.projectionPath ?? descriptor.bodyPath;
    const completedEntries = index;
    const totalEntries = preparedEntries.length;
    const bodyBufferSize = response.bodyEncoding === "base64"
      ? Buffer.byteLength(response.body, "base64")
      : Buffer.byteLength(response.body, "utf8");

    if (onEvent) {
      await onEvent({
        type: "entry-start",
        topOrigin: prepared.topOrigin,
        requestUrl: entry.request.url,
        bodyPath: displayPath,
        completedEntries,
        totalEntries,
        writtenBytes: 0,
        totalBytes: bodyBufferSize
      });
    }

    await rootFs.writeJson(descriptor.requestPath, request);
    await rootFs.writeJson(descriptor.metaPath, response.meta);
    await rootFs.writeBody(descriptor.bodyPath, response, {
      onProgress: onEvent
        ? (writtenBytes, totalBytes) => onEvent({
            type: "entry-progress",
            topOrigin: prepared.topOrigin,
            requestUrl: entry.request.url,
            bodyPath: displayPath,
            completedEntries,
            totalEntries,
            writtenBytes,
            totalBytes
          })
        : undefined
    });

    let projectionPath: string | null = null;
    if (descriptor.projectionPath && !(await rootFs.exists(descriptor.projectionPath))) {
      projectionPath = descriptor.projectionPath;
      await rootFs.writeBody(
        descriptor.projectionPath,
        await createProjectedFixturePayload({
          relativePath: descriptor.projectionPath,
          payload: {
            body: response.body,
            bodyEncoding: response.bodyEncoding
          },
          mimeType: response.meta.mimeType,
          resourceType: response.meta.resourceType
        })
      );
    }

    if (descriptor.assetLike) {
      const manifestPath = getStaticResourceManifestPath(descriptor as AssetFixtureDescriptor);
      if (manifestPath) {
        const cachedManifest = manifestCache.get(manifestPath)
          || await rootFs.readOptionalJson<StaticResourceManifest>(manifestPath)
          || createStaticResourceManifest(descriptor as AssetFixtureDescriptor);
        const nextManifest = upsertStaticResourceManifest(
          cachedManifest,
          createStaticResourceManifestEntry(descriptor as AssetFixtureDescriptor, response.meta, {
            projectionPath
          })
        );
        manifestCache.set(manifestPath, nextManifest);
      }
    }

    imported.push({
      requestUrl: entry.request.url,
      bodyPath: displayPath,
      method: descriptor.method,
      topOrigin: prepared.topOrigin
    });

    if (onEvent) {
      await onEvent({
        type: "entry-complete",
        topOrigin: prepared.topOrigin,
        requestUrl: entry.request.url,
        bodyPath: displayPath,
        completedEntries: index + 1,
        totalEntries
      });
    }
  }

  for (const [manifestPath, manifest] of manifestCache) {
    await rootFs.writeJson(manifestPath, manifest);
  }

  return imported;
}

export async function importHarFile(options: ImportHarFileOptions): Promise<ImportHarFileResult> {
  const dir = path.resolve(options.dir);
  const harPath = path.resolve(options.harPath);
  const content = await fs.readFile(harPath, "utf8");
  const archive = parseHarArchive(content);
  const sortedEntries = sortEntriesByStartedDateTime(archive.log.entries);
  const sentinel = await ensureWritableRoot(dir);
  const resolvedEntries = resolveEntryTopOrigins(sortedEntries, archive.log.pages, options.topOrigin);
  const topOrigins = [...new Set(resolvedEntries.map((resolved) => resolved.topOrigin))].sort();
  const topOrigin = topOrigins[0]!;
  const { prepared, skipped } = await prepareHarEntries(resolvedEntries);
  await assertPlannedWritesAreCompatible(dir, prepared);

  if (options.onEvent) {
    await options.onEvent({
      type: "scan-complete",
      totalEntries: sortedEntries.length,
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
        totalCandidates: sortedEntries.length
      });
    }
  }

  const imported = await writePreparedEntries(dir, prepared, options.onEvent);

  return {
    dir,
    sentinel,
    topOrigin,
    topOrigins,
    imported,
    skipped
  };
}
