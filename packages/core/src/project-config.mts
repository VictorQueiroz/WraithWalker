import { createFixtureRootFs } from "./root-fs.mjs";
import {
  createProjectConfigStore,
  type ProjectConfigFile,
  type ProjectConfigStorage
} from "./project-config-store.mjs";
import type { SiteConfig } from "./site-config.mjs";

export {
  PROJECT_CONFIG_RELATIVE_PATH,
  PROJECT_CONFIG_SCHEMA_VERSION
} from "./constants.mjs";
export {
  createProjectConfigStore,
  type ProjectConfigFile,
  type ProjectConfigStorage
} from "./project-config-store.mjs";

async function createPathProjectConfigStore(rootPath: string) {
  return createProjectConfigStore({
    root: createFixtureRootFs(rootPath),
    rootPathLabel: rootPath,
    storage: {
      readOptionalJson: (root, relativePath) =>
        root.readOptionalJson(relativePath),
      writeJson: (root, relativePath, value) =>
        root.writeJson(relativePath, value),
      listDirectory: (root, relativePath) => root.listDirectory(relativePath)
    } satisfies ProjectConfigStorage<ReturnType<typeof createFixtureRootFs>>
  });
}

export async function readProjectConfig(
  rootPath: string
): Promise<ProjectConfigFile> {
  return (await createPathProjectConfigStore(rootPath)).readProjectConfig();
}

export async function writeProjectConfig(
  rootPath: string,
  config: ProjectConfigFile
): Promise<ProjectConfigFile> {
  return (await createPathProjectConfigStore(rootPath)).writeProjectConfig(
    config
  );
}

export async function readConfiguredSiteConfigs(
  rootPath: string
): Promise<SiteConfig[]> {
  return (
    await createPathProjectConfigStore(rootPath)
  ).readConfiguredSiteConfigs();
}

export async function writeConfiguredSiteConfigs(
  rootPath: string,
  siteConfigs: SiteConfig[]
): Promise<ProjectConfigFile> {
  return (
    await createPathProjectConfigStore(rootPath)
  ).writeConfiguredSiteConfigs(siteConfigs);
}

export async function resolveConfiguredSite(
  rootPath: string,
  origin: string
): Promise<SiteConfig | null> {
  return (await createPathProjectConfigStore(rootPath)).resolveConfiguredSite(
    origin
  );
}

export async function readEffectiveSiteConfigs(
  rootPath: string
): Promise<SiteConfig[]> {
  return (
    await createPathProjectConfigStore(rootPath)
  ).readEffectiveSiteConfigs();
}
