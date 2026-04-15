import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter, TrpcSystemInfo } from "@wraithwalker/mcp-server/trpc";

import {
  DEFAULT_WRAITHWALKER_SERVER_TRPC_URL,
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
import { createWraithWalkerServerTransportOptions } from "./wraithwalker-server.transport.js";
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

  return bindWraithWalkerServerClient(trpc);
}
