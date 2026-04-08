import {
  createFixtureRepository as createSharedFixtureRepository,
  type FixtureRepositoryStorage
} from "@wraithwalker/core/fixture-repository";
import type { RootSentinel } from "./types.js";

interface GatewayLike {
  exists(rootHandle: FileSystemDirectoryHandle, relativePath: string): Promise<boolean>;
  writeJson(rootHandle: FileSystemDirectoryHandle, relativePath: string, value: unknown): Promise<void>;
  writeBody(
    rootHandle: FileSystemDirectoryHandle,
    relativePath: string,
    payload: { body: string; bodyEncoding: "utf8" | "base64" }
  ): Promise<void>;
  readOptionalJson<T>(rootHandle: FileSystemDirectoryHandle, relativePath: string): Promise<T | null>;
  readBody(rootHandle: FileSystemDirectoryHandle, relativePath: string): Promise<{ bodyBase64: string; size: number }>;
}

interface FixtureRepositoryDependencies {
  rootHandle: FileSystemDirectoryHandle;
  sentinel: RootSentinel;
  gateway: GatewayLike;
}

export function createFixtureRepository({
  rootHandle,
  sentinel,
  gateway
}: FixtureRepositoryDependencies) {
  const storage: FixtureRepositoryStorage<FileSystemDirectoryHandle> = {
    exists: (root, relativePath) => gateway.exists(root, relativePath),
    writeJson: (root, relativePath, value) => gateway.writeJson(root, relativePath, value),
    writeBody: (root, relativePath, payload) => gateway.writeBody(root, relativePath, payload),
    readOptionalJson: (root, relativePath) => gateway.readOptionalJson(root, relativePath),
    readBody: (root, relativePath) => gateway.readBody(root, relativePath)
  };

  return createSharedFixtureRepository({
    root: rootHandle,
    sentinel,
    storage
  });
}
