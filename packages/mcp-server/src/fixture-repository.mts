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
} from "@wraithwalker/core/fixture-layout";
import type { RootSentinel } from "@wraithwalker/core/root";
import { createFixtureRootFs, type FixtureRootFs } from "@wraithwalker/core/root-fs";

interface FixtureResponsePayload {
  body: string;
  bodyEncoding: "utf8" | "base64";
  meta: ResponseMeta;
}

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
    const bodyExists = await rootFs.exists(descriptor.bodyPath);
    if (!bodyExists) {
      return false;
    }

    if (descriptor.metadataOptional) {
      return true;
    }

    return rootFs.exists(descriptor.metaPath);
  }

  async function read(descriptor: FixtureDescriptor): Promise<StoredFixture | null> {
    const bodyStats = await rootFs.stat(descriptor.bodyPath);
    if (!bodyStats || !bodyStats.isFile()) {
      return null;
    }

    const [request, meta, bodyBase64] = await Promise.all([
      rootFs.readOptionalJson<RequestPayload>(descriptor.requestPath),
      rootFs.readOptionalJson<ResponseMeta>(descriptor.metaPath),
      rootFs.readBodyAsBase64(descriptor.bodyPath)
    ]);

    return {
      request: request || createFallbackRequest(descriptor),
      meta: meta || createFallbackResponseMeta(descriptor),
      bodyBase64,
      size: bodyStats.size
    };
  }

  async function writeIfAbsent(payload: {
    descriptor: FixtureDescriptor;
    request: RequestPayload;
    response: FixtureResponsePayload;
  }): Promise<{ written: boolean; descriptor: FixtureDescriptor; sentinel: RootSentinel }> {
    const { descriptor, request, response } = payload;

    if (await rootFs.exists(descriptor.bodyPath)) {
      return {
        written: false,
        descriptor,
        sentinel
      };
    }

    await Promise.all([
      rootFs.writeJson(descriptor.requestPath, request),
      rootFs.writeJson(descriptor.metaPath, response.meta),
      rootFs.writeBody(descriptor.bodyPath, response)
    ]);

    if (descriptor.assetLike) {
      const manifestPath = getStaticResourceManifestPath(descriptor);
      if (manifestPath) {
        const currentManifest = await rootFs.readOptionalJson<StaticResourceManifest>(manifestPath);
        const nextManifest = upsertStaticResourceManifest(
          currentManifest || createStaticResourceManifest(descriptor),
          createStaticResourceManifestEntry(descriptor, response.meta)
        );
        await rootFs.writeJson(manifestPath, nextManifest);
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
