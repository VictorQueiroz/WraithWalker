import type {
  ApiFixtureDescriptor,
  AssetFixtureDescriptor,
  AssetLikeRequestInput,
  FixtureDescriptor,
  FixtureDescriptorBase,
  HeaderEntry,
  RequestPayload,
  ResponseMeta,
  SiteMode,
  StaticResourceManifest,
  StaticResourceManifestEntry,
  StoredFixture
} from "@wraithwalker/core/fixture-layout";

export type {
  ApiFixtureDescriptor,
  AssetFixtureDescriptor,
  AssetLikeRequestInput,
  FixtureDescriptor,
  FixtureDescriptorBase,
  HeaderEntry,
  RequestPayload,
  ResponseMeta,
  SiteMode,
  StaticResourceManifest,
  StaticResourceManifestEntry,
  StoredFixture
};

export interface SiteConfig {
  origin: string;
  createdAt: string;
  mode: SiteMode;
  dumpAllowlistPatterns: string[];
}

export interface EditorLaunchOverride {
  commandTemplate?: string;
  urlTemplate?: string;
}

export interface NativeHostConfig {
  hostName: string;
  launchPath: string;
  editorLaunchOverrides: Record<string, EditorLaunchOverride>;
}

export interface SessionSnapshot {
  sessionActive: boolean;
  attachedTabIds: number[];
  enabledOrigins: string[];
  rootReady: boolean;
  captureDestination: "none" | "local" | "server";
  captureRootPath: string;
  lastError: string;
}

export interface RootSentinel {
  rootId: string;
  schemaVersion?: number;
  createdAt?: string;
}

export interface AttachedTabState {
  topOrigin: string;
  traceScriptIdentifier?: string | null;
  traceArmedForTraceId?: string | null;
}

export interface StorageState {
  siteConfigs?: SiteConfig[];
  nativeHostConfig?: Partial<NativeHostConfig>;
  lastSessionSnapshot?: SessionSnapshot;
  preferredEditorId?: string;
  extensionClientId?: string;
}

export interface RequestEntry {
  tabId: number;
  requestId: string;
  requestedAt: string;
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

export type HeaderInput = HeaderEntry[] | Record<string, unknown>;
