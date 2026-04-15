import type {
  TrpcHeartbeatInfo,
  TrpcSystemInfo
} from "@wraithwalker/mcp-server/trpc";
import type {
  FixtureDiff,
  ScenarioSnapshotSourceTrace,
  ScenarioSnapshotSummary
} from "@wraithwalker/core/scenarios";

import type {
  BrowserConsoleEntry,
  FixtureDescriptor,
  RequestPayload,
  ResponseMeta,
  RootSentinel,
  SiteConfig
} from "./types.js";

export const DEFAULT_WRAITHWALKER_SERVER_TRPC_URL =
  "http://127.0.0.1:4319/trpc";
export const WRAITHWALKER_SERVER_CACHE_TTL_MS = 5_000;
export const WRAITHWALKER_SERVER_REQUEST_TIMEOUT_MS = 750;
export const WRAITHWALKER_SERVER_SOURCE_HEADER = "wraithwalker-extension";

export interface WraithWalkerServerClientOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ServerFixtureReadResultMissing {
  exists: false;
  sentinel: RootSentinel;
}

export interface ServerFixtureReadResultFound {
  exists: true;
  request: RequestPayload;
  meta: ResponseMeta;
  bodyBase64: string;
  size: number;
  sentinel: RootSentinel;
}

export type ServerFixtureReadResult =
  | ServerFixtureReadResultMissing
  | ServerFixtureReadResultFound;

export interface ServerScenarioTraceLinkedFixture {
  bodyPath: string;
  requestUrl: string;
  resourceType: string;
  capturedAt: string;
}

export interface ServerScenarioTraceStep {
  stepId: string;
  tabId: number;
  recordedAt: string;
  pageUrl: string;
  topOrigin: string;
  selector: string;
  tagName: string;
  textSnippet: string;
  role?: string;
  ariaLabel?: string;
  href?: string;
  linkedFixtures: ServerScenarioTraceLinkedFixture[];
}

export interface ServerScenarioTraceRecord {
  schemaVersion: number;
  traceId: string;
  name?: string;
  goal?: string;
  status: "armed" | "recording" | "completed";
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  rootId: string;
  selectedOrigins: string[];
  extensionClientId: string;
  steps: ServerScenarioTraceStep[];
}

export interface TrpcSiteConfigsInfo {
  siteConfigs: SiteConfig[];
  sentinel: RootSentinel;
}

export interface TrpcScenarioListInfo {
  scenarios?: string[];
  snapshots: ScenarioSnapshotSummary[];
  activeScenarioName: string | null;
  activeScenarioMissing: boolean;
  activeTrace: ScenarioSnapshotSourceTrace | null;
  supportsTraceSave: boolean;
}

export interface TrpcScenarioResult {
  ok: true;
  name: string;
}

export interface TrpcScenarioDiffInfo {
  ok: true;
  diff: FixtureDiff;
}

export interface ExtensionServerCommand {
  commandId: string;
  type: "refresh_config";
  issuedAt: string;
}

export interface ExtensionServerCommandResult {
  commandId: string;
  type: "refresh_config";
  ok: boolean;
  completedAt: string;
  error?: string;
}

export interface ServerHeartbeatInfo extends TrpcHeartbeatInfo {
  commands?: ExtensionServerCommand[];
}

export interface ServerHeartbeatPayload {
  clientId: string;
  extensionVersion: string;
  sessionActive: boolean;
  enabledOrigins: string[];
  recentConsoleEntries?: BrowserConsoleEntry[];
  completedCommands?: ExtensionServerCommandResult[];
}

export interface WriteFixtureIfAbsentPayload {
  descriptor: FixtureDescriptor;
  request: RequestPayload;
  response: {
    body: string;
    bodyEncoding: "utf8" | "base64";
    meta: ResponseMeta;
  };
}

export interface GenerateContextPayload {
  siteConfigs: SiteConfig[];
  editorId?: string;
}

export interface RecordTraceClickPayload {
  traceId: string;
  step: Omit<ServerScenarioTraceStep, "linkedFixtures">;
}

export interface LinkTraceFixturePayload {
  traceId: string;
  tabId: number;
  requestedAt: string;
  fixture: ServerScenarioTraceLinkedFixture;
}

export interface WraithWalkerServerClient {
  getSystemInfo(): Promise<TrpcSystemInfo>;
  revealRoot(): Promise<{ ok: true; command: string }>;
  listScenarios(): Promise<TrpcScenarioListInfo>;
  saveScenario(name: string, description?: string): Promise<TrpcScenarioResult>;
  switchScenario(name: string): Promise<TrpcScenarioResult>;
  diffScenarios(
    scenarioA: string,
    scenarioB: string
  ): Promise<TrpcScenarioDiffInfo>;
  saveScenarioFromTrace(
    name: string,
    description?: string
  ): Promise<TrpcScenarioResult>;
  heartbeat(payload: ServerHeartbeatPayload): Promise<ServerHeartbeatInfo>;
  hasFixture(
    descriptor: FixtureDescriptor
  ): Promise<{ exists: boolean; sentinel: RootSentinel }>;
  readConfiguredSiteConfigs(): Promise<TrpcSiteConfigsInfo>;
  readEffectiveSiteConfigs(): Promise<TrpcSiteConfigsInfo>;
  writeConfiguredSiteConfigs(
    siteConfigs: SiteConfig[]
  ): Promise<TrpcSiteConfigsInfo>;
  readFixture(descriptor: FixtureDescriptor): Promise<ServerFixtureReadResult>;
  writeFixtureIfAbsent(payload: WriteFixtureIfAbsentPayload): Promise<{
    written: boolean;
    descriptor: FixtureDescriptor;
    sentinel: RootSentinel;
  }>;
  generateContext(payload: GenerateContextPayload): Promise<{ ok: true }>;
  recordTraceClick(payload: RecordTraceClickPayload): Promise<{
    recorded: boolean;
    activeTrace: ServerScenarioTraceRecord | null;
  }>;
  linkTraceFixture(payload: LinkTraceFixturePayload): Promise<{
    linked: boolean;
    trace: ServerScenarioTraceRecord | null;
  }>;
}
