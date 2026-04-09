import { initTRPC } from "@trpc/server";
import {
  type FixtureDescriptor,
  type RequestPayload,
  type ResponseMeta
} from "@wraithwalker/core/fixture-layout";
import type { SiteConfig } from "@wraithwalker/core/site-config";
import type { SiteConfigLike } from "@wraithwalker/core/fixtures";
import type { ScenarioTraceRecord } from "@wraithwalker/core/scenario-traces";
import type { RootSentinel } from "@wraithwalker/core/root";
import { z } from "zod";

import type { ExtensionStatus } from "./extension-session.mjs";
import { createServerRootRuntime } from "./root-runtime.mjs";
import { revealRootDirectory } from "./root-reveal.mjs";

export const HTTP_TRPC_PATH = "/trpc";

export const headerEntrySchema = z.object({
  name: z.string(),
  value: z.string()
});

const fixtureDescriptorBaseSchema = z.object({
  topOrigin: z.string(),
  topOriginKey: z.string(),
  requestOrigin: z.string(),
  requestOriginKey: z.string(),
  requestUrl: z.string(),
  method: z.string(),
  postDataEncoding: z.string(),
  queryHash: z.string(),
  bodyHash: z.string(),
  bodyPath: z.string(),
  projectionPath: z.string().nullable().optional(),
  requestPath: z.string(),
  metaPath: z.string(),
  manifestPath: z.string().nullable(),
  metadataOptional: z.boolean(),
  slug: z.string()
});

const assetFixtureDescriptorSchema = fixtureDescriptorBaseSchema.extend({
  assetLike: z.literal(true),
  storageMode: z.literal("asset")
});

const apiFixtureDescriptorSchema = fixtureDescriptorBaseSchema.extend({
  assetLike: z.literal(false),
  storageMode: z.literal("api"),
  directory: z.string()
});

export const fixtureDescriptorSchema = z.union([
  assetFixtureDescriptorSchema,
  apiFixtureDescriptorSchema
]);

export const requestPayloadSchema = z.object({
  topOrigin: z.string(),
  url: z.string(),
  method: z.string(),
  headers: z.array(headerEntrySchema),
  body: z.string(),
  bodyEncoding: z.string(),
  bodyHash: z.string(),
  queryHash: z.string(),
  capturedAt: z.string()
});

export const responseMetaSchema = z.object({
  status: z.number(),
  statusText: z.string(),
  headers: z.array(headerEntrySchema),
  mimeType: z.string(),
  resourceType: z.string(),
  url: z.string(),
  method: z.string(),
  capturedAt: z.string(),
  bodyEncoding: z.string(),
  bodySuggestedExtension: z.string()
});

export const fixtureResponsePayloadSchema = z.object({
  body: z.string(),
  bodyEncoding: z.union([z.literal("utf8"), z.literal("base64")]),
  meta: responseMetaSchema
});

export const rootSentinelSchema = z.object({
  rootId: z.string(),
  schemaVersion: z.number().optional(),
  createdAt: z.string().optional()
});

export const siteConfigSchema = z.object({
  origin: z.string(),
  createdAt: z.string(),
  dumpAllowlistPatterns: z.array(z.string())
});

export interface TrpcSystemInfo {
  serverName: string;
  serverVersion: string;
  rootPath: string;
  sentinel: RootSentinel;
  baseUrl: string;
  mcpUrl: string;
  trpcUrl: string;
  siteConfigs: SiteConfig[];
}

export interface TrpcHeartbeatInfo extends TrpcSystemInfo {
  activeTrace: ScenarioTraceRecord | null;
}

export interface TrpcSiteConfigsInfo {
  siteConfigs: SiteConfig[];
  sentinel: RootSentinel;
}

export interface CreateWraithwalkerRouterDependencies {
  rootPath: string;
  sentinel: RootSentinel;
  serverName: string;
  serverVersion: string;
  runtime?: ReturnType<typeof createServerRootRuntime>;
  extensionSessions: {
    heartbeat(input: {
      clientId: string;
      extensionVersion: string;
      sessionActive: boolean;
      enabledOrigins: string[];
    }): Promise<ExtensionStatus>;
  };
  getServerUrls: () => {
    baseUrl: string;
    mcpUrl: string;
    trpcUrl: string;
  };
  getSiteConfigs?: () => Promise<SiteConfig[]>;
  revealRoot?: () => Promise<{ ok: true; command: string }>;
}

const t = initTRPC.create();

export function createWraithwalkerRouter({
  rootPath,
  sentinel,
  serverName,
  serverVersion,
  runtime = createServerRootRuntime({ rootPath, sentinel }),
  extensionSessions,
  getServerUrls,
  getSiteConfigs = () => runtime.readEffectiveSiteConfigs(),
  revealRoot = () => revealRootDirectory({ rootPath, expectedRootId: sentinel.rootId })
}: CreateWraithwalkerRouterDependencies) {
  return t.router({
    system: t.router({
      info: t.procedure.query(async (): Promise<TrpcSystemInfo> => ({
        serverName,
        serverVersion,
        rootPath,
        sentinel,
        siteConfigs: await getSiteConfigs(),
        ...getServerUrls()
      })),
      revealRoot: t.procedure.mutation(async () => revealRoot())
    }),
    extension: t.router({
      heartbeat: t.procedure
        .input(z.object({
          clientId: z.string().min(1),
          extensionVersion: z.string().min(1),
          sessionActive: z.boolean(),
          enabledOrigins: z.array(z.string())
        }))
        .mutation(async ({ input }): Promise<TrpcHeartbeatInfo> => {
          const status = await extensionSessions.heartbeat(input);
          return {
            serverName,
            serverVersion,
            rootPath,
            sentinel,
            siteConfigs: status.siteConfigs,
            ...getServerUrls(),
            activeTrace: status.activeTrace
          };
        })
    }),
    config: t.router({
      readConfiguredSiteConfigs: t.procedure
        .query(async (): Promise<TrpcSiteConfigsInfo> => ({
          siteConfigs: await runtime.readConfiguredSiteConfigs(),
          sentinel
        })),
      readEffectiveSiteConfigs: t.procedure
        .query(async (): Promise<TrpcSiteConfigsInfo> => ({
          siteConfigs: await runtime.readEffectiveSiteConfigs(),
          sentinel
        })),
      writeConfiguredSiteConfigs: t.procedure
        .input(z.object({
          siteConfigs: z.array(siteConfigSchema)
        }))
        .mutation(async ({ input }): Promise<TrpcSiteConfigsInfo> => {
          await runtime.writeConfiguredSiteConfigs(input.siteConfigs as SiteConfig[]);
          return {
            siteConfigs: await runtime.readConfiguredSiteConfigs(),
            sentinel
          };
        })
    }),
    fixtures: t.router({
      has: t.procedure
        .input(z.object({ descriptor: fixtureDescriptorSchema }))
        .query(async ({ input }) => ({
          exists: await runtime.has(input.descriptor as FixtureDescriptor),
          sentinel
        })),
      read: t.procedure
        .input(z.object({ descriptor: fixtureDescriptorSchema }))
        .query(async ({ input }) => {
          const fixture = await runtime.read(input.descriptor as FixtureDescriptor);
          if (!fixture) {
            return {
              exists: false as const,
              sentinel
            };
          }

          return {
            exists: true as const,
            request: fixture.request,
            meta: fixture.meta,
            bodyBase64: fixture.bodyBase64,
            size: fixture.size,
            sentinel
          };
        }),
      writeIfAbsent: t.procedure
        .input(z.object({
          descriptor: fixtureDescriptorSchema,
          request: requestPayloadSchema,
          response: fixtureResponsePayloadSchema
        }))
        .mutation(async ({ input }) => runtime.writeIfAbsent({
          descriptor: input.descriptor as FixtureDescriptor,
          request: input.request as RequestPayload,
          response: input.response as { body: string; bodyEncoding: "utf8" | "base64"; meta: ResponseMeta }
        })),
      generateContext: t.procedure
        .input(z.object({
          siteConfigs: z.array(siteConfigSchema),
          editorId: z.string().optional()
        }))
        .mutation(async ({ input }) => {
          await runtime.generateContext({
            editorId: input.editorId,
            siteConfigs: input.siteConfigs as SiteConfigLike[]
          });
          return { ok: true as const };
        })
    }),
    scenarioTraces: t.router({
      recordClick: t.procedure
        .input(z.object({
          traceId: z.string(),
          step: z.object({
            stepId: z.string(),
            tabId: z.number().int().nonnegative(),
            recordedAt: z.string(),
            pageUrl: z.string(),
            topOrigin: z.string(),
            selector: z.string(),
            tagName: z.string(),
            textSnippet: z.string(),
            role: z.string().optional(),
            ariaLabel: z.string().optional(),
            href: z.string().optional()
          })
        }))
        .mutation(async ({ input }) => {
          const trace = await runtime.recordClick({
            traceId: input.traceId,
            step: input.step
          });
          return {
            recorded: Boolean(trace),
            activeTrace: trace
          };
        }),
      linkFixture: t.procedure
        .input(z.object({
          traceId: z.string(),
          tabId: z.number().int().nonnegative(),
          requestedAt: z.string(),
          fixture: z.object({
            bodyPath: z.string(),
            requestUrl: z.string(),
            resourceType: z.string(),
            capturedAt: z.string()
          })
        }))
        .mutation(async ({ input }) => runtime.linkFixture(input))
    })
  });
}

export type AppRouter = ReturnType<typeof createWraithwalkerRouter>;
