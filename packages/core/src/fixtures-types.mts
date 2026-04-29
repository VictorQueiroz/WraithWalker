import type {
  ResponseMeta,
  StaticResourceManifest,
  StaticResourceManifestEntry
} from "./fixture-layout.mjs";

export type {
  ResponseMeta,
  StaticResourceManifest,
  StaticResourceManifestEntry
} from "./fixture-layout.mjs";

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
  body: FixtureReadPage | null;
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
  displaySizeBytes: number | null;
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
  startLine?: number;
  lineCount?: number;
  maxBytes?: number;
}

export interface FixtureReadOptions {
  cursor?: string;
  maxBytes?: number;
}

export interface FixtureReadPage {
  path: string;
  sizeBytes: number;
  startByte: number;
  bytesReturned: number;
  maxBytes: number;
  truncated: boolean;
  nextCursor: string | null;
  text: string;
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
