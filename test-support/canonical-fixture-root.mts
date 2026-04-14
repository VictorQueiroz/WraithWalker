import type {
  AssetFixtureDescriptor,
  FixtureDescriptor,
  ResponseMeta
} from "../packages/core/src/fixture-layout.mts";
import {
  buildRequestPayload,
  buildResponseMeta,
  createFixtureDescriptor,
  createStaticResourceManifest,
  createStaticResourceManifestEntry,
  upsertStaticResourceManifest
} from "../packages/core/src/fixture-layout.mts";
import { writeConfiguredSiteConfigs } from "../packages/core/src/project-config.mts";
import {
  createWraithwalkerFixtureRoot,
  type CreateFixtureRootOptions,
  type WraithwalkerFixtureRoot
} from "./wraithwalker-fixture-root.mts";

const CAPTURED_AT = "2026-04-14T00:00:00.000Z";

export interface CanonicalFixtureRoot {
  root: WraithwalkerFixtureRoot;
  siteConfig: {
    origin: string;
    createdAt: string;
    dumpAllowlistPatterns: string[];
  };
  assetDescriptor: AssetFixtureDescriptor;
  assetBody: string;
  assetMeta: ResponseMeta;
  apiDescriptor: FixtureDescriptor;
  apiBody: string;
  scenarioName: string;
}

export async function createCanonicalFixtureRoot(
  options: CreateFixtureRootOptions = {}
): Promise<CanonicalFixtureRoot> {
  const root = await createWraithwalkerFixtureRoot({
    prefix: options.prefix ?? "wraithwalker-canonical-",
    rootId: options.rootId ?? "root-canonical",
    ...options
  });
  const siteConfig = {
    origin: "https://app.example.com",
    createdAt: CAPTURED_AT,
    dumpAllowlistPatterns: ["\\.js$", "\\.css$", "\\.json$"]
  };
  const assetBody = "console.log('canonical asset');\n";
  const apiBody = JSON.stringify(
    {
      items: [{ id: 1, slug: "canonical-item" }]
    },
    null,
    2
  );
  const scenarioName = "baseline";

  await writeConfiguredSiteConfigs(root.rootPath, [siteConfig]);

  const assetDescriptor = (await createFixtureDescriptor({
    topOrigin: siteConfig.origin,
    method: "GET",
    url: "https://cdn.example.com/assets/app.js",
    resourceType: "Script",
    mimeType: "application/javascript"
  })) as AssetFixtureDescriptor;
  const assetMeta = buildResponseMeta(
    {
      responseStatus: 200,
      responseStatusText: "OK",
      responseHeaders: [
        { name: "Content-Type", value: "application/javascript" },
        { name: "Cache-Control", value: "max-age=60" }
      ],
      mimeType: "application/javascript",
      resourceType: "Script",
      url: assetDescriptor.requestUrl,
      method: assetDescriptor.method
    },
    "utf8",
    CAPTURED_AT
  );
  const assetRequest = buildRequestPayload(
    {
      topOrigin: siteConfig.origin,
      url: assetDescriptor.requestUrl,
      method: assetDescriptor.method,
      requestHeaders: [{ name: "Accept", value: "*/*" }],
      requestBody: "",
      requestBodyEncoding: "utf8",
      descriptor: assetDescriptor
    },
    CAPTURED_AT
  );
  const assetManifest = upsertStaticResourceManifest(
    createStaticResourceManifest(assetDescriptor),
    createStaticResourceManifestEntry(assetDescriptor, assetMeta)
  );

  await root.writeJson(assetDescriptor.requestPath, assetRequest);
  await root.writeJson(assetDescriptor.metaPath, assetMeta);
  await root.writeText(assetDescriptor.bodyPath, assetBody);
  await root.writeText(
    assetDescriptor.projectionPath ?? assetDescriptor.bodyPath,
    assetBody
  );
  if (!assetDescriptor.manifestPath) {
    throw new Error("Canonical asset descriptor must include a manifest path.");
  }
  await root.writeJson(assetDescriptor.manifestPath, assetManifest);

  const apiDescriptor = await createFixtureDescriptor({
    topOrigin: siteConfig.origin,
    method: "GET",
    url: "https://api.example.com/v1/items",
    resourceType: "Fetch",
    mimeType: "application/json"
  });
  const apiMeta = buildResponseMeta(
    {
      responseStatus: 200,
      responseStatusText: "OK",
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      mimeType: "application/json",
      resourceType: "Fetch",
      url: apiDescriptor.requestUrl,
      method: apiDescriptor.method
    },
    "utf8",
    CAPTURED_AT
  );
  const apiRequest = buildRequestPayload(
    {
      topOrigin: siteConfig.origin,
      url: apiDescriptor.requestUrl,
      method: apiDescriptor.method,
      requestHeaders: [{ name: "Accept", value: "application/json" }],
      requestBody: "",
      requestBodyEncoding: "utf8",
      descriptor: apiDescriptor
    },
    CAPTURED_AT
  );

  await root.writeJson(apiDescriptor.requestPath, apiRequest);
  await root.writeJson(apiDescriptor.metaPath, apiMeta);
  await root.writeText(apiDescriptor.bodyPath, apiBody);

  return {
    root,
    siteConfig,
    assetDescriptor,
    assetBody,
    assetMeta,
    apiDescriptor,
    apiBody,
    scenarioName
  };
}
