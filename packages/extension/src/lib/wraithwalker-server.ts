import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter, TrpcSystemInfo } from "@wraithwalker/mcp-server/trpc";

import type { FixtureDescriptor, RequestPayload, ResponseMeta, RootSentinel, SiteConfig } from "./types.js";

export const DEFAULT_WRAITHWALKER_SERVER_TRPC_URL = "http://127.0.0.1:4319/trpc";
export const WRAITHWALKER_SERVER_CACHE_TTL_MS = 5_000;

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

export function isServerCacheFresh(
  checkedAt: number,
  ttlMs = WRAITHWALKER_SERVER_CACHE_TTL_MS,
  now = Date.now()
): boolean {
  return checkedAt > 0 && now - checkedAt < ttlMs;
}

export function createWraithWalkerServerClient(
  url = DEFAULT_WRAITHWALKER_SERVER_TRPC_URL
): WraithWalkerServerClient {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url
      })
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
