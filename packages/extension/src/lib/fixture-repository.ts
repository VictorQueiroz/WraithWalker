import { deriveExtensionFromMime, deriveMimeTypeFromPathname } from "./path-utils.js";
import {
  createStaticResourceManifest,
  createStaticResourceManifestEntry,
  getStaticResourceManifestPath,
  upsertStaticResourceManifest
} from "./static-resource-manifest.js";
import type {
  FixtureDescriptor,
  RequestPayload,
  ResponseMeta,
  RootSentinel,
  StaticResourceManifest,
  StoredFixture
} from "./types.js";

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

interface FixtureResponsePayload {
  body: string;
  bodyEncoding: "utf8" | "base64";
  meta: ResponseMeta;
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
  function createFallbackRequest(descriptor: FixtureDescriptor): RequestPayload {
    return {
      topOrigin: descriptor.topOrigin,
      url: descriptor.requestUrl,
      method: descriptor.method,
      headers: [],
      body: "",
      bodyEncoding: descriptor.postDataEncoding,
      bodyHash: descriptor.bodyHash,
      queryHash: descriptor.queryHash,
      capturedAt: new Date().toISOString()
    };
  }

  function createFallbackResponseMeta(descriptor: FixtureDescriptor): ResponseMeta {
    const mimeType = deriveMimeTypeFromPathname(new URL(descriptor.requestUrl).pathname);
    return {
      status: 200,
      statusText: "OK",
      headers: [{ name: "Content-Type", value: mimeType }],
      mimeType,
      resourceType: "Other",
      url: descriptor.requestUrl,
      method: descriptor.method,
      capturedAt: new Date().toISOString(),
      bodyEncoding: "base64",
      bodySuggestedExtension: deriveExtensionFromMime(mimeType)
    };
  }

  async function exists(descriptor: FixtureDescriptor): Promise<boolean> {
    const bodyExists = await gateway.exists(rootHandle, descriptor.bodyPath);
    if (!bodyExists) {
      return false;
    }

    if (descriptor.metadataOptional) {
      return true;
    }

    return gateway.exists(rootHandle, descriptor.metaPath);
  }

  async function read(descriptor: FixtureDescriptor): Promise<StoredFixture | null> {
    const bodyExists = await gateway.exists(rootHandle, descriptor.bodyPath);
    if (!bodyExists) {
      return null;
    }

    const [request, meta, body] = await Promise.all([
      gateway.readOptionalJson<RequestPayload>(rootHandle, descriptor.requestPath),
      gateway.readOptionalJson<ResponseMeta>(rootHandle, descriptor.metaPath),
      gateway.readBody(rootHandle, descriptor.bodyPath)
    ]);

    return {
      request: request || createFallbackRequest(descriptor),
      meta: meta || createFallbackResponseMeta(descriptor),
      bodyBase64: body.bodyBase64,
      size: body.size
    };
  }

  async function writeIfAbsent(payload: {
    descriptor: FixtureDescriptor;
    request: RequestPayload;
    response: FixtureResponsePayload;
  }): Promise<{ written: boolean; descriptor: FixtureDescriptor; sentinel: RootSentinel }> {
    const { descriptor, request, response } = payload;

    if (await gateway.exists(rootHandle, descriptor.bodyPath)) {
      return {
        written: false,
        descriptor,
        sentinel
      };
    }

    await Promise.all([
      gateway.writeJson(rootHandle, descriptor.requestPath, request),
      gateway.writeJson(rootHandle, descriptor.metaPath, response.meta),
      gateway.writeBody(rootHandle, descriptor.bodyPath, response)
    ]);

    if (descriptor.assetLike) {
      const manifestPath = getStaticResourceManifestPath(descriptor);
      if (manifestPath) {
        const currentManifest = await gateway.readOptionalJson<StaticResourceManifest>(rootHandle, manifestPath);
        const nextManifest = upsertStaticResourceManifest(
          currentManifest || createStaticResourceManifest(descriptor),
          createStaticResourceManifestEntry(descriptor, response.meta)
        );
        await gateway.writeJson(rootHandle, manifestPath, nextManifest);
      }
    }

    return {
      written: true,
      descriptor,
      sentinel
    };
  }

  return {
    exists,
    read,
    writeIfAbsent
  };
}
