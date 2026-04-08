import { describe, expect, it } from "vitest";

import { createFixtureDescriptor, type FixtureDescriptor, type RequestPayload, type ResponseMeta } from "../src/fixture-layout.mjs";
import { createFixtureRepository, type FixtureRepositoryStorage } from "../src/fixture-repository.mjs";
import type { RootSentinel } from "../src/root.mjs";

interface MemoryRoot {
  files: Map<string, Uint8Array>;
}

function createMemoryRoot(): MemoryRoot {
  return {
    files: new Map()
  };
}

function createMemoryStorage(): FixtureRepositoryStorage<MemoryRoot> {
  return {
    async exists(root, relativePath) {
      return root.files.has(relativePath);
    },
    async writeJson(root, relativePath, value) {
      root.files.set(relativePath, new TextEncoder().encode(JSON.stringify(value, null, 2)));
    },
    async writeBody(root, relativePath, payload) {
      const bytes = payload.bodyEncoding === "base64"
        ? Uint8Array.from(Buffer.from(payload.body, "base64"))
        : new TextEncoder().encode(payload.body);
      root.files.set(relativePath, bytes);
    },
    async readOptionalJson(root, relativePath) {
      const bytes = root.files.get(relativePath);
      if (!bytes) {
        return null;
      }

      return JSON.parse(new TextDecoder().decode(bytes));
    },
    async readBody(root, relativePath) {
      const bytes = root.files.get(relativePath);
      if (!bytes) {
        throw new Error(`Missing body at ${relativePath}`);
      }

      return {
        bodyBase64: Buffer.from(bytes).toString("base64"),
        size: bytes.byteLength
      };
    }
  };
}

async function createDescriptor(overrides: Partial<{
  topOrigin: string;
  method: string;
  url: string;
  siteMode: "simple" | "advanced";
  resourceType: string;
  mimeType: string;
}> = {}): Promise<FixtureDescriptor> {
  return createFixtureDescriptor({
    topOrigin: overrides.topOrigin || "https://app.example.com",
    method: overrides.method || "GET",
    url: overrides.url || "https://cdn.example.com/assets/app.js",
    siteMode: overrides.siteMode || "simple",
    resourceType: overrides.resourceType || "Script",
    mimeType: overrides.mimeType || "application/javascript"
  });
}

function createRequestPayload(descriptor: FixtureDescriptor): RequestPayload {
  return {
    topOrigin: descriptor.topOrigin,
    url: descriptor.requestUrl,
    method: descriptor.method,
    headers: [],
    body: "",
    bodyEncoding: "utf8",
    bodyHash: descriptor.bodyHash,
    queryHash: descriptor.queryHash,
    capturedAt: "2026-04-07T00:00:00.000Z"
  };
}

function createResponseMeta(
  descriptor: FixtureDescriptor,
  {
    mimeType,
    resourceType,
    bodySuggestedExtension
  }: {
    mimeType: string;
    resourceType: string;
    bodySuggestedExtension: string;
  }
): ResponseMeta {
  return {
    status: 200,
    statusText: "OK",
    headers: [{ name: "Content-Type", value: mimeType }],
    mimeType,
    resourceType,
    url: descriptor.requestUrl,
    method: descriptor.method,
    capturedAt: "2026-04-07T00:00:00.000Z",
    bodyEncoding: "utf8",
    bodySuggestedExtension
  };
}

describe("shared fixture repository", () => {
  const sentinel: RootSentinel = {
    rootId: "root-1",
    schemaVersion: 1,
    createdAt: "2026-04-07T00:00:00.000Z"
  };

  it("returns false when the body is missing and respects metadataOptional descriptors", async () => {
    const root = createMemoryRoot();
    const storage = createMemoryStorage();
    const assetDescriptor = await createDescriptor();
    const apiDescriptor = await createDescriptor({
      url: "https://api.example.com/users",
      resourceType: "Fetch",
      mimeType: "application/json"
    });
    const repository = createFixtureRepository({
      root,
      sentinel,
      storage
    });

    expect(await repository.exists(assetDescriptor)).toBe(false);
    expect(await repository.exists(apiDescriptor)).toBe(false);

    await storage.writeBody(root, assetDescriptor.bodyPath, {
      body: "console.log('asset');",
      bodyEncoding: "utf8"
    });
    await storage.writeBody(root, apiDescriptor.bodyPath, {
      body: JSON.stringify({ ok: true }),
      bodyEncoding: "utf8"
    });

    expect(assetDescriptor.metadataOptional).toBe(true);
    expect(apiDescriptor.metadataOptional).toBe(false);
    expect(await repository.exists(assetDescriptor)).toBe(true);
    expect(await repository.exists(apiDescriptor)).toBe(false);

    await storage.writeJson(root, apiDescriptor.metaPath, createResponseMeta(apiDescriptor, {
      mimeType: "application/json",
      resourceType: "Fetch",
      bodySuggestedExtension: "json"
    }));
    expect(await repository.exists(apiDescriptor)).toBe(true);
  });

  it("returns null when no body exists and falls back to derived request/response metadata when sidecars are missing", async () => {
    const root = createMemoryRoot();
    const storage = createMemoryStorage();
    const repository = createFixtureRepository({
      root,
      sentinel,
      storage
    });
    const descriptor = await createDescriptor({
      url: "https://cdn.example.com/styles/app.css",
      resourceType: "Stylesheet",
      mimeType: "text/css"
    });

    expect(await repository.read(descriptor)).toBeNull();

    await storage.writeBody(root, descriptor.bodyPath, {
      body: ".app { color: red; }",
      bodyEncoding: "utf8"
    });

    expect(await repository.read(descriptor)).toEqual({
      request: expect.objectContaining({
        topOrigin: "https://app.example.com",
        url: "https://cdn.example.com/styles/app.css",
        method: "GET",
        bodyEncoding: descriptor.postDataEncoding
      }),
      meta: expect.objectContaining({
        status: 200,
        statusText: "OK",
        mimeType: "text/css",
        resourceType: "Other",
        bodyEncoding: "base64",
        bodySuggestedExtension: "css"
      }),
      bodyBase64: Buffer.from(".app { color: red; }", "utf8").toString("base64"),
      size: Buffer.byteLength(".app { color: red; }")
    });
  });

  it("writes asset fixtures once and maintains the static manifest entry", async () => {
    const root = createMemoryRoot();
    const storage = createMemoryStorage();
    const descriptor = await createDescriptor({
      url: "https://cdn.example.com/styles/app.css",
      resourceType: "Stylesheet",
      mimeType: "text/css"
    });
    const request = createRequestPayload(descriptor);
    const meta = createResponseMeta(descriptor, {
      mimeType: "text/css",
      resourceType: "Stylesheet",
      bodySuggestedExtension: "css"
    });
    const repository = createFixtureRepository({
      root,
      sentinel,
      storage
    });

    const firstWrite = await repository.writeIfAbsent({
      descriptor,
      request,
      response: {
        body: ".app { color: red; }",
        bodyEncoding: "utf8",
        meta
      }
    });
    const secondWrite = await repository.writeIfAbsent({
      descriptor,
      request: {
        ...request,
        capturedAt: "2026-04-07T00:01:00.000Z"
      },
      response: {
        body: ".app { color: blue; }",
        bodyEncoding: "utf8",
        meta
      }
    });

    expect(firstWrite).toEqual({
      written: true,
      descriptor,
      sentinel
    });
    expect(secondWrite).toEqual({
      written: false,
      descriptor,
      sentinel
    });

    expect(await storage.readOptionalJson<RequestPayload>(root, descriptor.requestPath)).toEqual(request);
    expect(await storage.readOptionalJson<ResponseMeta>(root, descriptor.metaPath)).toEqual(meta);
    expect(await repository.read(descriptor)).toEqual({
      request,
      meta,
      bodyBase64: Buffer.from(".app { color: red; }", "utf8").toString("base64"),
      size: Buffer.byteLength(".app { color: red; }")
    });

    const manifest = await storage.readOptionalJson<{
      resourcesByPathname: Record<string, Array<{ bodyPath: string; requestPath: string; metaPath: string }>>;
    }>(root, ".wraithwalker/simple/https__app.example.com/RESOURCE_MANIFEST.json");
    expect(manifest?.resourcesByPathname["/styles/app.css"]).toEqual([
      expect.objectContaining({
        bodyPath: descriptor.bodyPath,
        requestPath: descriptor.requestPath,
        metaPath: descriptor.metaPath
      })
    ]);
  });

  it("writes API fixtures without creating a static resource manifest", async () => {
    const root = createMemoryRoot();
    const storage = createMemoryStorage();
    const descriptor = await createDescriptor({
      url: "https://api.example.com/users",
      resourceType: "Fetch",
      mimeType: "application/json"
    });
    const request = createRequestPayload(descriptor);
    const meta = createResponseMeta(descriptor, {
      mimeType: "application/json",
      resourceType: "Fetch",
      bodySuggestedExtension: "json"
    });
    const body = JSON.stringify({ users: [{ id: 1 }] });
    const repository = createFixtureRepository({
      root,
      sentinel,
      storage
    });

    const result = await repository.writeIfAbsent({
      descriptor,
      request,
      response: {
        body,
        bodyEncoding: "utf8",
        meta
      }
    });

    expect(result).toEqual({
      written: true,
      descriptor,
      sentinel
    });
    expect(await storage.readOptionalJson(root, ".wraithwalker/simple/https__app.example.com/RESOURCE_MANIFEST.json")).toBeNull();
    expect(await repository.read(descriptor)).toEqual({
      request,
      meta,
      bodyBase64: Buffer.from(body, "utf8").toString("base64"),
      size: Buffer.byteLength(body)
    });
  });
});
