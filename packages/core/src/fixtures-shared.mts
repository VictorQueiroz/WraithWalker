import { promises as fs } from "node:fs";
import path from "node:path";

import {
  ROOT_SENTINEL_RELATIVE_PATH,
  SCENARIOS_DIR,
  STATIC_RESOURCE_MANIFEST_FILE,
  WRAITHWALKER_DIR
} from "./constants.mjs";
import { type ResponseMeta } from "./fixture-layout.mjs";
import { resolveWithinRoot } from "./root-fs.mjs";
import type { PaginatedResult, PatchProjectionFileOptions } from "./fixtures-types.mjs";

export interface SearchableFixtureEntry {
  path: string;
  sourceKind: "asset" | "endpoint" | "file";
  origin: string | null;
  pathname: string | null;
  mimeType: string | null;
  resourceType: string | null;
  editable: boolean;
  canonicalPath: string | null;
}

export type TextFixtureReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: "invalid-path" | "missing" | "binary" };

export interface FixturePresentationContext {
  mimeType?: string | null;
  resourceType?: string | null;
}

export const DEFAULT_ASSET_LIMIT = 50;
export const MAX_ASSET_LIMIT = 200;
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 100;
export const DEFAULT_SNIPPET_LINE_COUNT = 80;
export const MAX_SNIPPET_LINE_COUNT = 400;
export const DEFAULT_SNIPPET_MAX_BYTES = 16000;
export const MAX_SNIPPET_MAX_BYTES = 64000;
export const MAX_FULL_READ_BYTES = 64 * 1024;

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

export function normalizeLimit(limit: number | undefined, defaultLimit: number, maxLimit: number): number {
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

export function paginateItems<T>(
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

export function normalizeSearchPath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export function isHiddenFixturePath(relativePath: string): boolean {
  const normalized = normalizeSearchPath(relativePath);
  return normalized === WRAITHWALKER_DIR || normalized.startsWith(`${WRAITHWALKER_DIR}/`);
}

export function isApiResponseBodyPath(relativePath: string): boolean {
  return normalizeSearchPath(relativePath).endsWith("/response.body");
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function isExcludedSearchPath(relativePath: string): boolean {
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

export function guessMimeType(relativePath: string): string | null {
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

export function isEditableProjectionMimeType(value?: string | null): boolean {
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

export function isEditableProjectionResourceType(value?: string | null): boolean {
  const resourceType = (value || "").trim().toLowerCase();
  return resourceType === "document"
    || resourceType === "fetch"
    || resourceType === "script"
    || resourceType === "stylesheet"
    || resourceType === "xhr";
}

export function isEditableProjectionPath(relativePath?: string | null): boolean {
  if (!relativePath) {
    return false;
  }

  return EDITABLE_PROJECTION_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

export function isEditableProjectionAsset(
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

export function looksBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

export async function readTextFixture(rootPath: string, relativePath: string): Promise<TextFixtureReadResult> {
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

export function applyLinePatch(
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

export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return { text, truncated: false };
  }

  return {
    text: buffer.subarray(0, maxBytes).toString("utf8"),
    truncated: true
  };
}

export function createProjectionEditError(relativePath: string): Error {
  if (isApiResponseBodyPath(relativePath)) {
    return new Error(`API response fixtures are read-only in this pass: ${relativePath}`);
  }
  if (isHiddenFixturePath(relativePath)) {
    return new Error(`Hidden canonical files under .wraithwalker cannot be edited with projection tools: ${relativePath}`);
  }
  return new Error(`File is not a projection-backed captured asset: ${relativePath}`);
}

export async function readProjectionResponseMeta(
  rootFs: {
    readOptionalJson<T>(relativePath: string): Promise<T | null>;
  },
  metaPath: string
): Promise<ResponseMeta | null> {
  return rootFs.readOptionalJson<ResponseMeta>(metaPath);
}
