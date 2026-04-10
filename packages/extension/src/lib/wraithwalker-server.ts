import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type {
  AppRouter,
  TrpcHeartbeatInfo,
  TrpcSystemInfo
} from "@wraithwalker/mcp-server/trpc";

import type {
  BrowserConsoleEntry,
  FixtureDescriptor,
  RequestPayload,
  ResponseMeta,
  RootSentinel,
  SiteConfig
} from "./types.js";

export const DEFAULT_WRAITHWALKER_SERVER_TRPC_URL = "http://127.0.0.1:4319/trpc";
export const WRAITHWALKER_SERVER_CACHE_TTL_MS = 5_000;
export const WRAITHWALKER_SERVER_REQUEST_TIMEOUT_MS = 750;
export const WRAITHWALKER_SERVER_SOURCE_HEADER = "wraithwalker-extension";

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

export type ServerFixtureReadResult = ServerFixtureReadResultMissing | ServerFixtureReadResultFound;

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
  scenarios: string[];
}

export interface TrpcScenarioResult {
  ok: true;
  name: string;
}

export interface WraithWalkerServerClient {
  getSystemInfo(): Promise<TrpcSystemInfo>;
  revealRoot(): Promise<{ ok: true; command: string }>;
  listScenarios(): Promise<TrpcScenarioListInfo>;
  saveScenario(name: string): Promise<TrpcScenarioResult>;
  switchScenario(name: string): Promise<TrpcScenarioResult>;
  heartbeat(payload: {
    clientId: string;
    extensionVersion: string;
    sessionActive: boolean;
    enabledOrigins: string[];
    recentConsoleEntries?: BrowserConsoleEntry[];
  }): Promise<TrpcHeartbeatInfo>;
  hasFixture(descriptor: FixtureDescriptor): Promise<{ exists: boolean; sentinel: RootSentinel }>;
  readConfiguredSiteConfigs(): Promise<TrpcSiteConfigsInfo>;
  readEffectiveSiteConfigs(): Promise<TrpcSiteConfigsInfo>;
  writeConfiguredSiteConfigs(siteConfigs: SiteConfig[]): Promise<TrpcSiteConfigsInfo>;
  readFixture(descriptor: FixtureDescriptor): Promise<ServerFixtureReadResult>;
  writeFixtureIfAbsent(payload: {
    descriptor: FixtureDescriptor;
    request: RequestPayload;
    response: {
      body: string;
      bodyEncoding: "utf8" | "base64";
      meta: ResponseMeta;
    };
  }): Promise<{ written: boolean; descriptor: FixtureDescriptor; sentinel: RootSentinel }>;
  generateContext(payload: { siteConfigs: SiteConfig[]; editorId?: string }): Promise<{ ok: true }>;
  recordTraceClick(payload: {
    traceId: string;
    step: Omit<ServerScenarioTraceStep, "linkedFixtures">;
  }): Promise<{ recorded: boolean; activeTrace: ServerScenarioTraceRecord | null }>;
  linkTraceFixture(payload: {
    traceId: string;
    tabId: number;
    requestedAt: string;
    fixture: ServerScenarioTraceLinkedFixture;
  }): Promise<{ linked: boolean; trace: ServerScenarioTraceRecord | null }>;
}

export function createTimedFetch(
  timeoutMs = WRAITHWALKER_SERVER_REQUEST_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch
): typeof fetch {
  return async (input, init) => {
    const requestInit: RequestInit = init ?? {};
    const controller = new AbortController();
    const upstreamSignal = requestInit.signal;
    const onAbort = () => controller.abort(upstreamSignal?.reason);
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        controller.abort(upstreamSignal.reason);
      } else {
        upstreamSignal.addEventListener("abort", onAbort, { once: true });
      }
    }

    try {
      return await fetchImpl(input, {
        ...requestInit,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener("abort", onAbort);
    }
  };
}

export function isServerCacheFresh(
  checkedAt: number,
  ttlMs = WRAITHWALKER_SERVER_CACHE_TTL_MS,
  now = Date.now()
): boolean {
  return checkedAt > 0 && now - checkedAt < ttlMs;
}

export function createWraithWalkerServerClient(
  url = DEFAULT_WRAITHWALKER_SERVER_TRPC_URL,
  {
    timeoutMs = WRAITHWALKER_SERVER_REQUEST_TIMEOUT_MS,
    fetchImpl = fetch
  }: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {}
): WraithWalkerServerClient {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink(createWraithWalkerServerTransportOptions(url, {
        timeoutMs,
        fetchImpl
      }))
    ]
  }) as any;

  return {
    getSystemInfo() {
      return trpc.system.info.query() as Promise<TrpcSystemInfo>;
    },
    revealRoot() {
      return trpc.system.revealRoot.mutate() as Promise<{ ok: true; command: string }>;
    },
    listScenarios() {
      return trpc.scenarios.list.query() as Promise<TrpcScenarioListInfo>;
    },
    saveScenario(name) {
      return trpc.scenarios.save.mutate({ name }) as Promise<TrpcScenarioResult>;
    },
    switchScenario(name) {
      return trpc.scenarios.switch.mutate({ name }) as Promise<TrpcScenarioResult>;
    },
    heartbeat(payload) {
      return trpc.extension.heartbeat.mutate(payload) as Promise<TrpcHeartbeatInfo>;
    },
    hasFixture(descriptor) {
      return trpc.fixtures.has.query({ descriptor }) as Promise<{ exists: boolean; sentinel: RootSentinel }>;
    },
    readConfiguredSiteConfigs() {
      return trpc.config.readConfiguredSiteConfigs.query() as Promise<TrpcSiteConfigsInfo>;
    },
    readEffectiveSiteConfigs() {
      return trpc.config.readEffectiveSiteConfigs.query() as Promise<TrpcSiteConfigsInfo>;
    },
    writeConfiguredSiteConfigs(siteConfigs) {
      return trpc.config.writeConfiguredSiteConfigs.mutate({ siteConfigs }) as Promise<TrpcSiteConfigsInfo>;
    },
    readFixture(descriptor) {
      return trpc.fixtures.read.query({ descriptor }) as Promise<ServerFixtureReadResult>;
    },
    writeFixtureIfAbsent(payload) {
      return trpc.fixtures.writeIfAbsent.mutate(payload) as Promise<{
        written: boolean;
        descriptor: FixtureDescriptor;
        sentinel: RootSentinel;
      }>;
    },
    generateContext(payload) {
      return trpc.fixtures.generateContext.mutate(payload) as Promise<{ ok: true }>;
    },
    recordTraceClick(payload) {
      return trpc.scenarioTraces.recordClick.mutate(payload) as Promise<{
        recorded: boolean;
        activeTrace: ServerScenarioTraceRecord | null;
      }>;
    },
    linkTraceFixture(payload) {
      return trpc.scenarioTraces.linkFixture.mutate(payload) as Promise<{
        linked: boolean;
        trace: ServerScenarioTraceRecord | null;
      }>;
    }
  };
}

export function createWraithWalkerServerTransportOptions(
  url = DEFAULT_WRAITHWALKER_SERVER_TRPC_URL,
  {
    timeoutMs = WRAITHWALKER_SERVER_REQUEST_TIMEOUT_MS,
    fetchImpl = fetch
  }: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {}
) {
  return {
    url,
    // Force POST for batched queries so the browser never builds oversized loopback URLs.
    methodOverride: "POST" as const,
    headers() {
      return {
        "x-trpc-source": WRAITHWALKER_SERVER_SOURCE_HEADER
      };
    },
    fetch: createTimedFetch(timeoutMs, fetchImpl)
  };
}
