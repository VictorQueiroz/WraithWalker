import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

import { parse } from "@babel/parser";
import { getFixtureDisplayPath } from "@wraithwalker/core/fixture-layout";
import { createFixtureRootFs } from "@wraithwalker/core/root-fs";

import {
  flattenStaticResourceManifest,
  listApiEndpoints,
  readOriginInfo,
  readSiteConfigs,
  type ApiEndpoint
} from "./fixture-reader.mjs";

export type JsSearchKind =
  | "identifier"
  | "string"
  | "call"
  | "property"
  | "endpoint"
  | "selector"
  | "export";

export interface JsSourceMapReference {
  url: string;
  kind: "external" | "inline";
  line: number;
}

export interface JsLocation {
  line: number;
  column: number;
}

export interface JsPublicValueMetadata {
  valuePreview: string;
  valueBytes: number;
  valueTruncated: boolean;
  valueHash: string;
}

export interface JsSummaryEntry extends JsPublicValueMetadata {
  value: string;
  nodeKind: string;
  nodeId: string;
  loc: JsLocation | null;
  enclosingSymbol: string | null;
}

export interface JsImportSummary {
  source: string;
  specifiers: string[];
  loc: JsLocation | null;
}

export interface JsExportSummary extends JsSummaryEntry {
  source?: string | null;
}

export interface JsSymbolSummary extends JsSummaryEntry {
  kind: "function" | "class" | "variable" | "type" | "interface";
  lineRange: {
    start: number;
    end: number;
  };
}

export interface JsCallSummary extends JsSummaryEntry {
  firstArgument?: string | null;
}

export interface JsFileAnalysis {
  path: string;
  size: number;
  analysisMode: "ast" | "text-scan";
  sourceMap: JsSourceMapReference | null;
  parse: {
    ok: boolean;
    recovered: boolean;
    skipped?: boolean;
    reason?: "file-too-large";
    errors: Array<{
      message: string;
      loc: JsLocation | null;
    }>;
  };
  summary: {
    imports: JsImportSummary[];
    exports: JsExportSummary[];
    topLevelSymbols: JsSymbolSummary[];
    endpointStrings: JsSummaryEntry[];
    selectorStrings: JsSummaryEntry[];
    notableCalls: JsCallSummary[];
    counts: Record<string, number>;
    truncated: Record<string, boolean>;
  };
}

export interface JsSearchOptions {
  query: string;
  kind?: JsSearchKind;
  origin?: string;
  pathContains?: string;
  limit?: number;
  cursor?: string;
}

export interface JsSearchMatch {
  path: string;
  origin: string | null;
  pathname: string | null;
  kind: JsSearchKind;
  value: string;
  valuePreview: string;
  valueBytes: number;
  valueTruncated: boolean;
  valueHash: string;
  nodeKind: string;
  nodeId: string;
  loc: JsLocation | null;
  enclosingSymbol: string | null;
  snippet: string;
}

export interface JsSearchResult {
  items: JsSearchMatch[];
  nextCursor: string | null;
  totalMatched: number;
  matchedOrigins: string[];
  skipped: Array<{
    path: string;
    reason: string;
  }>;
}

export interface JsSymbolReadResult {
  path: string;
  nodeId: string;
  symbol: string | null;
  nodeKind: string;
  enclosingSymbol: string | null;
  startLine: number;
  endLine: number;
  truncated: boolean;
  text: string;
}

export interface JsApiResponseLink {
  matchStatus: "matched" | "no-match";
  fixtureDir?: string;
  bodyPath?: string;
  method?: string;
  status?: number;
  pathname?: string;
  reason?: string;
}

export type JsPipelineSeedKind = "endpoint" | "selector" | "symbol" | "nodeId";
export type JsSeedKind = "endpoint" | "selector" | "call" | "string";

export type JsPipelineConfidence = "high" | "medium" | "low";

export type JsPipelineStepKind =
  | "entrypoint"
  | "handler"
  | "selector"
  | "call"
  | "endpoint"
  | "api-response";

export interface JsPipelineTraceOptions {
  seed: string;
  kind: JsPipelineSeedKind;
  origin?: string;
  pathContains?: string;
  limit?: number;
}

export interface JsPipelineStep {
  kind: JsPipelineStepKind;
  label: string;
  value?: string;
  valuePreview?: string;
  valueBytes?: number;
  valueTruncated?: boolean;
  valueHash?: string;
  path?: string;
  nodeId?: string;
  loc?: JsLocation | null;
  snippet?: string;
  fixtureDir?: string;
  bodyPath?: string;
  method?: string;
  status?: number;
  pathname?: string;
}

export interface JsPipelineEvidence {
  kind: "fact" | "symbol" | "api-response";
  path?: string;
  value?: string;
  valuePreview?: string;
  valueBytes?: number;
  valueTruncated?: boolean;
  valueHash?: string;
  nodeId?: string;
  loc?: JsLocation | null;
  lineRange?: {
    start: number;
    end: number;
  };
  snippet?: string;
  fixtureDir?: string;
  bodyPath?: string;
  method?: string;
  status?: number;
  pathname?: string;
}

export interface JsPipelineCandidate {
  pipelineId: string;
  confidence: JsPipelineConfidence;
  path: string;
  origin: string | null;
  pathname: string | null;
  analysisMode: "ast" | "text-scan";
  seed: {
    kind: JsPipelineSeedKind;
    value: string;
    valuePreview: string;
    valueBytes: number;
    valueTruncated: boolean;
    valueHash: string;
    nodeId?: string;
    loc?: JsLocation | null;
  };
  summary: string;
  steps: JsPipelineStep[];
  evidence: JsPipelineEvidence[];
  apiResponseLinks: JsApiResponseLink[];
  warnings: string[];
}

export interface JsPipelineTraceResult {
  items: JsPipelineCandidate[];
  totalMatched: number;
  matchedOrigins: string[];
  skipped: Array<{
    path: string;
    reason: string;
  }>;
}

export interface JsSeedSuggestionOptions {
  kinds?: JsSeedKind[];
  origin?: string;
  pathContains?: string;
  limit?: number;
  cursor?: string;
}

export interface JsSeedSuggestion extends JsPublicValueMetadata {
  path: string;
  origin: string | null;
  pathname: string | null;
  kind: JsSeedKind;
  value: string;
  nodeKind: string;
  nodeId: string;
  loc: JsLocation | null;
  enclosingSymbol: string | null;
  snippet: string;
  analysisMode: "ast" | "text-scan";
  apiResponseLink?: JsApiResponseLink;
  score: number;
  reasons: string[];
}

export interface JsSeedSuggestionResult {
  items: JsSeedSuggestion[];
  nextCursor: string | null;
  totalMatched: number;
  matchedOrigins: string[];
  skipped: Array<{
    path: string;
    reason: string;
  }>;
}

interface JsFixtureEntry {
  path: string;
  origin: string | null;
  pathname: string | null;
  mimeType: string | null;
  resourceType: string | null;
  canonicalPath: string | null;
}

interface JsFact {
  path: string;
  origin: string | null;
  pathname: string | null;
  kind: JsSearchKind;
  value: string;
  nodeKind: string;
  nodeId: string;
  loc: JsLocation | null;
  enclosingSymbol: string | null;
  snippet: string;
  start: number;
  end: number;
}

interface InternalSymbol extends JsSymbolSummary {
  start: number;
  end: number;
}

interface AnalysisIndexes {
  factsByNodeId: Map<string, JsFact[]>;
  symbolsByNodeId: Map<string, InternalSymbol[]>;
  factsByKind: Map<JsSearchKind, JsFact[]>;
  factsByEnclosingSymbol: Map<string, JsFact[]>;
  callFactsByValue: Map<string, JsFact[]>;
  symbolsByName: Map<string, InternalSymbol>;
}

interface InternalAnalysis {
  publicAnalysis: JsFileAnalysis;
  facts: JsFact[];
  symbols: InternalSymbol[];
  indexes: AnalysisIndexes;
  text: string | null;
  ast: unknown | null;
}

interface AnalysisCacheEntry {
  mtimeMs: number;
  size: number;
  analysis: InternalAnalysis;
}

const JS_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const JS_MIME_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/typescript",
  "text/ecmascript",
  "text/javascript",
  "text/typescript"
]);
const MAX_ANALYSIS_BYTES = 256 * 1024;
const MAX_SEED_AST_ANALYSIS_BYTES = 128 * 1024;
const MAX_ANALYSIS_CACHE_ENTRIES = 16;
const MAX_ANALYSIS_CACHE_BYTES = 20 * 1024 * 1024;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
const DEFAULT_PIPELINE_LIMIT = 5;
const MAX_PIPELINE_LIMIT = 20;
const SUMMARY_LIMIT = 50;
const SNIPPET_MAX_BYTES = 32_000;
const TEXT_SCAN_SYMBOL_SNIPPET_BYTES = 8_192;
const MAX_PUBLIC_JS_VALUE_BYTES = 1_024;
const TEXT_SCAN_CHUNK_BYTES = 64 * 1024;
const TEXT_SCAN_CARRY_CHARS = 4096;
const TEXT_SCAN_FACT_LIMIT_PER_KIND = 500;
const MAX_API_RESPONSE_LINKS = 3;

const analysisCache = new Map<string, AnalysisCacheEntry>();
let analysisCacheBytes = 0;

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

function extname(relativePath: string): string {
  const pathname = relativePath.split("?")[0] ?? relativePath;
  return path.extname(pathname).toLowerCase();
}

function normalizeMimeType(mimeType?: string | null): string {
  return (mimeType || "").split(";")[0]?.trim().toLowerCase() || "";
}

function normalizeResourceType(resourceType?: string | null): string {
  return (resourceType || "").trim().toLowerCase();
}

function isJavaScriptLikePath(relativePath: string): boolean {
  return JS_EXTENSIONS.has(extname(relativePath));
}

function isJavaScriptLikeAsset(asset: {
  mimeType?: string | null;
  resourceType?: string | null;
  bodyPath?: string | null;
  projectionPath?: string | null;
}): boolean {
  return (
    normalizeResourceType(asset.resourceType) === "script" ||
    JS_MIME_TYPES.has(normalizeMimeType(asset.mimeType)) ||
    Boolean(
      asset.projectionPath && isJavaScriptLikePath(asset.projectionPath)
    ) ||
    Boolean(asset.bodyPath && isJavaScriptLikePath(asset.bodyPath))
  );
}

function makeNodeId(node: any, fallback = "node"): string {
  const start = typeof node?.start === "number" ? node.start : 0;
  const end = typeof node?.end === "number" ? node.end : start;
  const kind = String(node?.type || fallback).replace(/[^a-z0-9_-]/gi, "-");
  return `js:${start}-${end}:${kind}`;
}

function makeTextScanNodeId(
  startByte: number,
  endByte: number,
  kind: string
): string {
  const normalizedKind = kind.replace(/[^a-z0-9_-]/gi, "-");
  return `js-text:${startByte}-${endByte}:${normalizedKind}`;
}

function parseNodeId(nodeId: string): { start: number; end: number } | null {
  const match = /^js:(\d+)-(\d+):/.exec(nodeId);
  if (!match) {
    return null;
  }

  return {
    start: Number(match[1]),
    end: Number(match[2])
  };
}

function parseTextScanNodeId(
  nodeId: string
): { startByte: number; endByte: number; kind: string } | null {
  const match = /^js-text:(\d+)-(\d+):(.+)$/.exec(nodeId);
  if (!match) {
    return null;
  }

  return {
    startByte: Number(match[1]),
    endByte: Number(match[2]),
    kind: match[3] ?? "TextMatch"
  };
}

function locFromNode(node: any): JsLocation | null {
  if (!node?.loc?.start) {
    return null;
  }

  return {
    line: node.loc.start.line,
    column: node.loc.start.column + 1
  };
}

function lineRangeFromNode(node: any): { start: number; end: number } {
  return {
    start: node?.loc?.start?.line ?? 1,
    end: node?.loc?.end?.line ?? node?.loc?.start?.line ?? 1
  };
}

function advanceLocationByText(start: JsLocation, text: string): JsLocation {
  let line = start.line;
  let column = start.column;
  let previousWasCr = false;

  for (const char of text) {
    if (char === "\r") {
      line += 1;
      column = 1;
      previousWasCr = true;
      continue;
    }

    if (char === "\n") {
      if (previousWasCr) {
        previousWasCr = false;
        continue;
      }

      line += 1;
      column = 1;
      continue;
    }

    previousWasCr = false;
    column += 1;
  }

  return { line, column };
}

function locationAtTextIndex(
  start: JsLocation,
  text: string,
  index: number
): JsLocation {
  return advanceLocationByText(start, text.slice(0, Math.max(0, index)));
}

function createLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function offsetToLocation(text: string, offset: number): JsLocation {
  const starts = createLineStarts(text);
  let lineIndex = 0;
  for (let index = 0; index < starts.length; index += 1) {
    if (starts[index] <= offset) {
      lineIndex = index;
      continue;
    }
    break;
  }

  return {
    line: lineIndex + 1,
    column: offset - starts[lineIndex] + 1
  };
}

function lineText(text: string, line: number): string {
  return text.split(/\r\n|\n|\r/)[line - 1] ?? "";
}

function shorten(value: string, maxLength = 180): string {
  const bounded =
    value.length > maxLength * 4 ? value.slice(0, maxLength * 4) : value;
  const compact = bounded.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 3)}...`;
}

function sourceSnippet(
  text: string,
  start: number,
  end: number,
  maxLength = 180
): string {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  const context = Math.max(40, Math.floor(maxLength / 2));
  const windowStart = Math.max(0, safeStart - context);
  const windowEnd = Math.min(text.length, safeEnd + context);
  return shorten(text.slice(windowStart, windowEnd), maxLength);
}

function truncateUtf8(
  text: string,
  maxBytes: number
): {
  text: string;
  truncated: boolean;
} {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) {
    return { text, truncated: false };
  }

  let end = text.length;
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > maxBytes) {
    end -= 1;
  }

  return { text: text.slice(0, end), truncated: true };
}

function publicValueMetadata(value: string): JsPublicValueMetadata & {
  value: string;
} {
  const preview = truncateUtf8(value, MAX_PUBLIC_JS_VALUE_BYTES);
  const valueBytes = Buffer.byteLength(value, "utf8");
  return {
    value: preview.text,
    valuePreview: preview.text,
    valueBytes,
    valueTruncated: preview.truncated,
    valueHash: stableHash(value)
  };
}

function withPublicValue<T extends { value: string }>(
  entry: T
): T & JsPublicValueMetadata {
  return {
    ...entry,
    ...publicValueMetadata(entry.value)
  };
}

function publicValueText(value: string): string {
  return publicValueMetadata(value).value;
}

function publicNullableValueText(value: string | null): string | null {
  return value === null ? null : publicValueText(value);
}

function publicOptionalValueText(
  value: string | undefined
): string | undefined {
  return value === undefined ? undefined : publicValueText(value);
}

function internalValueMetadata(value: string): JsPublicValueMetadata {
  const { value: _preview, ...metadata } = publicValueMetadata(value);
  return metadata;
}

function readRangeSnippet(
  text: string,
  start: number,
  end: number
): {
  text: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
} {
  const boundedStart = Math.max(0, start);
  const boundedEnd = Math.min(text.length, Math.max(boundedStart, end));
  const raw = text.slice(boundedStart, boundedEnd);
  const truncated = truncateUtf8(raw, SNIPPET_MAX_BYTES);
  const startLoc = offsetToLocation(text, boundedStart);
  const endLoc = offsetToLocation(text, boundedStart + truncated.text.length);

  return {
    text: truncated.text,
    startLine: startLoc.line,
    endLine: endLoc.line,
    truncated: truncated.truncated
  };
}

function isNode(value: unknown): value is { type: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    "type" in value &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function visitAst(
  node: unknown,
  visitor: (node: any, ancestors: any[]) => void,
  ancestors: any[] = []
): void {
  if (!isNode(node)) {
    return;
  }

  visitor(node, ancestors);

  for (const [key, value] of Object.entries(node)) {
    if (
      key === "loc" ||
      key === "start" ||
      key === "end" ||
      key === "errors" ||
      key === "comments" ||
      key === "tokens" ||
      key === "extra"
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const child of value) {
        visitAst(child, visitor, [...ancestors, node]);
      }
      continue;
    }

    visitAst(value, visitor, [...ancestors, node]);
  }
}

function propertyName(node: any): string | null {
  if (!node) {
    return null;
  }
  if (node.type === "Identifier" || node.type === "PrivateName") {
    return node.name;
  }
  if (
    node.type === "StringLiteral" ||
    node.type === "NumericLiteral" ||
    node.type === "BooleanLiteral"
  ) {
    return String(node.value);
  }
  return null;
}

function bindingNames(node: any): string[] {
  if (!node) {
    return [];
  }
  if (node.type === "Identifier") {
    return [node.name];
  }
  if (node.type === "RestElement" || node.type === "AssignmentPattern") {
    return bindingNames(node.argument ?? node.left);
  }
  if (node.type === "ObjectPattern") {
    return node.properties.flatMap((property: any) =>
      bindingNames(property.argument ?? property.value ?? property.key)
    );
  }
  if (node.type === "ArrayPattern") {
    return node.elements.flatMap(bindingNames);
  }
  return [];
}

function declarationName(node: any): string | null {
  if (!node) {
    return null;
  }

  if (
    (node.type === "FunctionDeclaration" ||
      node.type === "ClassDeclaration" ||
      node.type === "TSInterfaceDeclaration" ||
      node.type === "TSTypeAliasDeclaration") &&
    node.id?.name
  ) {
    return node.id.name;
  }

  if (node.type === "VariableDeclarator") {
    return bindingNames(node.id)[0] ?? null;
  }

  if (
    (node.type === "ObjectMethod" ||
      node.type === "ClassMethod" ||
      node.type === "ClassPrivateMethod") &&
    node.key
  ) {
    return propertyName(node.key);
  }

  return null;
}

function enclosingSymbol(ancestors: any[]): string | null {
  for (const ancestor of [...ancestors].reverse()) {
    const name = declarationName(ancestor);
    if (name) {
      return name;
    }
  }

  return null;
}

function calleeName(node: any): string | null {
  if (!node) {
    return null;
  }
  if (node.type === "Identifier") {
    return node.name;
  }
  if (node.type === "Import") {
    return "import";
  }
  if (node.type === "ThisExpression") {
    return "this";
  }
  if (node.type === "Super") {
    return "super";
  }
  if (
    node.type === "MemberExpression" ||
    node.type === "OptionalMemberExpression"
  ) {
    const objectName = calleeName(node.object);
    const propName = propertyName(node.property);
    return [objectName, propName].filter(Boolean).join(".") || null;
  }
  if (
    node.type === "CallExpression" ||
    node.type === "OptionalCallExpression"
  ) {
    return calleeName(node.callee);
  }
  return null;
}

function stringValue(node: any): string | null {
  if (!node) {
    return null;
  }
  if (node.type === "StringLiteral") {
    return node.value;
  }
  if (node.type === "TemplateElement") {
    return node.value?.cooked ?? node.value?.raw ?? null;
  }
  return null;
}

function isEndpointLike(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) ||
    /(^|\/)(api|graphql|trpc|rpc|rest)(\/|$|\?)/i.test(value) ||
    /\.(json|mjs|js|css|wasm)(\?|$)/i.test(value)
  );
}

function isLikelySvgPathData(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^[Mm]\s*-?\d/.test(trimmed) &&
    /[A-Za-z]/.test(trimmed.slice(1)) &&
    (trimmed.match(/-?\d*\.?\d+/g)?.length ?? 0) >= 6
  );
}

function isDecimalHeavyCoordinateString(value: string): boolean {
  const trimmed = value.trim();
  return (trimmed.match(/\d+\.\d+/g)?.length ?? 0) >= 4;
}

function isSelectorNoise(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length === 0 ||
    /^\.\d+(?:\.\d+)?$/.test(trimmed) ||
    isLikelySvgPathData(trimmed) ||
    isDecimalHeavyCoordinateString(trimmed)
  );
}

function hasObviousSelectorSyntax(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^[.#](?!\d)(?:-?[_a-z]|\\)[\w-]*/i.test(trimmed) ||
    /^\[[^\]]+\]$/.test(trimmed) ||
    /(^|[\s>+~])([.#](?!\d)(?:-?[_a-z]|\\)[\w-]*|\[[^\]]+\])/i.test(trimmed) ||
    /\b(data-testid|aria-label|role)=/i.test(trimmed)
  );
}

function isSelectorConsumerCallee(name: string): boolean {
  const selectorMethods = new Set([
    "querySelector",
    "querySelectorAll",
    "matches",
    "closest",
    "webkitMatchesSelector",
    "mozMatchesSelector",
    "msMatchesSelector"
  ]);
  const method = name.split(".").pop() ?? name;
  return selectorMethods.has(method);
}

function isCallFirstArgument(call: any, node: any, ancestors: any[]): boolean {
  const firstArgument = call.arguments?.[0];
  if (!firstArgument) {
    return false;
  }
  if (firstArgument === node) {
    return true;
  }

  const callIndex = ancestors.lastIndexOf(call);
  if (callIndex < 0) {
    return false;
  }
  return ancestors.slice(callIndex + 1).includes(firstArgument);
}

function isSelectorConsumerArgument(node: any, ancestors: any[]): boolean {
  for (const ancestor of [...ancestors].reverse()) {
    if (
      ancestor.type !== "CallExpression" &&
      ancestor.type !== "OptionalCallExpression"
    ) {
      continue;
    }

    const name = calleeName(ancestor.callee);
    if (
      name &&
      isSelectorConsumerCallee(name) &&
      isCallFirstArgument(ancestor, node, ancestors)
    ) {
      return true;
    }
  }
  return false;
}

function isSelectorLike(
  value: string,
  { selectorConsumer = false }: { selectorConsumer?: boolean } = {}
): boolean {
  if (value.length === 0 || value.length > 1_024) {
    return false;
  }
  if (
    !selectorConsumer &&
    !/[#.\[\]]/.test(value) &&
    !/\b(data-testid|aria-label|role)=/i.test(value)
  ) {
    return false;
  }

  const trimmed = value.trim();
  if (isSelectorNoise(trimmed)) {
    return false;
  }
  if (hasObviousSelectorSyntax(trimmed)) {
    return true;
  }
  return selectorConsumer && /^[a-z][a-z0-9-]*$/i.test(trimmed);
}

function isNotableCall(callee: string): boolean {
  return (
    callee === "fetch" ||
    callee === "import" ||
    callee === "postMessage" ||
    callee === "XMLHttpRequest" ||
    callee.endsWith(".postMessage") ||
    callee.startsWith("chrome.") ||
    callee.startsWith("browser.") ||
    callee.startsWith("localStorage.") ||
    callee.startsWith("sessionStorage.") ||
    callee.startsWith("indexedDB.") ||
    callee.startsWith("caches.") ||
    callee.startsWith("navigator.serviceWorker.")
  );
}

function firstStringArgument(node: any): string | null {
  for (const argument of node.arguments ?? []) {
    const value = stringValue(argument);
    if (value) {
      return value;
    }
  }
  return null;
}

function createFact(
  path: string,
  text: string,
  node: any,
  ancestors: any[],
  kind: JsSearchKind,
  value: string
): JsFact {
  const loc = locFromNode(node);
  return {
    path,
    origin: null,
    pathname: null,
    kind,
    value,
    nodeKind: node.type,
    nodeId: makeNodeId(node),
    loc,
    enclosingSymbol: enclosingSymbol(ancestors),
    snippet: sourceSnippet(text, node.start ?? 0, node.end ?? node.start ?? 0),
    start: node.start ?? 0,
    end: node.end ?? node.start ?? 0
  };
}

function mergeEntryIntoFacts(
  facts: JsFact[],
  entry: JsFixtureEntry | null
): JsFact[] {
  return facts.map((fact) => ({
    ...fact,
    origin: entry?.origin ?? null,
    pathname: entry?.pathname ?? null
  }));
}

function capSummary<T>(items: T[]): {
  items: T[];
  total: number;
  truncated: boolean;
} {
  return {
    items: items.slice(0, SUMMARY_LIMIT),
    total: items.length,
    truncated: items.length > SUMMARY_LIMIT
  };
}

function extractExportNames(node: any): string[] {
  if (!node) {
    return [];
  }
  if (node.type === "ExportDefaultDeclaration") {
    return ["default"];
  }
  if (node.specifiers?.length) {
    return node.specifiers
      .map((specifier: any) =>
        propertyName(specifier.exported ?? specifier.local)
      )
      .filter((name: string | null): name is string => Boolean(name));
  }
  if (node.declaration) {
    if (node.declaration.type === "VariableDeclaration") {
      return node.declaration.declarations.flatMap((declarator: any) =>
        bindingNames(declarator.id)
      );
    }
    const name = declarationName(node.declaration);
    return name ? [name] : [];
  }
  return [];
}

function extractTopLevelSymbols(program: any): InternalSymbol[] {
  const symbols: InternalSymbol[] = [];
  for (const statement of program.body ?? []) {
    const declaration = statement.declaration ?? statement;
    if (declaration.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations ?? []) {
        for (const name of bindingNames(declarator.id)) {
          symbols.push(
            withPublicValue({
              value: name,
              kind: "variable" as const,
              nodeKind: declarator.type,
              nodeId: makeNodeId(declarator),
              loc: locFromNode(declarator),
              enclosingSymbol: null,
              lineRange: lineRangeFromNode(declarator),
              start: declarator.start ?? declaration.start ?? 0,
              end: declarator.end ?? declaration.end ?? declarator.start ?? 0
            })
          );
        }
      }
      continue;
    }

    const name = declarationName(declaration);
    if (!name) {
      continue;
    }

    const kind =
      declaration.type === "ClassDeclaration"
        ? "class"
        : declaration.type === "TSInterfaceDeclaration"
          ? "interface"
          : declaration.type === "TSTypeAliasDeclaration"
            ? "type"
            : "function";
    symbols.push(
      withPublicValue({
        value: name,
        kind,
        nodeKind: declaration.type,
        nodeId: makeNodeId(declaration),
        loc: locFromNode(declaration),
        enclosingSymbol: null,
        lineRange: lineRangeFromNode(declaration),
        start: declaration.start ?? statement.start ?? 0,
        end: declaration.end ?? statement.end ?? declaration.start ?? 0
      })
    );
  }
  return symbols;
}

function parseJavaScript(text: string): {
  ast: any | null;
  errors: Array<{ message: string; loc: JsLocation | null }>;
  thrown: boolean;
} {
  try {
    const ast = parse(text, {
      sourceType: "unambiguous",
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      ranges: true,
      plugins: [
        "jsx",
        "typescript",
        "classProperties",
        "dynamicImport",
        "importAttributes",
        "importMeta",
        "topLevelAwait",
        "decorators-legacy"
      ]
    });
    const errors = (ast.errors ?? []).map((error: any) => ({
      message: error.message,
      loc: error.loc
        ? {
            line: error.loc.line,
            column: error.loc.column + 1
          }
        : null
    }));
    return { ast, errors, thrown: false };
  } catch (error) {
    return {
      ast: null,
      errors: [
        {
          message: error instanceof Error ? error.message : String(error),
          loc: null
        }
      ],
      thrown: true
    };
  }
}

function detectSourceMap(
  text: string,
  startLine = 1
): JsSourceMapReference | null {
  const lines = text.split(/\r\n|\n|\r/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    const match = /[#@]\s*sourceMappingURL=([^\s*]+)/.exec(line);
    if (!match) {
      continue;
    }

    const url = match[1];
    return {
      url,
      kind: url.startsWith("data:") ? "inline" : "external",
      line: startLine + index
    };
  }

  return null;
}

async function lineAtByteOffset(
  resolved: string,
  byteOffset: number
): Promise<number> {
  if (byteOffset <= 0) {
    return 1;
  }

  const stream = createReadStream(resolved, {
    start: 0,
    end: byteOffset - 1,
    highWaterMark: TEXT_SCAN_CHUNK_BYTES
  });
  let line = 1;
  let previousWasCr = false;

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    for (const byte of buffer) {
      if (byte === 13) {
        line += 1;
        previousWasCr = true;
        continue;
      }
      if (byte === 10) {
        if (previousWasCr) {
          previousWasCr = false;
          continue;
        }
        line += 1;
        continue;
      }
      previousWasCr = false;
    }
  }

  return line;
}

function trimLeadingUtf8ContinuationBytes(buffer: Buffer): Buffer {
  let start = 0;
  while (
    start < buffer.length &&
    (buffer[start] & 0b1100_0000) === 0b1000_0000
  ) {
    start += 1;
  }
  return buffer.subarray(start);
}

async function readUtf8Tail(
  resolved: string,
  relativePath: string,
  size: number,
  maxBytes: number
): Promise<{ text: string; startByte: number; startLine: number }> {
  const startByte = Math.max(0, size - maxBytes - 4);
  const length = size - startByte;
  const buffer = Buffer.alloc(length);
  const handle = await fs.open(resolved, "r");
  try {
    await handle.read(buffer, 0, length, startByte);
  } finally {
    await handle.close();
  }

  if (buffer.includes(0)) {
    throw new Error(
      `Fixture is not a UTF-8 text JavaScript file: ${relativePath}`
    );
  }

  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(
        trimLeadingUtf8ContinuationBytes(buffer)
      ),
      startByte,
      startLine: await lineAtByteOffset(resolved, startByte)
    };
  } catch {
    throw new Error(
      `Fixture is not a UTF-8 text JavaScript file: ${relativePath}`
    );
  }
}

async function listJsFixtureEntries(
  rootPath: string
): Promise<JsFixtureEntry[]> {
  const entries = new Map<string, JsFixtureEntry>();
  const configs = await readSiteConfigs(rootPath);

  for (const config of configs) {
    const info = await readOriginInfo(rootPath, config);
    for (const asset of flattenStaticResourceManifest(info.manifest)) {
      if (!isJavaScriptLikeAsset(asset)) {
        continue;
      }

      const displayPath = normalizeRelativePath(getFixtureDisplayPath(asset));
      if (!entries.has(displayPath)) {
        entries.set(displayPath, {
          path: displayPath,
          origin: info.origin,
          pathname: asset.pathname ?? null,
          mimeType: asset.mimeType || null,
          resourceType: asset.resourceType || null,
          canonicalPath: asset.bodyPath ?? null
        });
      }
    }
  }

  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function resolveJsFixtureEntry(
  rootPath: string,
  relativePath: string
): Promise<JsFixtureEntry | null> {
  const normalized = normalizeRelativePath(relativePath);
  const configs = await readSiteConfigs(rootPath);

  for (const config of configs) {
    const info = await readOriginInfo(rootPath, config);
    for (const asset of flattenStaticResourceManifest(info.manifest)) {
      if (!isJavaScriptLikeAsset(asset)) {
        continue;
      }

      const displayPath = normalizeRelativePath(getFixtureDisplayPath(asset));
      const acceptedPaths = [displayPath, asset.projectionPath, asset.bodyPath]
        .filter((candidate): candidate is string => Boolean(candidate))
        .map(normalizeRelativePath);
      if (!acceptedPaths.includes(normalized)) {
        continue;
      }

      return {
        path: displayPath,
        origin: info.origin,
        pathname: asset.pathname ?? null,
        mimeType: asset.mimeType || null,
        resourceType: asset.resourceType || null,
        canonicalPath: asset.bodyPath ?? null
      };
    }
  }

  return isJavaScriptLikePath(relativePath)
    ? {
        path: normalized,
        origin: null,
        pathname: null,
        mimeType: null,
        resourceType: null,
        canonicalPath: null
      }
    : null;
}

async function resolveJsFixtureForAnalysis(
  rootPath: string,
  relativePath: string
): Promise<{
  resolved: string;
  size: number;
  mtimeMs: number;
  entry: JsFixtureEntry | null;
}> {
  const rootFs = createFixtureRootFs(rootPath);
  const resolved = rootFs.resolve(relativePath);
  if (!resolved) {
    throw new Error(
      `Invalid fixture path: ${relativePath}. Paths must stay within the fixture root.`
    );
  }

  const stat = await rootFs.stat(relativePath);
  if (!stat?.isFile()) {
    throw new Error(`File not found: ${relativePath}`);
  }

  const entry = await resolveJsFixtureEntry(rootPath, relativePath);
  if (!entry) {
    throw new Error(
      `Fixture is not a JavaScript-like captured file: ${relativePath}`
    );
  }

  return {
    resolved,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    entry
  };
}

async function readResolvedJsFixtureText(
  resolved: string,
  relativePath: string
): Promise<string> {
  const buffer = await fs.readFile(resolved);
  if (buffer.includes(0)) {
    throw new Error(
      `Fixture is not a UTF-8 text JavaScript file: ${relativePath}`
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(
      `Fixture is not a UTF-8 text JavaScript file: ${relativePath}`
    );
  }
}

function deleteCachedAnalysis(cacheKey: string): void {
  const cached = analysisCache.get(cacheKey);
  if (!cached) {
    return;
  }

  analysisCacheBytes = Math.max(0, analysisCacheBytes - cached.size);
  analysisCache.delete(cacheKey);
}

function getCachedAnalysis(
  cacheKey: string,
  size: number,
  mtimeMs: number
): InternalAnalysis | null {
  const cached = analysisCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.size !== size || cached.mtimeMs !== mtimeMs) {
    deleteCachedAnalysis(cacheKey);
    return null;
  }

  analysisCache.delete(cacheKey);
  analysisCache.set(cacheKey, cached);
  return cached.analysis;
}

function setCachedAnalysis(cacheKey: string, entry: AnalysisCacheEntry): void {
  deleteCachedAnalysis(cacheKey);
  analysisCache.set(cacheKey, entry);
  analysisCacheBytes += entry.size;

  while (
    analysisCache.size > MAX_ANALYSIS_CACHE_ENTRIES ||
    analysisCacheBytes > MAX_ANALYSIS_CACHE_BYTES
  ) {
    const oldestKey = analysisCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    deleteCachedAnalysis(oldestKey);
  }
}

function groupByNodeId<T extends { nodeId: string }>(
  items: T[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    grouped.set(item.nodeId, [...(grouped.get(item.nodeId) ?? []), item]);
  }
  return grouped;
}

function buildAnalysisIndexes(
  facts: JsFact[],
  symbols: InternalSymbol[]
): AnalysisIndexes {
  const factsByKind = new Map<JsSearchKind, JsFact[]>();
  const factsByEnclosingSymbol = new Map<string, JsFact[]>();
  const callFactsByValue = new Map<string, JsFact[]>();
  const symbolsByName = new Map<string, InternalSymbol>();

  for (const fact of facts) {
    factsByKind.set(fact.kind, [...(factsByKind.get(fact.kind) ?? []), fact]);

    const symbolKey = fact.enclosingSymbol ?? "";
    factsByEnclosingSymbol.set(symbolKey, [
      ...(factsByEnclosingSymbol.get(symbolKey) ?? []),
      fact
    ]);

    if (fact.kind === "call") {
      callFactsByValue.set(fact.value, [
        ...(callFactsByValue.get(fact.value) ?? []),
        fact
      ]);
    }
  }

  for (const symbol of symbols) {
    if (!symbolsByName.has(symbol.value)) {
      symbolsByName.set(symbol.value, symbol);
    }
  }

  return {
    factsByNodeId: groupByNodeId(facts),
    symbolsByNodeId: groupByNodeId(symbols),
    factsByKind,
    factsByEnclosingSymbol,
    callFactsByValue,
    symbolsByName
  };
}

function analyzeParsedProgram(
  relativePath: string,
  text: string,
  ast: any,
  parseErrors: Array<{ message: string; loc: JsLocation | null }>,
  thrown: boolean,
  sourceMap: JsSourceMapReference | null,
  size: number,
  entry: JsFixtureEntry | null
): InternalAnalysis {
  const program = ast?.program ?? ast;
  const facts: JsFact[] = [];
  const imports: JsImportSummary[] = [];
  const exports: JsExportSummary[] = [];
  const notableCalls: JsCallSummary[] = [];

  const topLevelSymbols = ast ? extractTopLevelSymbols(program) : [];

  if (ast) {
    for (const statement of program.body ?? []) {
      if (statement.type === "ImportDeclaration") {
        imports.push({
          source: statement.source?.value ?? "",
          specifiers: (statement.specifiers ?? [])
            .map((specifier: any) => propertyName(specifier.local))
            .filter((name: string | null): name is string => Boolean(name)),
          loc: locFromNode(statement)
        });
      }

      if (statement.type?.startsWith("Export")) {
        for (const name of extractExportNames(statement)) {
          const exportEntry: JsExportSummary = withPublicValue({
            value: name,
            nodeKind: statement.type,
            nodeId: makeNodeId(statement),
            loc: locFromNode(statement),
            enclosingSymbol: null,
            source: statement.source?.value ?? null
          });
          exports.push(exportEntry);
          facts.push({
            ...createFact(relativePath, text, statement, [], "export", name),
            value: name
          });
        }
      }
    }

    visitAst(ast, (node, ancestors) => {
      if (node.type === "Identifier") {
        facts.push(
          createFact(
            relativePath,
            text,
            node,
            ancestors,
            "identifier",
            node.name
          )
        );
      }

      const literal = stringValue(node);
      if (literal) {
        facts.push(
          createFact(relativePath, text, node, ancestors, "string", literal)
        );
        if (isEndpointLike(literal)) {
          facts.push(
            createFact(relativePath, text, node, ancestors, "endpoint", literal)
          );
        }
        if (
          isSelectorLike(literal, {
            selectorConsumer: isSelectorConsumerArgument(node, ancestors)
          })
        ) {
          facts.push(
            createFact(relativePath, text, node, ancestors, "selector", literal)
          );
        }
      }

      if (
        node.type === "MemberExpression" ||
        node.type === "OptionalMemberExpression"
      ) {
        const name = propertyName(node.property);
        if (name) {
          facts.push(
            createFact(
              relativePath,
              text,
              node.property,
              ancestors,
              "property",
              name
            )
          );
        }
      }

      if (
        node.type === "CallExpression" ||
        node.type === "OptionalCallExpression" ||
        node.type === "NewExpression"
      ) {
        const name = calleeName(node.callee);
        if (name) {
          const fact = createFact(
            relativePath,
            text,
            node,
            ancestors,
            "call",
            name
          );
          facts.push(fact);
          if (isNotableCall(name)) {
            notableCalls.push(
              withPublicValue({
                value: name,
                nodeKind: node.type,
                nodeId: fact.nodeId,
                loc: fact.loc,
                enclosingSymbol: fact.enclosingSymbol,
                firstArgument: publicNullableValueText(
                  firstStringArgument(node)
                )
              })
            );
          }
        }
      }
    });
  }

  const mergedFacts = mergeEntryIntoFacts(facts, entry);
  const endpointStrings = capSummary(
    mergedFacts
      .filter((fact) => fact.kind === "endpoint")
      .map(({ value, nodeKind, nodeId, loc, enclosingSymbol }) => ({
        value,
        nodeKind,
        nodeId,
        loc,
        enclosingSymbol
      }))
      .map(withPublicValue)
  );
  const selectorStrings = capSummary(
    mergedFacts
      .filter((fact) => fact.kind === "selector")
      .map(({ value, nodeKind, nodeId, loc, enclosingSymbol }) => ({
        value,
        nodeKind,
        nodeId,
        loc,
        enclosingSymbol
      }))
      .map(withPublicValue)
  );
  const cappedImports = capSummary(imports);
  const cappedExports = capSummary(exports);
  const cappedSymbols = capSummary(topLevelSymbols);
  const cappedCalls = capSummary(notableCalls);

  return {
    publicAnalysis: {
      path: relativePath,
      size,
      analysisMode: "ast",
      sourceMap,
      parse: {
        ok: !thrown && parseErrors.length === 0,
        recovered: !thrown && parseErrors.length > 0,
        errors: parseErrors
      },
      summary: {
        imports: cappedImports.items,
        exports: cappedExports.items,
        topLevelSymbols: cappedSymbols.items,
        endpointStrings: endpointStrings.items,
        selectorStrings: selectorStrings.items,
        notableCalls: cappedCalls.items,
        counts: {
          imports: cappedImports.total,
          exports: cappedExports.total,
          topLevelSymbols: cappedSymbols.total,
          endpointStrings: endpointStrings.total,
          selectorStrings: selectorStrings.total,
          notableCalls: cappedCalls.total,
          searchableFacts: mergedFacts.length
        },
        truncated: {
          imports: cappedImports.truncated,
          exports: cappedExports.truncated,
          topLevelSymbols: cappedSymbols.truncated,
          endpointStrings: endpointStrings.truncated,
          selectorStrings: selectorStrings.truncated,
          notableCalls: cappedCalls.truncated
        }
      }
    },
    facts: mergedFacts,
    symbols: topLevelSymbols,
    indexes: buildAnalysisIndexes(mergedFacts, topLevelSymbols),
    text,
    ast
  };
}

const TEXT_SCAN_SUPPORTED_KINDS = new Set<JsSearchKind>([
  "string",
  "endpoint",
  "selector",
  "call"
]);

const TEXT_SCAN_STRING_REGEX = /(["'`])((?:\\[\s\S]|(?!\1)[^\\]){0,500})\1/g;
const TEXT_SCAN_CALL_REGEX =
  /\b(?:fetch|XMLHttpRequest|postMessage|window\.postMessage|chrome(?:\.[A-Za-z_$][\w$]*)+|browser(?:\.[A-Za-z_$][\w$]*)+|localStorage(?:\.[A-Za-z_$][\w$]*)*|sessionStorage(?:\.[A-Za-z_$][\w$]*)*|indexedDB(?:\.[A-Za-z_$][\w$]*)*|caches(?:\.[A-Za-z_$][\w$]*)*|navigator\.serviceWorker(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;

function unescapeScannedString(value: string): string {
  return value.replace(/\\(["'`\\])/g, "$1");
}

function extractFirstStringArgumentFromText(value: string): string | null {
  const match = /^\s*\(\s*(["'`])((?:\\[\s\S]|(?!\1)[^\\]){0,500})\1/.exec(
    value
  );
  return match ? unescapeScannedString(match[2] ?? "") : null;
}

function textScanSnippet(
  value: string,
  combined: string,
  index: number
): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(combined.length, index + value.length + 60);
  const excerpt = combined.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "..." : ""}${excerpt}${
    end < combined.length ? "..." : ""
  }`;
}

async function analyzeTextScannedProgram(
  resolved: string,
  relativePath: string,
  size: number,
  entry: JsFixtureEntry | null
): Promise<InternalAnalysis> {
  const sourceTail = await readUtf8Tail(
    resolved,
    relativePath,
    size,
    64 * 1024
  );
  const sourceMap = detectSourceMap(sourceTail.text, sourceTail.startLine);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const stream = createReadStream(resolved, {
    highWaterMark: TEXT_SCAN_CHUNK_BYTES
  });
  const facts: JsFact[] = [];
  const notableCalls: JsCallSummary[] = [];
  const factCounts = new Map<JsSearchKind, number>();
  const truncatedKinds = new Set<JsSearchKind>();

  let carry = "";
  let carryStartByte = 0;
  let carryStartLoc: JsLocation = { line: 1, column: 1 };

  const recordFact = ({
    kind,
    value,
    nodeKind,
    startByte,
    endByte,
    loc,
    snippet
  }: {
    kind: JsSearchKind;
    value: string;
    nodeKind: string;
    startByte: number;
    endByte: number;
    loc: JsLocation;
    snippet: string;
  }): JsFact | null => {
    const nextCount = (factCounts.get(kind) ?? 0) + 1;
    factCounts.set(kind, nextCount);
    if (nextCount > TEXT_SCAN_FACT_LIMIT_PER_KIND) {
      truncatedKinds.add(kind);
      return null;
    }

    const fact: JsFact = {
      path: relativePath,
      origin: entry?.origin ?? null,
      pathname: entry?.pathname ?? null,
      kind,
      value,
      nodeKind,
      nodeId: makeTextScanNodeId(startByte, endByte, nodeKind),
      loc,
      enclosingSymbol: null,
      snippet,
      start: startByte,
      end: endByte
    };
    facts.push(fact);
    return fact;
  };

  const processCombined = (combined: string, processUntil: number): void => {
    const makeCursor = () => ({
      index: 0,
      byteOffset: 0,
      loc: carryStartLoc
    });
    const locateMatch = (
      cursor: ReturnType<typeof makeCursor>,
      index: number
    ): { startByte: number; loc: JsLocation } => {
      const skipped = combined.slice(cursor.index, index);
      cursor.byteOffset += Buffer.byteLength(skipped);
      cursor.loc = advanceLocationByText(cursor.loc, skipped);
      cursor.index = index;

      return {
        startByte: carryStartByte + cursor.byteOffset,
        loc: { ...cursor.loc }
      };
    };

    const stringCursor = makeCursor();
    TEXT_SCAN_STRING_REGEX.lastIndex = 0;
    for (const match of combined.matchAll(TEXT_SCAN_STRING_REGEX)) {
      if (match.index === undefined) {
        continue;
      }
      if (match.index >= processUntil) {
        break;
      }

      const rawValue = match[2] ?? "";
      const value = unescapeScannedString(rawValue);
      const endpointLike = isEndpointLike(value);
      const selectorLike = isSelectorLike(value);
      const shouldRecordString =
        (factCounts.get("string") ?? 0) < TEXT_SCAN_FACT_LIMIT_PER_KIND;
      if (!shouldRecordString && !endpointLike && !selectorLike) {
        continue;
      }

      const matchedText = match[0] ?? "";
      const { startByte, loc } = locateMatch(stringCursor, match.index);
      const endByte = startByte + Buffer.byteLength(matchedText);
      const snippet = textScanSnippet(
        matchedText || value,
        combined,
        match.index
      );

      if (shouldRecordString) {
        recordFact({
          kind: "string",
          value,
          nodeKind: "StringLiteral",
          startByte,
          endByte,
          loc,
          snippet
        });
      }

      if (endpointLike) {
        recordFact({
          kind: "endpoint",
          value,
          nodeKind: "StringLiteral",
          startByte,
          endByte,
          loc,
          snippet
        });
      }

      if (selectorLike) {
        recordFact({
          kind: "selector",
          value,
          nodeKind: "StringLiteral",
          startByte,
          endByte,
          loc,
          snippet
        });
      }
    }

    const callCursor = makeCursor();
    TEXT_SCAN_CALL_REGEX.lastIndex = 0;
    for (const match of combined.matchAll(TEXT_SCAN_CALL_REGEX)) {
      if (match.index === undefined) {
        continue;
      }
      if (match.index >= processUntil) {
        break;
      }

      const callWithParen = match[0] ?? "";
      const value = callWithParen.replace(/\s*\($/, "");
      if (!isNotableCall(value)) {
        continue;
      }

      const { startByte, loc } = locateMatch(callCursor, match.index);
      const endByte = startByte + Buffer.byteLength(value);
      const snippet = textScanSnippet(value, combined, match.index);
      const fact = recordFact({
        kind: "call",
        value,
        nodeKind: "CallExpression",
        startByte,
        endByte,
        loc,
        snippet
      });

      if (fact) {
        notableCalls.push(
          withPublicValue({
            value,
            nodeKind: "CallExpression",
            nodeId: fact.nodeId,
            loc,
            enclosingSymbol: null,
            firstArgument: publicNullableValueText(
              extractFirstStringArgumentFromText(
                combined.slice(match.index + value.length)
              )
            )
          })
        );
      }
    }
  };

  const consumeText = (text: string, final = false): void => {
    const combined = `${carry}${text}`;
    const processUntil = final
      ? combined.length
      : Math.max(0, combined.length - TEXT_SCAN_CARRY_CHARS);
    processCombined(combined, processUntil);

    carryStartByte += Buffer.byteLength(combined.slice(0, processUntil));
    carryStartLoc = advanceLocationByText(
      carryStartLoc,
      combined.slice(0, processUntil)
    );
    carry = combined.slice(processUntil);
  };

  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buffer.includes(0)) {
        throw new Error(
          `Fixture is not a UTF-8 text JavaScript file: ${relativePath}`
        );
      }
      consumeText(decoder.decode(buffer, { stream: true }));
    }
    consumeText(decoder.decode(), true);
  } catch (error) {
    stream.destroy();
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(
      `Fixture is not a UTF-8 text JavaScript file: ${relativePath}`
    );
  }

  const endpointStrings = capSummary(
    facts
      .filter((fact) => fact.kind === "endpoint")
      .map(({ value, nodeKind, nodeId, loc, enclosingSymbol }) => ({
        value,
        nodeKind,
        nodeId,
        loc,
        enclosingSymbol
      }))
      .map(withPublicValue)
  );
  const selectorStrings = capSummary(
    facts
      .filter((fact) => fact.kind === "selector")
      .map(({ value, nodeKind, nodeId, loc, enclosingSymbol }) => ({
        value,
        nodeKind,
        nodeId,
        loc,
        enclosingSymbol
      }))
      .map(withPublicValue)
  );
  const cappedCalls = capSummary(notableCalls);

  return {
    publicAnalysis: {
      path: relativePath,
      size,
      analysisMode: "text-scan",
      sourceMap,
      parse: {
        ok: false,
        recovered: false,
        skipped: true,
        reason: "file-too-large",
        errors: []
      },
      summary: {
        imports: [],
        exports: [],
        topLevelSymbols: [],
        endpointStrings: endpointStrings.items,
        selectorStrings: selectorStrings.items,
        notableCalls: cappedCalls.items,
        counts: {
          imports: 0,
          exports: 0,
          topLevelSymbols: 0,
          endpointStrings: factCounts.get("endpoint") ?? 0,
          selectorStrings: factCounts.get("selector") ?? 0,
          notableCalls: factCounts.get("call") ?? 0,
          searchableFacts: facts.length
        },
        truncated: {
          imports: false,
          exports: false,
          topLevelSymbols: false,
          endpointStrings:
            endpointStrings.truncated || truncatedKinds.has("endpoint"),
          selectorStrings:
            selectorStrings.truncated || truncatedKinds.has("selector"),
          notableCalls: cappedCalls.truncated || truncatedKinds.has("call")
        }
      }
    },
    facts,
    symbols: [],
    indexes: buildAnalysisIndexes(facts, []),
    text: null,
    ast: null
  };
}

export async function analyzeJsFile(
  rootPath: string,
  relativePath: string
): Promise<JsFileAnalysis> {
  return (await getInternalAnalysis(rootPath, relativePath)).publicAnalysis;
}

async function getInternalAnalysis(
  rootPath: string,
  relativePath: string
): Promise<InternalAnalysis> {
  const { resolved, size, mtimeMs, entry } = await resolveJsFixtureForAnalysis(
    rootPath,
    relativePath
  );
  const cacheKey = `${rootPath}\0${normalizeRelativePath(relativePath)}`;
  const cached = getCachedAnalysis(cacheKey, size, mtimeMs);
  if (cached) {
    return cached;
  }

  if (size > MAX_ANALYSIS_BYTES) {
    const analysis = await analyzeTextScannedProgram(
      resolved,
      normalizeRelativePath(relativePath),
      size,
      entry
    );
    setCachedAnalysis(cacheKey, { mtimeMs, size, analysis });
    return analysis;
  }

  const text = await readResolvedJsFixtureText(resolved, relativePath);
  const sourceMap = detectSourceMap(text);
  const parsed = parseJavaScript(text);
  const analysis = analyzeParsedProgram(
    normalizeRelativePath(relativePath),
    text,
    parsed.ast,
    parsed.errors,
    parsed.thrown,
    sourceMap,
    size,
    entry
  );
  setCachedAnalysis(cacheKey, { mtimeMs, size, analysis });
  return analysis;
}

async function getSeedSuggestionAnalysis(
  rootPath: string,
  entry: JsFixtureEntry
): Promise<InternalAnalysis> {
  const {
    resolved,
    size,
    mtimeMs,
    entry: resolvedEntry
  } = await resolveJsFixtureForAnalysis(rootPath, entry.path);
  const cacheKey = `${rootPath}\0${normalizeRelativePath(entry.path)}`;
  const cached = getCachedAnalysis(cacheKey, size, mtimeMs);
  if (cached) {
    return cached;
  }

  if (size > MAX_SEED_AST_ANALYSIS_BYTES) {
    return analyzeTextScannedProgram(
      resolved,
      normalizeRelativePath(entry.path),
      size,
      resolvedEntry ?? entry
    );
  }

  return getInternalAnalysis(rootPath, entry.path);
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }

  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return Math.max(0, Number(value.offset) || 0);
  } catch {
    throw new Error("Invalid search-js cursor.");
  }
}

function normalizeLimit(limit?: number): number {
  return Math.min(
    MAX_SEARCH_LIMIT,
    Math.max(1, Math.trunc(limit ?? DEFAULT_SEARCH_LIMIT))
  );
}

function publicSearchMatch(fact: JsFact): JsSearchMatch {
  return withPublicValue({
    path: fact.path,
    origin: fact.origin,
    pathname: fact.pathname,
    kind: fact.kind,
    value: fact.value,
    nodeKind: fact.nodeKind,
    nodeId: fact.nodeId,
    loc: fact.loc,
    enclosingSymbol: fact.enclosingSymbol,
    snippet: fact.snippet
  });
}

export async function searchJs(
  rootPath: string,
  options: JsSearchOptions
): Promise<JsSearchResult> {
  const query = options.query.trim().toLowerCase();
  if (!query) {
    return {
      items: [],
      nextCursor: null,
      totalMatched: 0,
      matchedOrigins: [],
      skipped: []
    };
  }

  const normalizedPathContains = options.pathContains?.toLowerCase();
  const entries = (await listJsFixtureEntries(rootPath)).filter((entry) => {
    if (options.origin && entry.origin !== options.origin) {
      return false;
    }
    if (
      normalizedPathContains &&
      !entry.path.toLowerCase().includes(normalizedPathContains)
    ) {
      return false;
    }
    return true;
  });

  const matches: JsSearchMatch[] = [];
  const skipped: JsSearchResult["skipped"] = [];

  for (const entry of entries) {
    try {
      const analysis = await getInternalAnalysis(rootPath, entry.path);
      if (
        analysis.publicAnalysis.analysisMode === "text-scan" &&
        options.kind &&
        !TEXT_SCAN_SUPPORTED_KINDS.has(options.kind)
      ) {
        skipped.push({
          path: entry.path,
          reason: `Text-scan mode does not support ${options.kind} facts for oversized JavaScript fixtures.`
        });
        continue;
      }

      const facts = options.kind
        ? (analysis.indexes.factsByKind.get(options.kind) ?? [])
        : analysis.facts;
      for (const fact of facts) {
        if (!fact.value.toLowerCase().includes(query)) {
          continue;
        }
        matches.push(publicSearchMatch(fact));
      }
    } catch (error) {
      skipped.push({
        path: entry.path,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const offset = decodeCursor(options.cursor);
  const limit = normalizeLimit(options.limit);
  const items = matches.slice(offset, offset + limit);
  const nextOffset = offset + items.length;

  return {
    items,
    nextCursor: nextOffset < matches.length ? encodeCursor(nextOffset) : null,
    totalMatched: matches.length,
    matchedOrigins: [
      ...new Set(
        matches.map((match) => match.origin).filter(Boolean) as string[]
      )
    ].sort(),
    skipped
  };
}

const DEFAULT_SEED_KINDS: JsSeedKind[] = [
  "endpoint",
  "selector",
  "call",
  "string"
];

function normalizeSeedKinds(kinds?: JsSeedKind[]): JsSeedKind[] {
  const requested = kinds?.length ? kinds : DEFAULT_SEED_KINDS;
  return [
    ...new Set(
      requested.filter((kind): kind is JsSeedKind =>
        DEFAULT_SEED_KINDS.includes(kind as JsSeedKind)
      )
    )
  ];
}

function seedKindBaseScore(kind: JsSeedKind): number {
  switch (kind) {
    case "endpoint":
      return 400;
    case "selector":
      return 350;
    case "call":
      return 300;
    case "string":
      return 100;
  }
}

function scoreSeedFact(
  fact: JsFact,
  analysisMode: "ast" | "text-scan",
  apiLink?: JsApiResponseLink
): { score: number; reasons: string[] } {
  const reasons: string[] = [fact.kind];
  let score = seedKindBaseScore(fact.kind as JsSeedKind);

  if (analysisMode === "ast") {
    score += 20;
    reasons.push("ast");
  } else {
    reasons.push("text-scan");
  }

  if (fact.kind === "endpoint") {
    if (/^https?:\/\//i.test(fact.value)) {
      score += 25;
      reasons.push("absolute-url");
    }
    if (/\/(api|graphql|trpc|rpc|rest)(\/|$|\?)/i.test(fact.value)) {
      score += 40;
      reasons.push("api-like");
    }
    if (apiLink?.matchStatus === "matched") {
      score += 35;
      reasons.push("captured-api-response");
    } else if (apiLink?.matchStatus === "no-match") {
      reasons.push("no-captured-api-response");
    }
  }

  if (fact.kind === "selector") {
    if (/\b(data-testid|aria-label|role)=/i.test(fact.value)) {
      score += 40;
      reasons.push("test-or-accessibility-selector");
    }
    if (/^[#.[]/.test(fact.value.trim())) {
      score += 20;
      reasons.push("direct-selector");
    }
  }

  if (fact.kind === "call") {
    if (isFetchCall(fact)) {
      score += 50;
      reasons.push("fetch-call");
    } else if (isAddEventListenerCall(fact)) {
      score += 45;
      reasons.push("event-listener");
    } else if (isNotableCall(fact.value)) {
      score += 35;
      reasons.push("browser-api-call");
    }
  }

  if (fact.enclosingSymbol) {
    score += 15;
    reasons.push("enclosing-symbol");
  }

  const valueBytes = Buffer.byteLength(fact.value, "utf8");
  if (valueBytes > MAX_PUBLIC_JS_VALUE_BYTES) {
    score -= 30;
    reasons.push("large-value");
  } else if (valueBytes <= 120) {
    score += 10;
    reasons.push("compact-value");
  }

  if (fact.kind === "string") {
    if (isEndpointLike(fact.value) || isSelectorLike(fact.value)) {
      score += 50;
      reasons.push("semantic-string");
    }
    if (/^(true|false|null|undefined|ok|error|id|name)$/i.test(fact.value)) {
      score -= 40;
      reasons.push("generic-string");
    }
  }

  return { score, reasons };
}

function publicSeedSuggestion(
  fact: JsFact,
  analysisMode: "ast" | "text-scan",
  apiLink?: JsApiResponseLink
): JsSeedSuggestion {
  const scored = scoreSeedFact(fact, analysisMode, apiLink);
  return withPublicValue({
    path: fact.path,
    origin: fact.origin,
    pathname: fact.pathname,
    kind: fact.kind as JsSeedKind,
    value: fact.value,
    nodeKind: fact.nodeKind,
    nodeId: fact.nodeId,
    loc: fact.loc,
    enclosingSymbol: fact.enclosingSymbol,
    snippet: fact.snippet,
    analysisMode,
    apiResponseLink: apiLink ? publicApiResponseLink(apiLink) : undefined,
    score: scored.score,
    reasons: scored.reasons
  });
}

export async function suggestJsSeeds(
  rootPath: string,
  options: JsSeedSuggestionOptions = {}
): Promise<JsSeedSuggestionResult> {
  const kinds = normalizeSeedKinds(options.kinds);
  const normalizedPathContains = options.pathContains?.toLowerCase();
  const entries = (await listJsFixtureEntries(rootPath)).filter((entry) => {
    if (options.origin && entry.origin !== options.origin) {
      return false;
    }
    if (
      normalizedPathContains &&
      !entry.path.toLowerCase().includes(normalizedPathContains)
    ) {
      return false;
    }
    return true;
  });

  const suggestions: JsSeedSuggestion[] = [];
  const skipped: JsSeedSuggestionResult["skipped"] = [];
  const seen = new Set<string>();
  const apiEndpoints = await listApiEndpointsForTrace(rootPath, options.origin);

  for (const entry of entries) {
    try {
      const analysis = await getSeedSuggestionAnalysis(rootPath, entry);
      for (const kind of kinds) {
        const facts = analysis.indexes.factsByKind.get(kind) ?? [];
        for (const fact of facts) {
          const key = [fact.path, fact.kind, fact.nodeId, fact.value].join(
            "\0"
          );
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          suggestions.push(
            publicSeedSuggestion(
              fact,
              analysis.publicAnalysis.analysisMode,
              apiResponseLinkForFact(fact, apiEndpoints)
            )
          );
        }
      }
    } catch (error) {
      skipped.push({
        path: entry.path,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  suggestions.sort(
    (left, right) =>
      right.score - left.score ||
      left.kind.localeCompare(right.kind) ||
      left.path.localeCompare(right.path) ||
      left.value.localeCompare(right.value)
  );

  const offset = decodeCursor(options.cursor);
  const limit = normalizeLimit(options.limit);
  const items = suggestions.slice(offset, offset + limit);
  const nextOffset = offset + items.length;

  return {
    items,
    nextCursor:
      nextOffset < suggestions.length ? encodeCursor(nextOffset) : null,
    totalMatched: suggestions.length,
    matchedOrigins: [
      ...new Set(
        suggestions
          .map((suggestion) => suggestion.origin)
          .filter(Boolean) as string[]
      )
    ].sort(),
    skipped
  };
}

function normalizePipelineLimit(limit?: number): number {
  return Math.min(
    MAX_PIPELINE_LIMIT,
    Math.max(1, Math.trunc(limit ?? DEFAULT_PIPELINE_LIMIT))
  );
}

function confidenceRank(confidence: JsPipelineConfidence): number {
  switch (confidence) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function includesCaseInsensitive(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.toLowerCase());
}

function factEvidence(fact: JsFact): JsPipelineEvidence {
  return {
    kind: "fact",
    path: fact.path,
    value: fact.value,
    nodeId: fact.nodeId,
    loc: fact.loc,
    snippet: fact.snippet
  };
}

function symbolEvidence(
  symbol: InternalSymbol,
  relativePath: string,
  text: string | null
): JsPipelineEvidence {
  return {
    kind: "symbol",
    path: relativePath,
    value: symbol.value,
    nodeId: symbol.nodeId,
    loc: symbol.loc,
    lineRange: symbol.lineRange,
    snippet:
      symbol.loc && text ? shorten(lineText(text, symbol.loc.line)) : undefined
  };
}

function apiEvidence(endpoint: ApiEndpoint): JsPipelineEvidence {
  return {
    kind: "api-response",
    fixtureDir: endpoint.fixtureDir,
    bodyPath: endpoint.bodyPath,
    method: endpoint.method,
    status: endpoint.status,
    pathname: endpoint.pathname
  };
}

function withOptionalPublicValue<T extends { value?: string }>(entry: T): T {
  if (typeof entry.value !== "string") {
    return entry;
  }
  return {
    ...entry,
    ...publicValueMetadata(entry.value)
  };
}

function publicPipelineStep(step: JsPipelineStep): JsPipelineStep {
  const next = withOptionalPublicValue(step);
  const publicLabel =
    typeof step.value === "string" && step.label === step.value
      ? publicValueText(step.label)
      : shorten(step.label, 240);
  return {
    ...next,
    label: publicLabel,
    pathname: publicOptionalValueText(next.pathname)
  };
}

function publicPipelineEvidence(
  evidence: JsPipelineEvidence
): JsPipelineEvidence {
  const next = withOptionalPublicValue(evidence);
  return {
    ...next,
    pathname: publicOptionalValueText(next.pathname)
  };
}

function publicPipelineCandidate(
  candidate: JsPipelineCandidate
): JsPipelineCandidate {
  return {
    ...candidate,
    seed: {
      ...candidate.seed,
      ...publicValueMetadata(candidate.seed.value)
    },
    summary: shorten(candidate.summary, 500),
    steps: candidate.steps.map(publicPipelineStep),
    evidence: candidate.evidence.map(publicPipelineEvidence),
    apiResponseLinks: candidate.apiResponseLinks.map(publicApiResponseLink)
  };
}

function pushUniqueStep(steps: JsPipelineStep[], step: JsPipelineStep): void {
  const key = [
    step.kind,
    step.path ?? "",
    step.nodeId ?? "",
    step.fixtureDir ?? "",
    step.value ?? "",
    step.label
  ].join("\0");
  const exists = steps.some(
    (candidate) =>
      [
        candidate.kind,
        candidate.path ?? "",
        candidate.nodeId ?? "",
        candidate.fixtureDir ?? "",
        candidate.value ?? "",
        candidate.label
      ].join("\0") === key
  );
  if (!exists) {
    steps.push(step);
  }
}

function pushUniqueEvidence(
  evidence: JsPipelineEvidence[],
  item: JsPipelineEvidence
): void {
  const key = [
    item.kind,
    item.path ?? "",
    item.nodeId ?? "",
    item.fixtureDir ?? "",
    item.value ?? ""
  ].join("\0");
  const exists = evidence.some(
    (candidate) =>
      [
        candidate.kind,
        candidate.path ?? "",
        candidate.nodeId ?? "",
        candidate.fixtureDir ?? "",
        candidate.value ?? ""
      ].join("\0") === key
  );
  if (!exists) {
    evidence.push(item);
  }
}

function endpointPathname(
  value: string,
  baseOrigin?: string | null
): string | null {
  try {
    return new URL(value, baseOrigin ?? "https://wraithwalker.invalid")
      .pathname;
  } catch {
    return null;
  }
}

function apiResponseLink(endpoint: ApiEndpoint): JsApiResponseLink {
  return {
    matchStatus: "matched",
    fixtureDir: endpoint.fixtureDir,
    bodyPath: endpoint.bodyPath,
    method: endpoint.method,
    status: endpoint.status,
    pathname: endpoint.pathname
  };
}

function noApiResponseLink(
  value: string,
  baseOrigin?: string | null
): JsApiResponseLink {
  return {
    matchStatus: "no-match",
    pathname: endpointPathname(value, baseOrigin) ?? undefined,
    reason: "no-captured-api-response-match"
  };
}

function publicApiResponseLink(link: JsApiResponseLink): JsApiResponseLink {
  return {
    ...link,
    pathname: publicOptionalValueText(link.pathname)
  };
}

function apiResponseLinkKey(link: JsApiResponseLink): string {
  return [
    link.matchStatus,
    link.fixtureDir ?? "",
    link.bodyPath ?? "",
    link.method ?? "",
    link.status ?? "",
    link.pathname ?? "",
    link.reason ?? ""
  ].join("\0");
}

function uniqueApiResponseLinks(
  links: JsApiResponseLink[]
): JsApiResponseLink[] {
  const seen = new Set<string>();
  const unique: JsApiResponseLink[] = [];
  for (const link of links) {
    const key = apiResponseLinkKey(link);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(link);
  }
  return unique;
}

function findApiResponsesForEndpoint(
  value: string,
  endpoints: ApiEndpoint[],
  baseOrigin?: string | null
): ApiEndpoint[] {
  const pathname = endpointPathname(value, baseOrigin);
  if (!pathname) {
    return [];
  }

  const matches = endpoints.filter(
    (endpoint) => endpoint.pathname === pathname
  );
  const scopedMatches = baseOrigin
    ? matches.filter((endpoint) => endpoint.origin === baseOrigin)
    : [];
  return (scopedMatches.length > 0 ? scopedMatches : matches)
    .sort(
      (left, right) =>
        left.origin.localeCompare(right.origin) ||
        left.method.localeCompare(right.method) ||
        left.status - right.status ||
        left.bodyPath.localeCompare(right.bodyPath)
    )
    .slice(0, MAX_API_RESPONSE_LINKS);
}

function findApiResponseForEndpoint(
  value: string,
  endpoints: ApiEndpoint[],
  baseOrigin?: string | null
): ApiEndpoint | null {
  return findApiResponsesForEndpoint(value, endpoints, baseOrigin)[0] ?? null;
}

function apiResponseLinksForEndpoint(
  value: string,
  endpoints: ApiEndpoint[],
  baseOrigin?: string | null
): JsApiResponseLink[] {
  const matches = findApiResponsesForEndpoint(value, endpoints, baseOrigin);
  if (matches.length > 0) {
    return matches.map(apiResponseLink);
  }
  return [noApiResponseLink(value, baseOrigin)];
}

function apiResponseLinkForFact(
  fact: JsFact,
  endpoints: ApiEndpoint[]
): JsApiResponseLink | undefined {
  if (fact.kind !== "endpoint") {
    return undefined;
  }
  return apiResponseLinksForEndpoint(fact.value, endpoints, fact.origin)[0];
}

async function listApiEndpointsForTrace(
  rootPath: string,
  origin?: string
): Promise<ApiEndpoint[]> {
  const configs = (await readSiteConfigs(rootPath)).filter(
    (config) => !origin || config.origin === origin
  );
  if (configs.length === 0) {
    return [];
  }
  return (await listApiEndpoints(rootPath, configs)).items;
}

interface JsPipelineSeedMatch {
  kind: "fact" | "symbol";
  value: string;
  nodeId: string;
  loc: JsLocation | null;
  enclosingSymbol: string | null;
  fact?: JsFact;
  symbol?: InternalSymbol;
}

function findPipelineSeedMatches(
  analysis: InternalAnalysis,
  options: JsPipelineTraceOptions
): JsPipelineSeedMatch[] {
  const seed = options.seed.trim();
  if (!seed) {
    return [];
  }

  if (options.kind === "nodeId") {
    return [
      ...(analysis.indexes.factsByNodeId.get(seed) ?? []).map((fact) => ({
        kind: "fact" as const,
        value: fact.value,
        nodeId: fact.nodeId,
        loc: fact.loc,
        enclosingSymbol: fact.enclosingSymbol,
        fact
      })),
      ...(analysis.indexes.symbolsByNodeId.get(seed) ?? []).map((symbol) => ({
        kind: "symbol" as const,
        value: symbol.value,
        nodeId: symbol.nodeId,
        loc: symbol.loc,
        enclosingSymbol: symbol.enclosingSymbol,
        symbol
      }))
    ];
  }

  if (options.kind === "endpoint" || options.kind === "selector") {
    return (analysis.indexes.factsByKind.get(options.kind) ?? [])
      .filter(
        (fact) =>
          fact.kind === options.kind &&
          includesCaseInsensitive(fact.value, seed)
      )
      .map((fact) => ({
        kind: "fact" as const,
        value: fact.value,
        nodeId: fact.nodeId,
        loc: fact.loc,
        enclosingSymbol: fact.enclosingSymbol,
        fact
      }));
  }

  const symbolMatches = [...analysis.indexes.symbolsByName.values()]
    .filter((symbol) => includesCaseInsensitive(symbol.value, seed))
    .map((symbol) => ({
      kind: "symbol" as const,
      value: symbol.value,
      nodeId: symbol.nodeId,
      loc: symbol.loc,
      enclosingSymbol: symbol.enclosingSymbol,
      symbol
    }));
  const factMatches = (["identifier", "call", "export"] as JsSearchKind[])
    .flatMap((kind) => analysis.indexes.factsByKind.get(kind) ?? [])
    .filter((fact) => includesCaseInsensitive(fact.value, seed))
    .map((fact) => ({
      kind: "fact" as const,
      value: fact.value,
      nodeId: fact.nodeId,
      loc: fact.loc,
      enclosingSymbol: fact.enclosingSymbol,
      fact
    }));

  return [...symbolMatches, ...factMatches];
}

function collectRelatedSymbols(
  analysis: InternalAnalysis,
  seedMatch: JsPipelineSeedMatch
): Set<string> {
  const related = new Set<string>();
  const initialSymbol =
    seedMatch.symbol?.value ?? seedMatch.enclosingSymbol ?? null;
  if (initialSymbol) {
    related.add(initialSymbol);
  }

  for (let depth = 0; depth < 2; depth += 1) {
    const currentSymbols = [...related];
    for (const symbol of currentSymbols) {
      for (const fact of analysis.indexes.factsByEnclosingSymbol.get(symbol) ??
        []) {
        if (
          fact.kind === "call" &&
          analysis.indexes.symbolsByName.has(fact.value)
        ) {
          related.add(fact.value);
        }
      }

      for (const fact of analysis.indexes.callFactsByValue.get(symbol) ?? []) {
        if (fact.enclosingSymbol) {
          related.add(fact.enclosingSymbol);
        }
      }
    }
  }

  return new Set([...related].slice(0, 8));
}

function relatedFactsForSymbols(
  analysis: InternalAnalysis,
  symbols: Set<string>
): JsFact[] {
  if (symbols.size === 0) {
    return [];
  }
  return [...symbols].flatMap(
    (symbol) => analysis.indexes.factsByEnclosingSymbol.get(symbol) ?? []
  );
}

function symbolByName(
  analysis: InternalAnalysis,
  name: string
): InternalSymbol | null {
  return analysis.indexes.symbolsByName.get(name) ?? null;
}

function isAddEventListenerCall(fact: JsFact): boolean {
  return fact.kind === "call" && /(^|\.)addEventListener$/.test(fact.value);
}

function isFetchCall(fact: JsFact): boolean {
  return (
    fact.kind === "call" &&
    (fact.value === "fetch" || fact.value.endsWith(".fetch"))
  );
}

function sortFactsByLocation(left: JsFact, right: JsFact): number {
  return left.start - right.start || left.value.localeCompare(right.value);
}

function buildAstPipelineCandidate({
  entry,
  analysis,
  seedMatch,
  options,
  apiEndpoints
}: {
  entry: JsFixtureEntry;
  analysis: InternalAnalysis;
  seedMatch: JsPipelineSeedMatch;
  options: JsPipelineTraceOptions;
  apiEndpoints: ApiEndpoint[];
}): JsPipelineCandidate {
  const relatedSymbols = collectRelatedSymbols(analysis, seedMatch);
  const relatedFacts = relatedFactsForSymbols(analysis, relatedSymbols);
  if (seedMatch.fact) {
    relatedFacts.push(seedMatch.fact);
  }

  const eventCalls = relatedFacts
    .filter(isAddEventListenerCall)
    .sort(sortFactsByLocation)
    .slice(0, 3);
  const selectorFacts = relatedFacts
    .filter((fact) => fact.kind === "selector")
    .sort(sortFactsByLocation)
    .slice(0, 5);
  const fetchCalls = relatedFacts
    .filter(isFetchCall)
    .sort(sortFactsByLocation)
    .slice(0, 3);
  const endpointFacts = relatedFacts
    .filter((fact) => fact.kind === "endpoint")
    .sort(sortFactsByLocation)
    .slice(0, 5);
  const handlerCalls = relatedFacts
    .filter(
      (fact) =>
        fact.kind === "call" && analysis.indexes.symbolsByName.has(fact.value)
    )
    .sort(sortFactsByLocation)
    .slice(0, 5);

  const apiMatches = endpointFacts
    .flatMap((fact) =>
      findApiResponsesForEndpoint(fact.value, apiEndpoints, entry.origin).map(
        (endpoint) => ({ fact, endpoint })
      )
    )
    .slice(0, 3);
  const seedApiLinks =
    seedMatch.fact?.kind === "endpoint"
      ? apiResponseLinksForEndpoint(
          seedMatch.fact.value,
          apiEndpoints,
          entry.origin
        )
      : [];
  const seedHasNoApiMatch = seedApiLinks.some(
    (link) => link.matchStatus === "no-match"
  );
  const fallbackNoMatchLink =
    endpointFacts.length > 0 && apiMatches.length === 0
      ? apiResponseLinksForEndpoint(
          endpointFacts[0]?.value ?? "",
          apiEndpoints,
          entry.origin
        ).find((link) => link.matchStatus === "no-match")
      : undefined;
  const apiResponseLinks = uniqueApiResponseLinks([
    ...apiMatches.map(({ endpoint }) => apiResponseLink(endpoint)),
    ...seedApiLinks.filter((link) => link.matchStatus === "no-match"),
    ...(fallbackNoMatchLink ? [fallbackNoMatchLink] : [])
  ]).slice(0, MAX_API_RESPONSE_LINKS);

  const steps: JsPipelineStep[] = [];
  const evidence: JsPipelineEvidence[] = [];

  if (seedMatch.fact) {
    pushUniqueEvidence(evidence, factEvidence(seedMatch.fact));
  }
  if (seedMatch.symbol) {
    pushUniqueEvidence(
      evidence,
      symbolEvidence(seedMatch.symbol, entry.path, analysis.text)
    );
  }

  for (const eventCall of eventCalls) {
    const eventSymbol = eventCall.enclosingSymbol
      ? symbolByName(analysis, eventCall.enclosingSymbol)
      : null;
    pushUniqueStep(steps, {
      kind: "entrypoint",
      label: eventCall.enclosingSymbol
        ? `${eventCall.enclosingSymbol} event listener`
        : "event listener",
      value: eventCall.enclosingSymbol ?? eventCall.value,
      path: entry.path,
      nodeId: eventSymbol?.nodeId ?? eventCall.nodeId,
      loc: eventSymbol?.loc ?? eventCall.loc,
      snippet: eventCall.snippet
    });
    pushUniqueEvidence(evidence, factEvidence(eventCall));
    if (eventSymbol) {
      pushUniqueEvidence(
        evidence,
        symbolEvidence(eventSymbol, entry.path, analysis.text)
      );
    }
  }

  for (const selectorFact of selectorFacts) {
    pushUniqueStep(steps, {
      kind: "selector",
      label: "DOM selector",
      value: selectorFact.value,
      path: entry.path,
      nodeId: selectorFact.nodeId,
      loc: selectorFact.loc,
      snippet: selectorFact.snippet
    });
    pushUniqueEvidence(evidence, factEvidence(selectorFact));
  }

  for (const symbolName of relatedSymbols) {
    const symbol = symbolByName(analysis, symbolName);
    if (!symbol) {
      continue;
    }
    pushUniqueStep(steps, {
      kind: "handler",
      label: symbol.value,
      value: symbol.value,
      path: entry.path,
      nodeId: symbol.nodeId,
      loc: symbol.loc,
      snippet:
        symbol.loc && analysis.text
          ? shorten(lineText(analysis.text, symbol.loc.line))
          : undefined
    });
    pushUniqueEvidence(
      evidence,
      symbolEvidence(symbol, entry.path, analysis.text)
    );
  }

  for (const handlerCall of handlerCalls) {
    pushUniqueStep(steps, {
      kind: "call",
      label: handlerCall.value,
      value: handlerCall.value,
      path: entry.path,
      nodeId: handlerCall.nodeId,
      loc: handlerCall.loc,
      snippet: handlerCall.snippet
    });
    pushUniqueEvidence(evidence, factEvidence(handlerCall));
  }

  for (const fetchCall of fetchCalls) {
    pushUniqueStep(steps, {
      kind: "call",
      label: "fetch",
      value: fetchCall.value,
      path: entry.path,
      nodeId: fetchCall.nodeId,
      loc: fetchCall.loc,
      snippet: fetchCall.snippet
    });
    pushUniqueEvidence(evidence, factEvidence(fetchCall));
  }

  for (const endpointFact of endpointFacts) {
    pushUniqueStep(steps, {
      kind: "endpoint",
      label: "endpoint",
      value: endpointFact.value,
      path: entry.path,
      nodeId: endpointFact.nodeId,
      loc: endpointFact.loc,
      snippet: endpointFact.snippet,
      pathname: endpointPathname(endpointFact.value, entry.origin) ?? undefined
    });
    pushUniqueEvidence(evidence, factEvidence(endpointFact));
  }

  for (const { endpoint } of apiMatches) {
    pushUniqueStep(steps, {
      kind: "api-response",
      label: `${endpoint.method} ${endpoint.pathname}`,
      fixtureDir: endpoint.fixtureDir,
      bodyPath: endpoint.bodyPath,
      method: endpoint.method,
      status: endpoint.status,
      pathname: endpoint.pathname
    });
    pushUniqueEvidence(evidence, apiEvidence(endpoint));
  }

  const hasEntrypoint = eventCalls.length > 0;
  const hasHandler = relatedSymbols.size > 0;
  const hasFetch = fetchCalls.length > 0;
  const hasEndpoint = endpointFacts.length > 0;
  const hasApi = apiMatches.length > 0;
  const confidence: JsPipelineConfidence =
    hasEntrypoint && hasHandler && hasFetch && hasEndpoint && hasApi
      ? "high"
      : (hasHandler && hasEndpoint) || (hasEntrypoint && hasHandler) || hasApi
        ? "medium"
        : "low";
  const firstSelector = selectorFacts[0]?.value;
  const firstEndpoint = endpointFacts[0]?.value;
  const firstApi = apiMatches[0]?.endpoint;
  const warnings: string[] = [];
  if (
    seedHasNoApiMatch ||
    (endpointFacts.length > 0 && apiMatches.length === 0)
  ) {
    warnings.push(
      "No captured API response metadata matched the referenced endpoint."
    );
  }
  const summary =
    firstSelector && firstEndpoint && firstApi
      ? `DOM selector ${firstSelector} reaches ${firstEndpoint} with captured ${firstApi.method} ${firstApi.pathname}.`
      : firstEndpoint && firstApi
        ? `Endpoint ${firstEndpoint} links to captured ${firstApi.method} ${firstApi.pathname}.`
        : firstEndpoint
          ? `Endpoint ${firstEndpoint} is referenced in ${entry.path}.`
          : `Seed ${options.kind} ${options.seed} is referenced in ${entry.path}.`;

  return {
    pipelineId: `js-pipeline:${stableHash(
      [entry.path, options.kind, options.seed, seedMatch.nodeId].join("\0")
    )}`,
    confidence,
    path: entry.path,
    origin: entry.origin,
    pathname: entry.pathname,
    analysisMode: "ast",
    seed: {
      kind: options.kind,
      value: seedMatch.value,
      ...internalValueMetadata(seedMatch.value),
      nodeId: seedMatch.nodeId,
      loc: seedMatch.loc
    },
    summary,
    steps: steps.slice(0, 20),
    evidence: evidence.slice(0, 20),
    apiResponseLinks,
    warnings
  };
}

function buildTextScanPipelineCandidate({
  entry,
  seedMatch,
  options,
  apiEndpoints
}: {
  entry: JsFixtureEntry;
  seedMatch: JsPipelineSeedMatch;
  options: JsPipelineTraceOptions;
  apiEndpoints: ApiEndpoint[];
}): JsPipelineCandidate {
  const fact = seedMatch.fact;
  const steps: JsPipelineStep[] = [];
  const evidence: JsPipelineEvidence[] = [];
  const apiMatch =
    fact?.kind === "endpoint"
      ? findApiResponseForEndpoint(fact.value, apiEndpoints, entry.origin)
      : null;
  const seedApiLinks =
    fact?.kind === "endpoint"
      ? apiResponseLinksForEndpoint(fact.value, apiEndpoints, entry.origin)
      : [];
  const apiResponseLinks = uniqueApiResponseLinks([
    ...(apiMatch ? [apiResponseLink(apiMatch)] : []),
    ...seedApiLinks.filter((link) => link.matchStatus === "no-match")
  ]).slice(0, MAX_API_RESPONSE_LINKS);

  if (fact) {
    pushUniqueStep(steps, {
      kind:
        fact.kind === "endpoint" || fact.kind === "selector"
          ? fact.kind
          : "call",
      label:
        fact.kind === "endpoint"
          ? "endpoint"
          : fact.kind === "selector"
            ? "DOM selector"
            : fact.value,
      value: fact.value,
      path: entry.path,
      nodeId: fact.nodeId,
      loc: fact.loc,
      snippet: fact.snippet,
      pathname:
        fact.kind === "endpoint"
          ? (endpointPathname(fact.value, entry.origin) ?? undefined)
          : undefined
    });
    pushUniqueEvidence(evidence, factEvidence(fact));
  }

  if (apiMatch) {
    pushUniqueStep(steps, {
      kind: "api-response",
      label: `${apiMatch.method} ${apiMatch.pathname}`,
      fixtureDir: apiMatch.fixtureDir,
      bodyPath: apiMatch.bodyPath,
      method: apiMatch.method,
      status: apiMatch.status,
      pathname: apiMatch.pathname
    });
    pushUniqueEvidence(evidence, apiEvidence(apiMatch));
  }

  return {
    pipelineId: `js-pipeline:${stableHash(
      [entry.path, options.kind, options.seed, seedMatch.nodeId].join("\0")
    )}`,
    confidence: apiMatch ? "medium" : "low",
    path: entry.path,
    origin: entry.origin,
    pathname: entry.pathname,
    analysisMode: "text-scan",
    seed: {
      kind: options.kind,
      value: seedMatch.value,
      ...internalValueMetadata(seedMatch.value),
      nodeId: seedMatch.nodeId,
      loc: seedMatch.loc
    },
    summary: apiMatch
      ? `Oversized JS text-scan found ${seedMatch.value} and linked captured ${apiMatch.method} ${apiMatch.pathname}.`
      : `Oversized JS text-scan found ${seedMatch.value} in ${entry.path}.`,
    steps,
    evidence,
    apiResponseLinks,
    warnings: [
      "Oversized JavaScript fixture used text-scan mode; handler, event, and call graph relationships are approximate or unavailable.",
      ...(fact?.kind === "endpoint" && !apiMatch
        ? ["No captured API response metadata matched the referenced endpoint."]
        : [])
    ]
  };
}

export async function traceJsPipeline(
  rootPath: string,
  options: JsPipelineTraceOptions
): Promise<JsPipelineTraceResult> {
  const seed = options.seed.trim();
  if (!seed) {
    return {
      items: [],
      totalMatched: 0,
      matchedOrigins: [],
      skipped: []
    };
  }

  const normalizedPathContains = options.pathContains?.toLowerCase();
  const entries = (await listJsFixtureEntries(rootPath)).filter((entry) => {
    if (options.origin && entry.origin !== options.origin) {
      return false;
    }
    if (
      normalizedPathContains &&
      !entry.path.toLowerCase().includes(normalizedPathContains)
    ) {
      return false;
    }
    return true;
  });
  const apiEndpoints = await listApiEndpointsForTrace(rootPath, options.origin);
  const candidates: JsPipelineCandidate[] = [];
  const skipped: JsPipelineTraceResult["skipped"] = [];

  for (const entry of entries) {
    try {
      const analysis =
        options.kind === "nodeId" && parseTextScanNodeId(seed)
          ? await getSeedSuggestionAnalysis(rootPath, entry)
          : await getInternalAnalysis(rootPath, entry.path);
      if (
        analysis.publicAnalysis.analysisMode === "text-scan" &&
        options.kind === "symbol"
      ) {
        skipped.push({
          path: entry.path,
          reason:
            "Text-scan mode does not support symbol pipeline tracing for oversized JavaScript fixtures."
        });
        continue;
      }

      const seedMatches = findPipelineSeedMatches(analysis, options);
      for (const seedMatch of seedMatches) {
        candidates.push(
          analysis.publicAnalysis.analysisMode === "text-scan"
            ? buildTextScanPipelineCandidate({
                entry,
                seedMatch,
                options,
                apiEndpoints
              })
            : buildAstPipelineCandidate({
                entry,
                analysis,
                seedMatch,
                options,
                apiEndpoints
              })
        );
      }
    } catch (error) {
      skipped.push({
        path: entry.path,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  candidates.sort(
    (left, right) =>
      confidenceRank(right.confidence) - confidenceRank(left.confidence) ||
      right.steps.length - left.steps.length ||
      left.path.localeCompare(right.path) ||
      left.seed.value.localeCompare(right.seed.value)
  );

  const limit = normalizePipelineLimit(options.limit);
  const items = candidates.slice(0, limit).map(publicPipelineCandidate);

  return {
    items,
    totalMatched: candidates.length,
    matchedOrigins: [
      ...new Set(
        candidates
          .map((candidate) => candidate.origin)
          .filter(Boolean) as string[]
      )
    ].sort(),
    skipped
  };
}

function findNodeByRange(
  ast: unknown,
  start: number,
  end: number
): {
  node: any;
  ancestors: any[];
} | null {
  let found: { node: any; ancestors: any[] } | null = null;
  visitAst(ast, (node, ancestors) => {
    if (node.start === start && node.end === end) {
      if (!found || ancestors.length >= found.ancestors.length) {
        found = { node, ancestors };
      }
    }
  });
  return found;
}

function isFunctionOrClassReadableNode(node: any): boolean {
  return [
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
    "ObjectMethod",
    "ClassDeclaration",
    "ClassExpression",
    "ClassMethod",
    "ClassPrivateMethod"
  ].includes(node?.type);
}

function readableNodeSize(node: any): number {
  if (typeof node?.start !== "number" || typeof node?.end !== "number") {
    return Number.POSITIVE_INFINITY;
  }
  return node.end - node.start;
}

function isNamedFunctionOrClassReadableNode(node: any): boolean {
  return isFunctionOrClassReadableNode(node) && declarationName(node) !== null;
}

function isLocalBundleReadableNode(node: any): boolean {
  return [
    "ObjectProperty",
    "ClassProperty",
    "ClassPrivateProperty",
    "VariableDeclarator",
    "AssignmentExpression",
    "CallExpression",
    "OptionalCallExpression",
    "NewExpression"
  ].includes(node?.type);
}

function isFallbackReadableNode(node: any): boolean {
  return [
    "VariableDeclaration",
    "ExpressionStatement",
    "ExportNamedDeclaration",
    "ExportDefaultDeclaration"
  ].includes(node?.type);
}

function findReadableNode(node: any, ancestors: any[]): any {
  const candidates = [node, ...[...ancestors].reverse()];
  const namedFunctionOrClass = candidates.find(
    (candidate) =>
      isNamedFunctionOrClassReadableNode(candidate) &&
      readableNodeSize(candidate) <= SNIPPET_MAX_BYTES
  );
  if (namedFunctionOrClass) {
    return namedFunctionOrClass;
  }

  const localBundleNode = candidates.find(isLocalBundleReadableNode);
  if (localBundleNode) {
    return localBundleNode;
  }

  return (
    candidates.find(isFunctionOrClassReadableNode) ??
    candidates.find(isFallbackReadableNode) ??
    node
  );
}

async function readTextScanSnippet(
  resolved: string,
  startByte: number,
  endByte: number
): Promise<{
  text: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
}> {
  const stat = await fs.stat(resolved);
  const boundedEndByte = Math.min(endByte, startByte + 256);
  const anchorByte = Math.floor((startByte + boundedEndByte) / 2);
  const windowStart = Math.max(
    0,
    anchorByte - Math.floor(TEXT_SCAN_SYMBOL_SNIPPET_BYTES / 2)
  );
  const readLength = Math.min(
    TEXT_SCAN_SYMBOL_SNIPPET_BYTES + 4,
    stat.size - windowStart
  );
  const buffer = Buffer.alloc(readLength);
  const handle = await fs.open(resolved, "r");
  try {
    await handle.read(buffer, 0, readLength, windowStart);
  } finally {
    await handle.close();
  }

  let decoded = "";
  let decodeStart = 0;
  let decodeEnd = buffer.length;
  while (decodeStart < Math.min(4, buffer.length)) {
    decodeEnd = buffer.length;
    while (decodeEnd >= decodeStart) {
      try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(decodeStart, decodeEnd)
        );
        break;
      } catch {
        decodeEnd -= 1;
      }
    }
    if (decoded || decodeEnd > decodeStart || buffer.length === 0) {
      break;
    }
    decodeStart += 1;
  }

  if (!decoded && buffer.length > 0) {
    throw new Error("Text-scan snippet could not be decoded as UTF-8.");
  }

  const boundedText = truncateUtf8(decoded, TEXT_SCAN_SYMBOL_SNIPPET_BYTES);

  const startLine = await lineAtByteOffset(resolved, windowStart + decodeStart);
  const endLine =
    startLine +
    boundedText.text.split(/\r\n|\n|\r/).length -
    (boundedText.text ? 1 : 0);

  return {
    text: boundedText.text,
    startLine,
    endLine,
    truncated:
      boundedText.truncated ||
      windowStart > 0 ||
      windowStart + decodeEnd < stat.size
  };
}

export async function readJsSymbol(
  rootPath: string,
  {
    path: relativePath,
    symbol,
    nodeId
  }: {
    path: string;
    symbol?: string;
    nodeId?: string;
  }
): Promise<JsSymbolReadResult> {
  const textScanRange = nodeId ? parseTextScanNodeId(nodeId) : null;
  if (nodeId && textScanRange) {
    const { resolved } = await resolveJsFixtureForAnalysis(
      rootPath,
      relativePath
    );
    const snippet = await readTextScanSnippet(
      resolved,
      textScanRange.startByte,
      textScanRange.endByte
    );

    return {
      path: normalizeRelativePath(relativePath),
      nodeId,
      symbol: symbol ?? null,
      nodeKind: textScanRange.kind,
      enclosingSymbol: null,
      startLine: snippet.startLine,
      endLine: snippet.endLine,
      truncated: snippet.truncated,
      text: snippet.text
    };
  }

  const analysis = await getInternalAnalysis(rootPath, relativePath);
  if (analysis.publicAnalysis.analysisMode === "text-scan") {
    if (!nodeId) {
      throw new Error(
        `read-js-symbol requires a text-scan nodeId for oversized JavaScript fixture: ${relativePath}`
      );
    }

    const range = parseTextScanNodeId(nodeId);
    if (!range) {
      throw new Error(`Invalid JavaScript node id: ${nodeId}`);
    }

    const fact = analysis.indexes.factsByNodeId.get(nodeId)?.[0] ?? null;
    const { resolved } = await resolveJsFixtureForAnalysis(
      rootPath,
      relativePath
    );
    const snippet = await readTextScanSnippet(
      resolved,
      range.startByte,
      range.endByte
    );

    return {
      path: normalizeRelativePath(relativePath),
      nodeId,
      symbol:
        symbol ??
        fact?.enclosingSymbol ??
        (fact ? publicValueText(fact.value) : null),
      nodeKind: fact?.nodeKind ?? "TextMatch",
      enclosingSymbol: fact?.enclosingSymbol ?? null,
      startLine: snippet.startLine,
      endLine: snippet.endLine,
      truncated: snippet.truncated,
      text: snippet.text
    };
  }

  if (!analysis.ast) {
    throw new Error(
      `JavaScript fixture could not be parsed: ${analysis.publicAnalysis.parse.errors[0]?.message ?? relativePath}`
    );
  }

  let target: { node: any; ancestors: any[] } | null = null;
  let resolvedSymbol = symbol ?? null;

  if (nodeId) {
    const range = parseNodeId(nodeId);
    if (!range) {
      throw new Error(`Invalid JavaScript node id: ${nodeId}`);
    }
    target = findNodeByRange(analysis.ast, range.start, range.end);
  }

  if (!target && symbol) {
    const symbolEntry = analysis.indexes.symbolsByName.get(symbol);
    if (symbolEntry) {
      target = findNodeByRange(
        analysis.ast,
        symbolEntry.start,
        symbolEntry.end
      );
    }
  }

  if (!target) {
    throw new Error(
      nodeId
        ? `JavaScript node not found in ${relativePath}: ${nodeId}`
        : `JavaScript symbol not found in ${relativePath}: ${symbol}`
    );
  }

  const readable = findReadableNode(target.node, target.ancestors);
  const snippet = readRangeSnippet(
    analysis.text ?? "",
    readable.start ?? target.node.start ?? 0,
    readable.end ?? target.node.end ?? readable.start ?? 0
  );
  resolvedSymbol = resolvedSymbol ?? declarationName(readable);

  return {
    path: normalizeRelativePath(relativePath),
    nodeId: makeNodeId(readable),
    symbol: resolvedSymbol,
    nodeKind: readable.type,
    enclosingSymbol: enclosingSymbol(target.ancestors),
    startLine: snippet.startLine,
    endLine: snippet.endLine,
    truncated: snippet.truncated,
    text: snippet.text
  };
}
