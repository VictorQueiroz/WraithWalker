import {
  createWraithwalkerRootRuntime,
  type RootRuntimeStorage
} from "@wraithwalker/core/root-runtime";
import { createRoot, type RootSentinel } from "@wraithwalker/core/root";
import { createFixtureRootFs, type FixtureRootFs } from "@wraithwalker/core/root-fs";

interface CreateServerRootRuntimeDependencies {
  rootPath: string;
  sentinel?: RootSentinel;
  rootFs?: FixtureRootFs;
}

export function createServerRootRuntime({
  rootPath,
  sentinel,
  rootFs = createFixtureRootFs(rootPath)
}: CreateServerRootRuntimeDependencies) {
  const storage: RootRuntimeStorage<FixtureRootFs> = {
    ensureSentinel: async (root) => sentinel ?? createRoot(root.rootPath),
    exists: (root, relativePath) => root.exists(relativePath),
    writeText: (root, relativePath, content) => root.writeText(relativePath, content),
    writeJson: (root, relativePath, value) => root.writeJson(relativePath, value),
    writeBody: (root, relativePath, payload) => root.writeBody(relativePath, payload),
    readOptionalJson: (root, relativePath) => root.readOptionalJson(relativePath),
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
    readText: (root, relativePath) => root.readText(relativePath),
    listDirectory: (root, relativePath) => root.listDirectory(relativePath)
  };

  return createWraithwalkerRootRuntime({
    root: rootFs,
    storage
  });
}
