import { initTRPC } from "@trpc/server";
import {
  type FixtureDescriptor,
  type HeaderEntry,
  type RequestPayload,
  type ResponseMeta
} from "@wraithwalker/core/fixture-layout";
import { generateContext } from "@wraithwalker/core/context";
import type { SiteConfigLike } from "@wraithwalker/core/fixtures";
import type { RootSentinel } from "@wraithwalker/core/root";
import { createFixtureRootFs } from "@wraithwalker/core/root-fs";
import { z } from "zod";

import { createFixtureRepository } from "./fixture-repository.mjs";

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
  siteMode: z.union([z.literal("simple"), z.literal("advanced")]),
  postDataEncoding: z.string(),
  queryHash: z.string(),
  bodyHash: z.string(),
  bodyPath: z.string(),
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
  mode: z.union([z.literal("simple"), z.literal("advanced")]),
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
}

export interface CreateWraithwalkerRouterDependencies {
  rootPath: string;
  sentinel: RootSentinel;
  serverName: string;
  serverVersion: string;
  getServerUrls: () => {
    baseUrl: string;
    mcpUrl: string;
    trpcUrl: string;
  };
}

const t = initTRPC.create();

export function createWraithwalkerRouter({
  rootPath,
  sentinel,
  serverName,
  serverVersion,
  getServerUrls
}: CreateWraithwalkerRouterDependencies) {
  const rootFs = createFixtureRootFs(rootPath);
  const repository = createFixtureRepository({ rootPath, sentinel, rootFs });
  const contextGateway = {
    readText: async (_nextRootPath: string, relativePath: string) =>
      rootFs.readText(relativePath),
    writeText: async (_nextRootPath: string, relativePath: string, content: string) =>
      rootFs.writeText(relativePath, content)
  };

  return t.router({
    system: t.router({
      info: t.procedure.query((): TrpcSystemInfo => ({
        serverName,
        serverVersion,
        rootPath,
        sentinel,
        ...getServerUrls()
      }))
    }),
    fixtures: t.router({
      has: t.procedure
        .input(z.object({ descriptor: fixtureDescriptorSchema }))
        .query(async ({ input }) => ({
          exists: await repository.exists(input.descriptor as FixtureDescriptor),
          sentinel
        })),
      read: t.procedure
        .input(z.object({ descriptor: fixtureDescriptorSchema }))
        .query(async ({ input }) => {
          const fixture = await repository.read(input.descriptor as FixtureDescriptor);
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
        .mutation(async ({ input }) => repository.writeIfAbsent({
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
          await generateContext(rootPath, contextGateway, input.editorId, input.siteConfigs as SiteConfigLike[]);
          return { ok: true as const };
        })
    })
  });
}

export type AppRouter = ReturnType<typeof createWraithwalkerRouter>;
