import { createFixtureRootFs } from "@wraithwalker/core/root-fs";

export interface FsGateway {
  exists(rootPath: string, relativePath: string): Promise<boolean>;
  readJson<T>(rootPath: string, relativePath: string): Promise<T>;
  readOptionalJson<T>(
    rootPath: string,
    relativePath: string
  ): Promise<T | null>;
  readText(rootPath: string, relativePath: string): Promise<string>;
  writeText(
    rootPath: string,
    relativePath: string,
    content: string
  ): Promise<void>;
  writeJson(
    rootPath: string,
    relativePath: string,
    value: unknown
  ): Promise<void>;
  listDirectory(
    rootPath: string,
    relativePath: string
  ): Promise<Array<{ name: string; kind: "file" | "directory" }>>;
}

export function createFsGateway(): FsGateway {
  function rootFs(rootPath: string) {
    return createFixtureRootFs(rootPath);
  }

  return {
    async exists(rootPath, relativePath) {
      return rootFs(rootPath).exists(relativePath);
    },

    async readJson(rootPath, relativePath) {
      return rootFs(rootPath).readJson(relativePath);
    },

    async readOptionalJson(rootPath, relativePath) {
      return rootFs(rootPath).readOptionalJson(relativePath);
    },

    async readText(rootPath, relativePath) {
      return rootFs(rootPath).readText(relativePath);
    },

    async writeText(rootPath, relativePath, content) {
      await rootFs(rootPath).writeText(relativePath, content);
    },

    async writeJson(rootPath, relativePath, value) {
      await rootFs(rootPath).writeJson(relativePath, value);
    },

    async listDirectory(rootPath, relativePath) {
      return rootFs(rootPath).listDirectory(relativePath);
    }
  };
}
