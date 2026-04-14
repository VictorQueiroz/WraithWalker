import type { SiteConfigLike } from "./fixtures.mjs";
import { readSiteConfigs } from "./fixtures.mjs";
import { createRoot } from "./root.mjs";
import { createFixtureRootFs, type FixtureRootFs } from "./root-fs.mjs";
import {
  createWraithwalkerRootRuntime,
  type RootRuntimeStorage
} from "./root-runtime.mjs";

export interface FsGateway {
  readText(rootPath: string, relativePath: string): Promise<string>;
  writeText(
    rootPath: string,
    relativePath: string,
    content: string
  ): Promise<void>;
}

function createRootRuntimeStorage(
  rootPath: string,
  gateway: FsGateway,
  rootFs: FixtureRootFs
): RootRuntimeStorage<FixtureRootFs> {
  return {
    ensureSentinel: (root) => createRoot(root.rootPath),
    exists: (root, relativePath) => root.exists(relativePath),
    writeJson: (root, relativePath, value) =>
      root.writeJson(relativePath, value),
    writeBody: (root, relativePath, payload) =>
      root.writeBody(relativePath, payload),
    readOptionalJson: (root, relativePath) =>
      root.readOptionalJson(relativePath),
    readBody: async (root, relativePath) => {
      const stats = await root.stat(relativePath);
      if (!stats || !stats.isFile()) {
        throw new Error(`Fixture body not found at ${relativePath}`);
      }

      return {
        bodyBase64: await root.readBodyAsBase64(relativePath),
        size: stats.size
      };
    },
    readText: (_root, relativePath) => gateway.readText(rootPath, relativePath),
    writeText: (_root, relativePath, content) =>
      gateway.writeText(rootPath, relativePath, content),
    listDirectory: (root, relativePath) => root.listDirectory(relativePath)
  };
}

export async function generateContext(
  rootPath: string,
  gateway: FsGateway,
  editorId?: string,
  siteConfigsOverride?: SiteConfigLike[]
): Promise<string> {
  const rootFs = createFixtureRootFs(rootPath);
  const runtime = createWraithwalkerRootRuntime({
    root: rootFs,
    storage: createRootRuntimeStorage(rootPath, gateway, rootFs)
  });

  return runtime.generateContext({
    editorId,
    siteConfigs: siteConfigsOverride ?? (await readSiteConfigs(rootPath))
  });
}
