import {
  createFixtureRepository as createSharedFixtureRepository,
  type FixtureRepositoryStorage
} from "@wraithwalker/core/fixture-repository";
import type { RootSentinel } from "@wraithwalker/core/root";
import {
  createFixtureRootFs,
  type FixtureRootFs
} from "@wraithwalker/core/root-fs";

interface FixtureRepositoryDependencies {
  rootPath: string;
  sentinel: RootSentinel;
  rootFs?: FixtureRootFs;
}

export function createFixtureRepository({
  rootPath,
  sentinel,
  rootFs = createFixtureRootFs(rootPath)
}: FixtureRepositoryDependencies) {
  const storage: FixtureRepositoryStorage<FixtureRootFs> = {
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
    }
  };

  return createSharedFixtureRepository({
    root: rootFs,
    sentinel,
    storage
  });
}
