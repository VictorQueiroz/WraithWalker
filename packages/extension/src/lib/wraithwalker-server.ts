import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter, TrpcSystemInfo } from "@wraithwalker/mcp-server/trpc";

import type { FixtureDescriptor, RequestPayload, ResponseMeta, RootSentinel, SiteConfig } from "./types.js";

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

export interface WraithWalkerServerClient {
  getSystemInfo(): Promise<TrpcSystemInfo>;
  hasFixture(descriptor: FixtureDescriptor): Promise<{ exists: boolean; sentinel: RootSentinel }>;
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
    hasFixture(descriptor) {
      return trpc.fixtures.has.query({ descriptor }) as Promise<{ exists: boolean; sentinel: RootSentinel }>;
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
