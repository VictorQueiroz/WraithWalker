import {
  createStaticResourceManifest,
  createStaticResourceManifestEntry,
  getStaticResourceManifestPath,
  upsertStaticResourceManifest,
  type FixtureDescriptor,
  type RequestPayload,
  type ResponseMeta,
  type StaticResourceManifest,
  type StoredFixture
} from "./fixture-layout.mjs";
import { createProjectedFixturePayload } from "./fixture-presentation.mjs";
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

  async function createProjectionPayload(
    projectionPath: string,
    response: FixtureResponsePayload
  ): Promise<{ body: string; bodyEncoding: "utf8" | "base64" }> {
    return createProjectedFixturePayload({
      relativePath: projectionPath,
      payload: {
        body: response.body,
        bodyEncoding: response.bodyEncoding
      },
      mimeType: response.meta.mimeType,
      resourceType: response.meta.resourceType
    });
  }

  async function exists(descriptor: FixtureDescriptor): Promise<boolean> {
    const bodyExists = await storage.exists(root, descriptor.bodyPath);
    if (!bodyExists) {
      return false;
    }

    return storage.exists(root, descriptor.metaPath);
  }

  async function read(descriptor: FixtureDescriptor): Promise<StoredFixture | null> {
    const [bodyExists, projectionExists, meta] = await Promise.all([
      storage.exists(root, descriptor.bodyPath),
      descriptor.projectionPath
        ? storage.exists(root, descriptor.projectionPath)
        : Promise.resolve(false),
      storage.readOptionalJson<ResponseMeta>(root, descriptor.metaPath)
    ]);
    if (!bodyExists) {
      return null;
    }
    if (!meta) {
      return null;
    }

    const preferredBodyPath = projectionExists && descriptor.projectionPath
      ? descriptor.projectionPath
      : descriptor.bodyPath;

    const [request, body] = await Promise.all([
      storage.readOptionalJson<RequestPayload>(root, descriptor.requestPath),
      storage.readBody(root, preferredBodyPath)
    ]);

    return {
      request: request || createFallbackRequest(descriptor),
      meta,
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
    const [bodyExists, requestExists, metaExists, projectionExists] = await Promise.all([
      storage.exists(root, descriptor.bodyPath),
      storage.exists(root, descriptor.requestPath),
      storage.exists(root, descriptor.metaPath),
      descriptor.projectionPath
        ? storage.exists(root, descriptor.projectionPath)
        : Promise.resolve(false)
    ]);

    const writes: Promise<void>[] = [];
    let shouldWriteProjection = false;

    if (!bodyExists) {
      writes.push(storage.writeBody(root, descriptor.bodyPath, response));
    }

    if (!requestExists) {
      writes.push(storage.writeJson(root, descriptor.requestPath, request));
    }

    if (!metaExists) {
      writes.push(storage.writeJson(root, descriptor.metaPath, response.meta));
    }

    if (descriptor.projectionPath && !projectionExists) {
      shouldWriteProjection = true;
      writes.push((async () => {
        await storage.writeBody(
          root,
          descriptor.projectionPath!,
          await createProjectionPayload(descriptor.projectionPath!, response)
        );
      })());
    }

    if (writes.length === 0) {
      return {
        written: false,
        descriptor,
        sentinel
      };
    }

    await Promise.all(writes);

    if (descriptor.assetLike) {
      const manifestPath = getStaticResourceManifestPath(descriptor);
      if (manifestPath) {
        const currentManifest = await storage.readOptionalJson<StaticResourceManifest>(root, manifestPath);
        const nextManifest = upsertStaticResourceManifest(
          currentManifest || createStaticResourceManifest(descriptor),
          createStaticResourceManifestEntry(descriptor, response.meta, {
            projectionPath: shouldWriteProjection ? descriptor.projectionPath! : null
          })
        );
        await storage.writeJson(root, manifestPath, nextManifest);
      }
    }

    return {
      written: writes.length > 0,
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
