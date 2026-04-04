export type SiteMode = "simple" | "advanced";

export interface SiteConfig {
  origin: string;
  createdAt: string;
  mode: SiteMode;
  dumpAllowlistPatterns: string[];
}

export interface NativeHostConfig {
  hostName: string;
  rootPath: string;
  commandTemplate: string;
  verifiedAt: string | null;
  lastVerificationError: string;
  lastOpenError: string;
}

export interface SessionSnapshot {
  sessionActive: boolean;
  attachedTabIds: number[];
  enabledOrigins: string[];
  rootReady: boolean;
  helperReady: boolean;
  lastError: string;
}

export interface RootSentinel {
  rootId: string;
  schemaVersion: number;
  createdAt: string;
}

export interface AttachedTabState {
  topOrigin: string;
}

export interface StorageState {
  siteConfigs?: SiteConfig[];
  nativeHostConfig?: Partial<NativeHostConfig>;
  lastSessionSnapshot?: SessionSnapshot;
  preferredEditorId?: string;
}

export interface HeaderEntry {
  name: string;
  value: string;
}

export interface AssetLikeRequestInput {
  method: string;
  url: string;
  resourceType?: string;
  mimeType?: string;
}

export interface FixtureDescriptorBase {
  topOrigin: string;
  topOriginKey: string;
  requestOrigin: string;
  requestOriginKey: string;
  requestUrl: string;
  method: string;
  siteMode: SiteMode;
  postDataEncoding: string;
  queryHash: string;
  bodyHash: string;
  bodyPath: string;
  requestPath: string;
  metaPath: string;
  manifestPath: string | null;
  metadataOptional: boolean;
  slug: string;
}

export interface AssetFixtureDescriptor extends FixtureDescriptorBase {
  assetLike: true;
  storageMode: "asset";
}

export interface ApiFixtureDescriptor extends FixtureDescriptorBase {
  assetLike: false;
  directory: string;
  storageMode: "api";
}

export type FixtureDescriptor = AssetFixtureDescriptor | ApiFixtureDescriptor;

export interface RequestEntry {
  tabId: number;
  requestId: string;
  topOrigin: string;
  method: string;
  url: string;
  requestHeaders: HeaderEntry[];
  requestBody: string;
  requestBodyEncoding: string;
  descriptor: FixtureDescriptor | null;
  resourceType: string;
  mimeType: string;
  replayed: boolean;
  responseStatus: number;
  responseStatusText: string;
  responseHeaders: HeaderEntry[];
}

export interface RequestContext {
  topOrigin: string;
  method: string;
  url: string;
  headers: HeaderEntry[];
  body: string;
  bodyEncoding: string;
  resourceType: string;
  mimeType: string;
}

export interface RequestPayload {
  topOrigin: string;
  url: string;
  method: string;
  headers: HeaderEntry[];
  body: string;
  bodyEncoding: string;
  bodyHash: string;
  queryHash: string;
  capturedAt: string;
}

export interface ResponseMeta {
  status: number;
  statusText: string;
  headers: HeaderEntry[];
  mimeType: string;
  resourceType: string;
  url: string;
  method: string;
  capturedAt: string;
  bodyEncoding: string;
  bodySuggestedExtension: string;
}

export interface StoredFixture {
  request: RequestPayload;
  meta: ResponseMeta;
  bodyBase64: string;
  size: number;
}

export interface StaticResourceManifestEntry {
  requestUrl: string;
  requestOrigin: string;
  pathname: string;
  search: string;
  bodyPath: string;
  requestPath: string;
  metaPath: string;
  mimeType: string;
  resourceType: string;
  capturedAt: string;
}

export interface StaticResourceManifest {
  schemaVersion: number;
  topOrigin: string;
  topOriginKey: string;
  generatedAt: string;
  resourcesByPathname: Record<string, StaticResourceManifestEntry[]>;
}

export type HeaderInput = HeaderEntry[] | Record<string, unknown>;
