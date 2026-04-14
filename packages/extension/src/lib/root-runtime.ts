import {
  createWraithwalkerRootRuntime,
  type RootRuntimeStorage
} from "@wraithwalker/core/root-runtime";

import { ensureRootSentinel as defaultEnsureRootSentinel } from "./root-handle.js";

interface GatewayLike {
  exists(
    rootHandle: FileSystemDirectoryHandle,
    relativePath: string
  ): Promise<boolean>;
  writeText(
    rootHandle: FileSystemDirectoryHandle,
    relativePath: string,
    content: string
  ): Promise<void>;
  writeJson(
    rootHandle: FileSystemDirectoryHandle,
    relativePath: string,
    value: unknown
  ): Promise<void>;
  writeBody(
    rootHandle: FileSystemDirectoryHandle,
    relativePath: string,
    payload: { body: string; bodyEncoding: "utf8" | "base64" }
  ): Promise<void>;
  readOptionalJson<T>(
    rootHandle: FileSystemDirectoryHandle,
    relativePath: string
  ): Promise<T | null>;
  readBody(
    rootHandle: FileSystemDirectoryHandle,
    relativePath: string
  ): Promise<{ bodyBase64: string; size: number }>;
  readText(
    rootHandle: FileSystemDirectoryHandle,
    relativePath: string
  ): Promise<string>;
  listDirectory(
    rootHandle: FileSystemDirectoryHandle,
    relativePath: string
  ): Promise<Array<{ name: string; kind: "file" | "directory" }>>;
}

interface CreateExtensionRootRuntimeDependencies {
  rootHandle: FileSystemDirectoryHandle;
  gateway: GatewayLike;
  ensureSentinel?: typeof defaultEnsureRootSentinel;
}

export function createExtensionRootRuntime({
  rootHandle,
  gateway,
  ensureSentinel = defaultEnsureRootSentinel
}: CreateExtensionRootRuntimeDependencies) {
  const storage: RootRuntimeStorage<FileSystemDirectoryHandle> = {
    ensureSentinel: (root) => ensureSentinel(root),
    exists: (root, relativePath) => gateway.exists(root, relativePath),
    writeText: (root, relativePath, content) =>
      gateway.writeText(root, relativePath, content),
    writeJson: (root, relativePath, value) =>
      gateway.writeJson(root, relativePath, value),
    writeBody: (root, relativePath, payload) =>
      gateway.writeBody(root, relativePath, payload),
    readOptionalJson: (root, relativePath) =>
      gateway.readOptionalJson(root, relativePath),
    readBody: (root, relativePath) => gateway.readBody(root, relativePath),
    readText: (root, relativePath) => gateway.readText(root, relativePath),
    listDirectory: (root, relativePath) =>
      gateway.listDirectory(root, relativePath)
  };

  return createWraithwalkerRootRuntime({
    root: rootHandle,
    storage
  });
}
