import {
  createStaticResourceManifest,
  createStaticResourceManifestEntry,
  deriveExtensionFromMime,
  deriveMimeTypeFromPathname,
  getStaticResourceManifestPath,
  upsertStaticResourceManifest,
  type FixtureDescriptor,
  type RequestPayload,
  type ResponseMeta,
  type StaticResourceManifest,
  type StoredFixture
} from "./fixture-layout.mjs";
import type { RootSentinel } from "./root.mjs";

export interface FixtureResponsePayload {
  body: string;
  bodyEncoding: "utf8" | "base64";
  meta: ResponseMeta;
}

export interface FixtureRepositoryStorage<TRoot> {
  exists(root: TRoot, relativePath: string): Promise<boolean>;
  writeJson(root: TRoot, relativePath: string, value: unknown): Promise<void>;
  writeBody(
    root: TRoot,
    relativePath: string,
    payload: { body: string; bodyEncoding: "utf8" | "base64" }
  ): Promise<void>;
  readOptionalJson<T>(root: TRoot, relativePath: string): Promise<T | null>;
  readBody(root: TRoot, relativePath: string): Promise<{ bodyBase64: string; size: number }>;
}

interface FixtureRepositoryDependencies<TRoot> {
  root: TRoot;
  sentinel: RootSentinel;
  storage: FixtureRepositoryStorage<TRoot>;
}

export function createFixtureRepository<TRoot>({
  root,
  sentinel,
  storage
}: FixtureRepositoryDependencies<TRoot>) {
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
    const bodyExists = await storage.exists(root, descriptor.bodyPath);
    if (!bodyExists) {
      return false;
    }

    if (descriptor.metadataOptional) {
      return true;
    }

    return storage.exists(root, descriptor.metaPath);
  }

  async function read(descriptor: FixtureDescriptor): Promise<StoredFixture | null> {
    const bodyExists = await storage.exists(root, descriptor.bodyPath);
    if (!bodyExists) {
      return null;
    }

    const [request, meta, body] = await Promise.all([
      storage.readOptionalJson<RequestPayload>(root, descriptor.requestPath),
      storage.readOptionalJson<ResponseMeta>(root, descriptor.metaPath),
      storage.readBody(root, descriptor.bodyPath)
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

    if (await storage.exists(root, descriptor.bodyPath)) {
      return {
        written: false,
        descriptor,
        sentinel
      };
    }

    await Promise.all([
      storage.writeJson(root, descriptor.requestPath, request),
      storage.writeJson(root, descriptor.metaPath, response.meta),
      storage.writeBody(root, descriptor.bodyPath, response)
    ]);

    if (descriptor.assetLike) {
      const manifestPath = getStaticResourceManifestPath(descriptor);
      if (manifestPath) {
        const currentManifest = await storage.readOptionalJson<StaticResourceManifest>(root, manifestPath);
        const nextManifest = upsertStaticResourceManifest(
          currentManifest || createStaticResourceManifest(descriptor),
          createStaticResourceManifestEntry(descriptor, response.meta)
        );
        await storage.writeJson(root, manifestPath, nextManifest);
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
