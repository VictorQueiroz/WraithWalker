import { BODY_DERIVED_HEADERS, HOP_BY_HOP_HEADERS } from "./constants.js";
import { sanitizeResponseHeaders } from "./fixture-mapper.js";
import { deriveExtensionFromMime } from "./path-utils.js";
import type { HeaderEntry, NativeHostConfig, RequestEntry, RequestPayload, ResponseMeta, SessionSnapshot } from "./types.js";

type HeaderCollection = HeaderEntry[] | Record<string, unknown>;

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function extractOrigin(url: string): string | null {
  return isHttpUrl(url) ? new URL(url).origin : null;
}

export function findMatchingOrigin(url: string, enabledOrigins: string[]): string | null {
  const origin = extractOrigin(url);
  return origin && enabledOrigins.includes(origin) ? origin : null;
}

export function arrayifyHeaders(headers: HeaderCollection = {}): HeaderEntry[] {
  if (Array.isArray(headers)) {
    return headers.map((header) => ({ name: header.name, value: String(header.value ?? "") }));
  }

  return Object.entries(headers).map(([name, value]) => ({
    name,
    value: String(value)
  }));
}

export function replayResponseHeaders(headers: HeaderEntry[] = []): HeaderEntry[] {
  return sanitizeResponseHeaders(headers).filter((header) => {
    const lowerName = header.name.toLowerCase();
    return !BODY_DERIVED_HEADERS.has(lowerName) && !HOP_BY_HOP_HEADERS.has(lowerName);
  });
}

export function buildSessionSnapshot({
  sessionActive,
  attachedTabIds,
  enabledOrigins,
  rootReady,
  nativeHostConfig,
  lastError
}: {
  sessionActive: boolean;
  attachedTabIds: Iterable<number>;
  enabledOrigins: Iterable<string>;
  rootReady: boolean;
  nativeHostConfig: NativeHostConfig;
  lastError: string;
}): SessionSnapshot {
  return {
    sessionActive,
    attachedTabIds: [...attachedTabIds],
    enabledOrigins: [...enabledOrigins],
    rootReady,
    helperReady: Boolean(nativeHostConfig.verifiedAt && !nativeHostConfig.lastVerificationError),
    lastError
  };
}

export function createRequestEntry({
  existingEntry,
  tabId,
  requestId,
  topOrigin
}: {
  existingEntry?: RequestEntry | null;
  tabId: number;
  requestId: string;
  topOrigin: string;
}): RequestEntry {
  return existingEntry || {
    tabId,
    requestId,
    topOrigin,
    method: "GET",
    url: "",
    requestHeaders: [],
    requestBody: "",
    requestBodyEncoding: "utf8",
    descriptor: null,
    resourceType: "",
    mimeType: "",
    replayed: false,
    responseStatus: 200,
    responseStatusText: "OK",
    responseHeaders: []
  };
}

export function buildRequestPayload(entry: RequestEntry, capturedAt = new Date().toISOString()): RequestPayload {
  return {
    topOrigin: entry.topOrigin,
    url: entry.url,
    method: entry.method,
    headers: entry.requestHeaders,
    body: entry.requestBody,
    bodyEncoding: entry.requestBodyEncoding,
    bodyHash: entry.descriptor?.bodyHash || "",
    queryHash: entry.descriptor?.queryHash || "",
    capturedAt
  };
}

export function buildResponseMeta(
  entry: RequestEntry,
  bodyEncoding: string,
  capturedAt = new Date().toISOString()
): ResponseMeta {
  return {
    status: entry.responseStatus,
    statusText: entry.responseStatusText,
    headers: sanitizeResponseHeaders(entry.responseHeaders),
    mimeType: entry.mimeType,
    resourceType: entry.resourceType,
    url: entry.url,
    method: entry.method,
    capturedAt,
    bodyEncoding,
    bodySuggestedExtension: deriveExtensionFromMime(entry.mimeType)
  };
}
