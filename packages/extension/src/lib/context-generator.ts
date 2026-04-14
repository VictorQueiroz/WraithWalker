import {
  EDITOR_CONTEXT_FILES,
  inferJsonShape
} from "@wraithwalker/core/root-runtime";

import { createExtensionRootRuntime } from "./root-runtime.js";
import type { SiteConfig } from "./types.js";

export { EDITOR_CONTEXT_FILES, inferJsonShape };

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

interface ContextGeneratorDependencies {
  rootHandle: FileSystemDirectoryHandle;
  gateway: GatewayLike;
  siteConfigs: SiteConfig[];
}

export function createContextGenerator({
  rootHandle,
  gateway,
  siteConfigs
}: ContextGeneratorDependencies) {
  const runtime = createExtensionRootRuntime({
    rootHandle,
    gateway
  });

  return {
    generate(editorId?: string) {
      return runtime.generateContext({
        editorId:
          editorId && editorId in EDITOR_CONTEXT_FILES ? editorId : "cursor",
        siteConfigs
      });
    }
  };
}
