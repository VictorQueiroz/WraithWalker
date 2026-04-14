import {
  buildRequestPayload as defaultBuildRequestPayload,
  buildResponseMeta as defaultBuildResponseMeta,
  replayResponseHeaders as defaultReplayResponseHeaders
} from "@wraithwalker/core/fixture-layout";
import type {
  HeaderEntry,
  RequestEntry,
  RequestPayload,
  ResponseMeta,
  SessionSnapshot
} from "./types.js";

type HeaderCollection = HeaderEntry[] | Record<string, unknown>;
interface ReplayResponseHeaderOptions {
  assetLike?: boolean;
  requestHeaders?: HeaderEntry[];
  topOrigin?: string;
}

function findHeader(
  headers: HeaderEntry[],
  targetName: string
): HeaderEntry | undefined {
  const normalizedTarget = targetName.toLowerCase();
  return headers.find(
    (header) => header.name.toLowerCase() === normalizedTarget
  );
}

function hasVaryToken(headerValue: string, token: string): boolean {
  const normalizedToken = token.toLowerCase();
  return headerValue
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalizedToken);
}

function withOriginVary(headers: HeaderEntry[]): HeaderEntry[] {
  const varyHeader = findHeader(headers, "Vary");
  if (!varyHeader) {
    return [...headers, { name: "Vary", value: "Origin" }];
  }

  if (hasVaryToken(varyHeader.value, "Origin")) {
    return headers;
  }

  return headers.map((header) =>
    header === varyHeader
      ? { ...header, value: `${header.value}, Origin` }
      : header
  );
}

function isCredentialedAssetRequest(headers: HeaderEntry[]): boolean {
  return Boolean(
    findHeader(headers, "Cookie")?.value.trim() ||
    findHeader(headers, "Authorization")?.value.trim()
  );
}

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

export function findMatchingOrigin(
  url: string,
  enabledOrigins: string[]
): string | null {
  const origin = extractOrigin(url);
  return origin && enabledOrigins.includes(origin) ? origin : null;
}

export function arrayifyHeaders(headers: HeaderCollection = {}): HeaderEntry[] {
  if (Array.isArray(headers)) {
    return headers.map((header) => ({
      name: header.name,
      value: String(header.value ?? "")
    }));
  }

  return Object.entries(headers).map(([name, value]) => ({
    name,
    value: String(value)
  }));
}

export function replayResponseHeaders(
  headers: HeaderEntry[] = [],
  options: ReplayResponseHeaderOptions = {}
): HeaderEntry[] {
  const replayedHeaders = defaultReplayResponseHeaders(headers);
  if (
    !options.assetLike ||
    findHeader(replayedHeaders, "Access-Control-Allow-Origin")
  ) {
    return replayedHeaders;
  }

  const requestOrigin = findHeader(
    options.requestHeaders || [],
    "Origin"
  )?.value.trim();
  const fetchMode = findHeader(options.requestHeaders || [], "Sec-Fetch-Mode")
    ?.value.trim()
    .toLowerCase();
  if (!requestOrigin && fetchMode !== "cors") {
    return replayedHeaders;
  }

  const allowOrigin = requestOrigin || options.topOrigin?.trim();
  if (!allowOrigin) {
    return replayedHeaders;
  }

  const synthesizedHeaders: HeaderEntry[] = [
    ...replayedHeaders,
    { name: "Access-Control-Allow-Origin", value: allowOrigin }
  ];

  if (isCredentialedAssetRequest(options.requestHeaders || [])) {
    synthesizedHeaders.push({
      name: "Access-Control-Allow-Credentials",
      value: "true"
    });
  }

  return withOriginVary(synthesizedHeaders);
}

export function buildSessionSnapshot({
  sessionActive,
  attachedTabIds,
  enabledOrigins,
  rootReady,
  captureDestination,
  captureRootPath,
  lastError
}: {
  sessionActive: boolean;
  attachedTabIds: Iterable<number>;
  enabledOrigins: Iterable<string>;
  rootReady: boolean;
  captureDestination: SessionSnapshot["captureDestination"];
  captureRootPath: string;
  lastError: string;
}): SessionSnapshot {
  return {
    sessionActive,
    attachedTabIds: [...attachedTabIds],
    enabledOrigins: [...enabledOrigins],
    rootReady,
    captureDestination,
    captureRootPath,
    lastError
  };
}

export function createRequestEntry({
  existingEntry,
  tabId,
  requestId,
  topOrigin,
  requestedAt = new Date().toISOString()
}: {
  existingEntry?: RequestEntry | null;
  tabId: number;
  requestId: string;
  topOrigin: string;
  requestedAt?: string;
}): RequestEntry {
  return (
    existingEntry || {
      tabId,
      requestId,
      requestedAt,
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
      replayOnResponse: false,
      responseStatus: 200,
      responseStatusText: "OK",
      responseHeaders: []
    }
  );
}

export function buildRequestPayload(
  entry: RequestEntry,
  capturedAt = new Date().toISOString()
): RequestPayload {
  return defaultBuildRequestPayload(
    {
      topOrigin: entry.topOrigin,
      url: entry.url,
      method: entry.method,
      requestHeaders: entry.requestHeaders,
      requestBody: entry.requestBody,
      requestBodyEncoding: entry.requestBodyEncoding,
      descriptor: entry.descriptor
    },
    capturedAt
  );
}

export function buildResponseMeta(
  entry: RequestEntry,
  bodyEncoding: string,
  capturedAt = new Date().toISOString()
): ResponseMeta {
  return defaultBuildResponseMeta(
    {
      responseStatus: entry.responseStatus,
      responseStatusText: entry.responseStatusText,
      responseHeaders: entry.responseHeaders,
      mimeType: entry.mimeType,
      resourceType: entry.resourceType,
      url: entry.url,
      method: entry.method
    },
    bodyEncoding,
    capturedAt
  );
}
