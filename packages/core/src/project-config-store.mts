import {
  CAPTURE_HTTP_DIR,
  MANIFESTS_DIR,
  PROJECT_CONFIG_RELATIVE_PATH,
  PROJECT_CONFIG_SCHEMA_VERSION
} from "./constants.mjs";
import { normalizeSiteInput } from "./fixture-layout.mjs";
import {
  createDiscoveredSiteConfig,
  mergeSiteConfigs,
  normalizeSiteConfigs,
  type SiteConfig
} from "./site-config.mjs";

export interface ProjectConfigStorage<TRoot> {
  readOptionalJson(root: TRoot, relativePath: string): Promise<unknown | null>;
  writeJson(root: TRoot, relativePath: string, value: unknown): Promise<void>;
  listDirectory(
    root: TRoot,
    relativePath: string
  ): Promise<Array<{ name: string; kind: "file" | "directory" }>>;
}

export interface ProjectConfigFile {
  schemaVersion: number;
  sites: SiteConfig[];
}

function formatConfigError(rootPath: string, message: string): Error {
  return new Error(
    `Invalid WraithWalker config at ${rootPath}/${PROJECT_CONFIG_RELATIVE_PATH}: ${message}`
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function keyToOrigin(key: string): string {
  const match = key.match(/^(https?)__([^_](?:[^_]|_(?!_))*)(?:__(\d+))?$/);
  if (!match) {
    return key;
  }

  const [, protocol, hostname, port] = match;
  return port
    ? `${protocol}://${hostname}:${port}`
    : `${protocol}://${hostname}`;
}

function validateProjectConfig(
  raw: unknown,
  rootPath: string
): ProjectConfigFile {
  if (!isPlainObject(raw)) {
    throw formatConfigError(rootPath, "config root must be an object.");
  }

  for (const key of Object.keys(raw)) {
    if (key !== "schemaVersion" && key !== "sites") {
      throw formatConfigError(rootPath, `unsupported top-level key "${key}".`);
    }
  }

  if (
    raw.schemaVersion !== undefined &&
    raw.schemaVersion !== PROJECT_CONFIG_SCHEMA_VERSION
  ) {
    throw formatConfigError(
      rootPath,
      `unsupported schemaVersion "${String(raw.schemaVersion)}".`
    );
  }

  const rawSites = raw.sites ?? [];
  if (!Array.isArray(rawSites)) {
    throw formatConfigError(rootPath, "sites must be an array.");
  }

  const sites = rawSites.map((value, index) => {
    if (!isPlainObject(value)) {
      throw formatConfigError(rootPath, `sites[${index}] must be an object.`);
    }
    if (typeof value.origin !== "string" || !value.origin.trim()) {
      throw formatConfigError(
        rootPath,
        `sites[${index}].origin must be a non-empty string.`
      );
    }
    return value as Partial<SiteConfig> & { origin: string } & {
      dumpAllowlistPattern?: string;
    };
  });

  return {
    schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
    sites: normalizeSiteConfigs(sites)
  };
}

export function createProjectConfigStore<TRoot>({
  root,
  storage,
  rootPathLabel
}: {
  root: TRoot;
  storage: ProjectConfigStorage<TRoot>;
  rootPathLabel?: string;
}) {
  const rootPath = rootPathLabel ?? "<root>";

  async function readProjectConfig(): Promise<ProjectConfigFile> {
    const raw = await storage.readOptionalJson(
      root,
      PROJECT_CONFIG_RELATIVE_PATH
    );
    if (!raw) {
      return {
        schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
        sites: []
      };
    }

    return validateProjectConfig(raw, rootPath);
  }

  async function writeProjectConfig(
    config: ProjectConfigFile
  ): Promise<ProjectConfigFile> {
    const validated = validateProjectConfig(config, rootPath);
    await storage.writeJson(root, PROJECT_CONFIG_RELATIVE_PATH, validated);
    return validated;
  }

  async function readConfiguredSiteConfigs(): Promise<SiteConfig[]> {
    return (await readProjectConfig()).sites;
  }

  async function writeConfiguredSiteConfigs(
    siteConfigs: SiteConfig[]
  ): Promise<ProjectConfigFile> {
    return writeProjectConfig({
      schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
      sites: siteConfigs
    });
  }

  async function resolveConfiguredSite(
    origin: string
  ): Promise<SiteConfig | null> {
    const normalizedOrigin = normalizeSiteInput(origin);
    const sites = await readConfiguredSiteConfigs();
    return sites.find((site) => site.origin === normalizedOrigin) || null;
  }

  async function readEffectiveSiteConfigs(): Promise<SiteConfig[]> {
    const discoveredOrigins = new Set<string>();

    try {
      const manifestOrigins = await storage.listDirectory(root, MANIFESTS_DIR);
      for (const entry of manifestOrigins) {
        if (entry.kind !== "directory") {
          continue;
        }
        discoveredOrigins.add(keyToOrigin(entry.name));
      }
    } catch {
      // A root with no captured manifests does not have a manifests tree yet.
    }

    try {
      const httpOrigins = await storage.listDirectory(root, CAPTURE_HTTP_DIR);
      for (const entry of httpOrigins) {
        if (entry.kind !== "directory") {
          continue;
        }
        discoveredOrigins.add(keyToOrigin(entry.name));
      }
    } catch {
      // A root with no captured HTTP fixtures does not have an HTTP capture tree yet.
    }

    return mergeSiteConfigs(
      await readConfiguredSiteConfigs(),
      [...discoveredOrigins]
        .sort()
        .map((origin) => createDiscoveredSiteConfig(origin))
    );
  }

  return {
    readProjectConfig,
    writeProjectConfig,
    readConfiguredSiteConfigs,
    writeConfiguredSiteConfigs,
    resolveConfiguredSite,
    readEffectiveSiteConfigs
  };
}
