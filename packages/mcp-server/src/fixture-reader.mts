import { promises as fs } from "node:fs";
import path from "node:path";

const SIMPLE_METADATA_DIR = ".wraithwalker";
const SIMPLE_METADATA_TREE = "simple";
const MANIFEST_FILE = "RESOURCE_MANIFEST.json";
const SCENARIOS_DIR = path.join(".wraithwalker", "scenarios");

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

export interface OriginInfo {
  origin: string;
  originKey: string;
  mode: "simple" | "advanced";
  manifestPath: string | null;
  manifest: StaticResourceManifest | null;
  apiEndpoints: ApiEndpoint[];
}

export interface SiteConfigLike {
  origin: string;
  mode: "simple" | "advanced";
}

function originToKey(origin: string): string {
  return origin.replace(/:/g, "__").replace(/\//g, "");
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
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function collectApiEndpoints(basePath: string): Promise<ApiEndpoint[]> {
  const endpoints: ApiEndpoint[] = [];
  const httpDir = path.join(basePath, "http");
  const methods = await listDirectoriesIn(httpDir);

  for (const method of methods) {
    const fixtures = await listDirectoriesIn(path.join(httpDir, method));
    for (const fixture of fixtures) {
      const fixtureDir = path.join(httpDir, method, fixture);
      const metaPath = path.join(fixtureDir, "response.meta.json");
      const meta = await readJsonSafe<ResponseMeta>(metaPath);
      if (!meta) continue;

      const pathname = meta.url ? new URL(meta.url).pathname : fixture.replace(/__q-.*/, "").replace(/-/g, "/");

      endpoints.push({
        method,
        pathname,
        status: meta.status,
        mimeType: meta.mimeType || "",
        fixtureDir
      });
    }
  }

  return endpoints;
}

export async function readOriginInfo(rootPath: string, siteConfig: SiteConfigLike): Promise<OriginInfo> {
  const originKey = originToKey(siteConfig.origin);
  const isSimple = siteConfig.mode === "simple";

  const manifestRelative = isSimple
    ? path.join(SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE, originKey, MANIFEST_FILE)
    : path.join(originKey, MANIFEST_FILE);

  const manifestAbsolute = path.join(rootPath, manifestRelative);
  const manifest = await readJsonSafe<StaticResourceManifest>(manifestAbsolute);

  const originsBase = isSimple
    ? path.join(rootPath, SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE, originKey, "origins")
    : path.join(rootPath, originKey, "origins");

  const apiEndpoints: ApiEndpoint[] = [];

  const originDirs = await listDirectoriesIn(originsBase);
  for (const dir of originDirs) {
    const eps = await collectApiEndpoints(path.join(originsBase, dir));
    apiEndpoints.push(...eps);
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

export async function listScenarios(rootPath: string): Promise<string[]> {
  const scenariosBase = path.join(rootPath, SCENARIOS_DIR);
  return listDirectoriesIn(scenariosBase);
}

export async function readSiteConfigs(rootPath: string): Promise<SiteConfigLike[]> {
  // Read from the .wraithwalker directory to discover configured origins
  // Check for simple-mode origins first
  const simpleOriginsDir = path.join(rootPath, SIMPLE_METADATA_DIR, SIMPLE_METADATA_TREE);
  const simpleOrigins = await listDirectoriesIn(simpleOriginsDir);

  const configs: SiteConfigLike[] = [];

  for (const originKey of simpleOrigins) {
    const origin = originKey.replace(/__/g, "://").replace(/^(https?)\/\//, "$1://");
    configs.push({ origin, mode: "simple" });
  }

  // Check for advanced-mode origins (top-level directories starting with http)
  try {
    const topEntries = await fs.readdir(rootPath, { withFileTypes: true });
    for (const entry of topEntries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (entry.name.startsWith("http")) {
        const origin = entry.name.replace(/__/g, "://").replace(/^(https?)\/\//, "$1://");
        if (!configs.some((c) => c.origin === origin)) {
          configs.push({ origin, mode: "advanced" });
        }
      }
    }
  } catch {
    // Root might not exist
  }

  return configs;
}
