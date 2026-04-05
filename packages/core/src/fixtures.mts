import { promises as fs } from "node:fs";
import path from "node:path";

import { SCENARIOS_DIR, SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE, STATIC_RESOURCE_MANIFEST_FILE } from "./constants.mjs";

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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function listDirectoriesIn(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function collectApiEndpoints(rootPath: string, baseRelativePath: string): Promise<ApiEndpoint[]> {
  const endpoints: ApiEndpoint[] = [];
  const httpDir = path.join(rootPath, baseRelativePath, "http");
  const methods = await listDirectoriesIn(httpDir);

  for (const method of methods) {
    const fixtures = await listDirectoriesIn(path.join(httpDir, method));
    for (const fixture of fixtures) {
      const fixtureDir = path.join(httpDir, method, fixture);
      const metaPath = path.join(fixtureDir, "response.meta.json");
      const meta = await readJsonSafe<ResponseMeta>(metaPath);
      if (!meta) continue;

      const pathname = meta.url
        ? new URL(meta.url).pathname
        : fixture.replace(/__q-.*/, "").replace(/-/g, "/");

      endpoints.push({
        method,
        pathname,
        status: meta.status,
        mimeType: meta.mimeType || "",
        fixtureDir: path.join(baseRelativePath, "http", method, fixture)
      });
    }
  }

  return endpoints;
}

export async function readOriginInfo(rootPath: string, siteConfig: SiteConfigLike): Promise<OriginInfo> {
  const originKey = originToKey(siteConfig.origin);
  const isSimple = siteConfig.mode === "simple";

  const manifestRelative = isSimple
    ? path.join(SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE, originKey, STATIC_RESOURCE_MANIFEST_FILE)
    : path.join(originKey, STATIC_RESOURCE_MANIFEST_FILE);
  const manifestAbsolute = path.join(rootPath, manifestRelative);
  const manifest = await readJsonSafe<StaticResourceManifest>(manifestAbsolute);

  const originsBaseRelative = isSimple
    ? path.join(rootPath, SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE, originKey, "origins")
    : path.join(rootPath, originKey, "origins");

  const apiEndpoints: ApiEndpoint[] = [];
  const originDirs = await listDirectoriesIn(originsBaseRelative);
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
    manifestPath: (await fileExists(manifestAbsolute)) ? manifestRelative : null,
    manifest,
    apiEndpoints
  };
}

export async function readFixtureBody(rootPath: string, relativePath: string): Promise<string | null> {
  const absolute = path.join(rootPath, relativePath);
  try {
    return await fs.readFile(absolute, "utf8");
  } catch {
    return null;
  }
}

export async function readSiteConfigs(rootPath: string): Promise<SiteConfigLike[]> {
  const simpleOriginsDir = path.join(rootPath, SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE);
  const simpleOrigins = await listDirectoriesIn(simpleOriginsDir);

  const configs: SiteConfigLike[] = [];
  for (const originKey of simpleOrigins) {
    configs.push({ origin: keyToOrigin(originKey), mode: "simple" });
  }

  try {
    const topEntries = await fs.readdir(rootPath, { withFileTypes: true });
    for (const entry of topEntries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === path.dirname(SCENARIOS_DIR)) continue;
      if (!entry.name.startsWith("http")) continue;
      const origin = keyToOrigin(entry.name);
      if (!configs.some((config) => config.origin === origin)) {
        configs.push({ origin, mode: "advanced" });
      }
    }
  } catch {
    // Root path may not exist yet.
  }

  return configs;
}
