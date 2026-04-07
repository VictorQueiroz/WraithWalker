import {
  buildRequestPayload as defaultBuildRequestPayload,
  buildResponseMeta as defaultBuildResponseMeta,
  replayResponseHeaders as defaultReplayResponseHeaders
} from "@wraithwalker/core/fixture-layout";
import type { HeaderEntry, RequestEntry, RequestPayload, ResponseMeta, SessionSnapshot } from "./types.js";

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
  return defaultReplayResponseHeaders(headers);
}

export function buildSessionSnapshot({
  sessionActive,
  attachedTabIds,
  enabledOrigins,
  rootReady,
  lastError
}: {
  sessionActive: boolean;
  attachedTabIds: Iterable<number>;
  enabledOrigins: Iterable<string>;
  rootReady: boolean;
  lastError: string;
}): SessionSnapshot {
  return {
    sessionActive,
    attachedTabIds: [...attachedTabIds],
    enabledOrigins: [...enabledOrigins],
    rootReady,
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
  return defaultBuildRequestPayload({
    topOrigin: entry.topOrigin,
    url: entry.url,
    method: entry.method,
    requestHeaders: entry.requestHeaders,
    requestBody: entry.requestBody,
    requestBodyEncoding: entry.requestBodyEncoding,
    descriptor: entry.descriptor
  }, capturedAt);
}

export function buildResponseMeta(
  entry: RequestEntry,
  bodyEncoding: string,
  capturedAt = new Date().toISOString()
): ResponseMeta {
  return defaultBuildResponseMeta({
    responseStatus: entry.responseStatus,
    responseStatusText: entry.responseStatusText,
    responseHeaders: entry.responseHeaders,
    mimeType: entry.mimeType,
    resourceType: entry.resourceType,
    url: entry.url,
    method: entry.method
  }, bodyEncoding, capturedAt);
}
