import path from "node:path";

import { SCENARIOS_DIR, SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE, STATIC_RESOURCE_MANIFEST_FILE } from "./constants.mjs";
import { createFixtureRootFs, resolveWithinRoot } from "./root-fs.mjs";

export interface StaticResourceManifestEntry {
  requestUrl: string;
  requestOrigin: string;
  pathname: string;
  search: string;
  bodyPath: string;
  requestPath: string;
  metaPath: string;
  mimeType: string;
  resourceType: string;
  capturedAt: string;
}

export interface StaticResourceManifest {
  schemaVersion: number;
  topOrigin: string;
  topOriginKey: string;
  generatedAt: string;
  resourcesByPathname: Record<string, StaticResourceManifestEntry[]>;
}

export interface ResponseMeta {
  status: number;
  statusText: string;
  mimeType: string;
  resourceType: string;
  url: string;
  method: string;
  capturedAt: string;
}

export interface ApiEndpoint {
  method: string;
  pathname: string;
  status: number;
  mimeType: string;
  fixtureDir: string;
  metaPath: string;
  bodyPath: string;
}

export interface SiteConfigLike {
  origin: string;
  mode: "simple" | "advanced";
}

export interface OriginInfo {
  origin: string;
  originKey: string;
  mode: "simple" | "advanced";
  manifestPath: string | null;
  manifest: StaticResourceManifest | null;
  apiEndpoints: ApiEndpoint[];
}

export interface ApiFixture {
  fixtureDir: string;
  metaPath: string;
  bodyPath: string;
  meta: ResponseMeta;
  body: string | null;
}

function originToKey(origin: string): string {
  const url = new URL(origin);
  const protocol = url.protocol.replace(":", "");
  const port = url.port ? `__${url.port}` : "";
  return `${protocol}__${url.hostname}${port}`;
}

function keyToOrigin(key: string): string {
  const match = key.match(/^(https?)__([^_](?:[^_]|_(?!_))*)(?:__(\d+))?$/);
  if (!match) return key;
  const [, protocol, hostname, port] = match;
  return port ? `${protocol}://${hostname}:${port}` : `${protocol}://${hostname}`;
}

async function collectApiEndpoints(rootPath: string, baseRelativePath: string): Promise<ApiEndpoint[]> {
  const rootFs = createFixtureRootFs(rootPath);
  const endpoints: ApiEndpoint[] = [];
  const methods = await rootFs.listOptionalDirectories(path.join(baseRelativePath, "http"));

  for (const method of methods) {
    const fixtures = await rootFs.listOptionalDirectories(path.join(baseRelativePath, "http", method));
    for (const fixture of fixtures) {
      const fixtureRelativeDir = path.join(baseRelativePath, "http", method, fixture);
      const meta = await rootFs.readOptionalJson<ResponseMeta>(path.join(fixtureRelativeDir, "response.meta.json"));
      if (!meta) continue;

      const pathname = meta.url
        ? new URL(meta.url).pathname
        : fixture.replace(/__q-.*/, "").replace(/-/g, "/");

      endpoints.push({
        method,
        pathname,
        status: meta.status,
        mimeType: meta.mimeType || "",
        fixtureDir: fixtureRelativeDir,
        metaPath: path.join(fixtureRelativeDir, "response.meta.json"),
        bodyPath: path.join(fixtureRelativeDir, "response.body")
      });
    }
  }

  return endpoints;
}

export async function readOriginInfo(rootPath: string, siteConfig: SiteConfigLike): Promise<OriginInfo> {
  const rootFs = createFixtureRootFs(rootPath);
  const originKey = originToKey(siteConfig.origin);
  const isSimple = siteConfig.mode === "simple";

  const manifestRelative = isSimple
    ? path.join(SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE, originKey, STATIC_RESOURCE_MANIFEST_FILE)
    : path.join(originKey, STATIC_RESOURCE_MANIFEST_FILE);
  const manifest = await rootFs.readOptionalJson<StaticResourceManifest>(manifestRelative);

  const originsBaseRelative = isSimple
    ? path.join(SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE, originKey, "origins")
    : path.join(originKey, "origins");

  const apiEndpoints: ApiEndpoint[] = [];
  const originDirs = await rootFs.listOptionalDirectories(originsBaseRelative);
  for (const dir of originDirs) {
    const relativeBasePath = isSimple
      ? path.join(SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE, originKey, "origins", dir)
      : path.join(originKey, "origins", dir);
    const endpoints = await collectApiEndpoints(rootPath, relativeBasePath);
    apiEndpoints.push(...endpoints);
  }

  return {
    origin: siteConfig.origin,
    originKey,
    mode: siteConfig.mode,
    manifestPath: (await rootFs.exists(manifestRelative)) ? manifestRelative : null,
    manifest,
    apiEndpoints
  };
}

export function resolveFixturePath(rootPath: string, relativePath: string): string | null {
  return resolveWithinRoot(rootPath, relativePath);
}

export async function readFixtureBody(rootPath: string, relativePath: string): Promise<string | null> {
  return createFixtureRootFs(rootPath).readOptionalText(relativePath);
}

export async function readApiFixture(rootPath: string, fixtureDir: string): Promise<ApiFixture | null> {
  const rootFs = createFixtureRootFs(rootPath);
  const metaPath = path.join(fixtureDir, "response.meta.json");
  const bodyPath = path.join(fixtureDir, "response.body");

  if (!rootFs.resolve(metaPath) || !rootFs.resolve(bodyPath)) {
    return null;
  }

  const meta = await rootFs.readOptionalJson<ResponseMeta>(metaPath);
  if (!meta) {
    return null;
  }

  return {
    fixtureDir,
    metaPath,
    bodyPath,
    meta,
    body: await rootFs.readOptionalText(bodyPath)
  };
}

export async function readSiteConfigs(rootPath: string): Promise<SiteConfigLike[]> {
  const rootFs = createFixtureRootFs(rootPath);
  const simpleOrigins = await rootFs.listOptionalDirectories(path.join(SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE));

  const configs: SiteConfigLike[] = [];
  for (const originKey of simpleOrigins) {
    configs.push({ origin: keyToOrigin(originKey), mode: "simple" });
  }

  const topEntries = await rootFs.listOptionalDirectory("");
  for (const entry of topEntries) {
    if (entry.kind !== "directory") continue;
    if (entry.name === path.dirname(SCENARIOS_DIR)) continue;
    if (!entry.name.startsWith("http")) continue;
    const origin = keyToOrigin(entry.name);
    if (!configs.some((config) => config.origin === origin)) {
      configs.push({ origin, mode: "advanced" });
    }
  }

  return configs;
}
