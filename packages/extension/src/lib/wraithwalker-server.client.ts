import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter, TrpcSystemInfo } from "@wraithwalker/mcp-server/trpc";

import {
  DEFAULT_WRAITHWALKER_SERVER_TRPC_URL,
  WRAITHWALKER_SERVER_FIXTURE_STREAM_PATH,
  WRAITHWALKER_SERVER_SOURCE_HEADER,
  WRAITHWALKER_SERVER_STREAM_UPLOAD_THRESHOLD_BYTES,
  type GenerateContextPayload,
  type LinkTraceFixturePayload,
  type RecordTraceClickPayload,
  type ServerFixtureReadResult,
  type ServerHeartbeatInfo,
  type ServerHeartbeatPayload,
  type ServerScenarioTraceRecord,
  type TrpcScenarioDiffInfo,
  type TrpcScenarioListInfo,
  type TrpcScenarioResult,
  type TrpcSiteConfigsInfo,
  type WraithWalkerServerClient,
  type WraithWalkerServerClientOptions,
  type WriteFixtureIfAbsentPayload
} from "./wraithwalker-server.shared.js";
import {
  createTimedFetch,
  createWraithWalkerServerTransportOptions
} from "./wraithwalker-server.transport.js";
import type { FixtureDescriptor, RootSentinel, SiteConfig } from "./types.js";

interface TrpcProcedure<TInput, TOutput> {
  query(input?: TInput): Promise<TOutput>;
  mutate(input?: TInput): Promise<TOutput>;
}

export interface WraithWalkerServerTrpcClient {
  system: {
    info: TrpcProcedure<void, TrpcSystemInfo>;
    revealRoot: TrpcProcedure<void, { ok: true; command: string }>;
  };
  scenarios: {
    list: TrpcProcedure<void, TrpcScenarioListInfo>;
    save: TrpcProcedure<
      { name: string; description?: string },
      TrpcScenarioResult
    >;
    switch: TrpcProcedure<{ name: string }, TrpcScenarioResult>;
    diff: TrpcProcedure<
      { scenarioA: string; scenarioB: string },
      TrpcScenarioDiffInfo
    >;
    saveFromTrace: TrpcProcedure<
      { name: string; description?: string },
      TrpcScenarioResult
    >;
  };
  extension: {
    heartbeat: TrpcProcedure<ServerHeartbeatPayload, ServerHeartbeatInfo>;
  };
  fixtures: {
    has: TrpcProcedure<
      { descriptor: FixtureDescriptor },
      { exists: boolean; sentinel: RootSentinel }
    >;
    read: TrpcProcedure<
      { descriptor: FixtureDescriptor },
      ServerFixtureReadResult
    >;
    writeIfAbsent: TrpcProcedure<
      WriteFixtureIfAbsentPayload,
      {
        written: boolean;
        descriptor: FixtureDescriptor;
        sentinel: RootSentinel;
      }
    >;
    generateContext: TrpcProcedure<GenerateContextPayload, { ok: true }>;
  };
  config: {
    readConfiguredSiteConfigs: TrpcProcedure<void, TrpcSiteConfigsInfo>;
    readEffectiveSiteConfigs: TrpcProcedure<void, TrpcSiteConfigsInfo>;
    writeConfiguredSiteConfigs: TrpcProcedure<
      { siteConfigs: SiteConfig[] },
      TrpcSiteConfigsInfo
    >;
  };
  scenarioTraces: {
    recordClick: TrpcProcedure<
      RecordTraceClickPayload,
      {
        recorded: boolean;
        activeTrace: ServerScenarioTraceRecord | null;
      }
    >;
    linkFixture: TrpcProcedure<
      LinkTraceFixturePayload,
      {
        linked: boolean;
        trace: ServerScenarioTraceRecord | null;
      }
    >;
  };
}

export function bindWraithWalkerServerClient(
  trpc: WraithWalkerServerTrpcClient
): WraithWalkerServerClient {
  return {
    getSystemInfo() {
      return trpc.system.info.query();
    },
    revealRoot() {
      return trpc.system.revealRoot.mutate();
    },
    listScenarios() {
      return trpc.scenarios.list.query();
    },
    saveScenario(name, description) {
      return trpc.scenarios.save.mutate({
        name,
        ...(description ? { description } : {})
      });
    },
    switchScenario(name) {
      return trpc.scenarios.switch.mutate({
        name
      });
    },
    diffScenarios(scenarioA, scenarioB) {
      return trpc.scenarios.diff.query({
        scenarioA,
        scenarioB
      });
    },
    saveScenarioFromTrace(name, description) {
      return trpc.scenarios.saveFromTrace.mutate({
        name,
        ...(description ? { description } : {})
      });
    },
    heartbeat(payload) {
      return trpc.extension.heartbeat.mutate(payload);
    },
    hasFixture(descriptor) {
      return trpc.fixtures.has.query({ descriptor });
    },
    readConfiguredSiteConfigs() {
      return trpc.config.readConfiguredSiteConfigs.query();
    },
    readEffectiveSiteConfigs() {
      return trpc.config.readEffectiveSiteConfigs.query();
    },
    writeConfiguredSiteConfigs(siteConfigs) {
      return trpc.config.writeConfiguredSiteConfigs.mutate({
        siteConfigs
      });
    },
    readFixture(descriptor) {
      return trpc.fixtures.read.query({
        descriptor
      });
    },
    writeFixtureIfAbsent(payload) {
      return trpc.fixtures.writeIfAbsent.mutate(payload);
    },
    generateContext(payload) {
      return trpc.fixtures.generateContext.mutate(payload);
    },
    recordTraceClick(payload) {
      return trpc.scenarioTraces.recordClick.mutate(payload);
    },
    linkTraceFixture(payload) {
      return trpc.scenarioTraces.linkFixture.mutate(payload);
    }
  };
}

function resolveFixtureStreamUrl(trpcUrl: string): string {
  const url = new URL(trpcUrl);
  url.pathname = WRAITHWALKER_SERVER_FIXTURE_STREAM_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function estimateUtf8ByteLength(value: string): number {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }

    if (bytes >= WRAITHWALKER_SERVER_STREAM_UPLOAD_THRESHOLD_BYTES) {
      return bytes;
    }
  }

  return bytes;
}

function estimateFixtureBodyBytes(
  payload: WriteFixtureIfAbsentPayload
): number {
  if (payload.response.bodyEncoding === "base64") {
    return Math.floor((payload.response.body.length * 3) / 4);
  }

  return estimateUtf8ByteLength(payload.response.body);
}

function shouldStreamFixtureWrite(
  payload: WriteFixtureIfAbsentPayload
): boolean {
  return (
    estimateFixtureBodyBytes(payload) >=
    WRAITHWALKER_SERVER_STREAM_UPLOAD_THRESHOLD_BYTES
  );
}

function decodeBase64Chunk(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function nextBase64ChunkEnd(value: string, offset: number): number {
  const chunkSize = 64 * 1024;
  let end = Math.min(value.length, offset + chunkSize);
  if (end < value.length) {
    end -= (end - offset) % 4;
  }

  return end > offset ? end : value.length;
}

function nextUtf8ChunkEnd(value: string, offset: number): number {
  const chunkSize = 64 * 1024;
  let end = Math.min(value.length, offset + chunkSize);
  if (end < value.length) {
    const lastCodeUnit = value.charCodeAt(end - 1);
    if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
      end -= 1;
    }
  }

  return end > offset ? end : value.length;
}

function createFixtureUploadStream(
  payload: WriteFixtureIfAbsentPayload
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const envelope = {
    descriptor: payload.descriptor,
    request: payload.request,
    response: {
      bodyEncoding: payload.response.bodyEncoding,
      meta: payload.response.meta
    }
  };
  const envelopeBytes = encoder.encode(`${JSON.stringify(envelope)}\n`);
  let sentEnvelope = false;
  let bodyOffset = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sentEnvelope) {
        sentEnvelope = true;
        controller.enqueue(envelopeBytes);
        return;
      }

      const body = payload.response.body;
      if (bodyOffset >= body.length) {
        controller.close();
        return;
      }

      const end =
        payload.response.bodyEncoding === "base64"
          ? nextBase64ChunkEnd(body, bodyOffset)
          : nextUtf8ChunkEnd(body, bodyOffset);
      const chunk = body.slice(bodyOffset, end);
      bodyOffset = end;
      controller.enqueue(
        payload.response.bodyEncoding === "base64"
          ? decodeBase64Chunk(chunk)
          : encoder.encode(chunk)
      );
    }
  });
}

async function readFixtureStreamError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return `Fixture upload failed with HTTP ${response.status}.`;
  }

  try {
    const payload = JSON.parse(text) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error) {
      return payload.error;
    }
  } catch {
    // Fall through to the raw response text.
  }

  return text;
}

async function writeFixtureIfAbsentViaStream(
  trpcUrl: string,
  payload: WriteFixtureIfAbsentPayload,
  fetchImpl: typeof fetch
): ReturnType<WraithWalkerServerClient["writeFixtureIfAbsent"]> {
  const response = await fetchImpl(resolveFixtureStreamUrl(trpcUrl), {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-trpc-source": WRAITHWALKER_SERVER_SOURCE_HEADER
    },
    body: createFixtureUploadStream(payload),
    duplex: "half"
  } as RequestInit & { duplex: "half" });

  if (!response.ok) {
    throw new Error(await readFixtureStreamError(response));
  }

  return (await response.json()) as Awaited<
    ReturnType<WraithWalkerServerClient["writeFixtureIfAbsent"]>
  >;
}

export function createWraithWalkerServerClient(
  url = DEFAULT_WRAITHWALKER_SERVER_TRPC_URL,
  { timeoutMs, fetchImpl }: WraithWalkerServerClientOptions = {}
): WraithWalkerServerClient {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink(
        createWraithWalkerServerTransportOptions(url, {
          timeoutMs,
          fetchImpl
        })
      )
    ]
  }) as unknown as WraithWalkerServerTrpcClient;

  const trpcClient = bindWraithWalkerServerClient(trpc);
  const timedFetch = createTimedFetch(timeoutMs, fetchImpl);

  return {
    ...trpcClient,
    writeFixtureIfAbsent(payload) {
      if (shouldStreamFixtureWrite(payload)) {
        return writeFixtureIfAbsentViaStream(url, payload, timedFetch);
      }

      return trpcClient.writeFixtureIfAbsent(payload);
    }
  };
}
