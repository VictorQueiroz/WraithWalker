import { describe, expect, it } from "vitest";

import { createFixtureDescriptor, type FixtureDescriptor, type RequestPayload, type ResponseMeta } from "../src/fixture-layout.mts";
import { createFixtureRepository, type FixtureRepositoryStorage } from "../src/fixture-repository.mts";
import type { RootSentinel } from "../src/root.mts";

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
  resourceType: string;
  mimeType: string;
}> = {}): Promise<FixtureDescriptor> {
  return createFixtureDescriptor({
    topOrigin: overrides.topOrigin || "https://app.example.com",
    method: overrides.method || "GET",
    url: overrides.url || "https://cdn.example.com/assets/app.js",
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

  it("requires canonical bodies and metadata for simple-mode assets", async () => {
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

    expect(assetDescriptor.metadataOptional).toBe(false);
    expect(apiDescriptor.metadataOptional).toBe(false);
    expect(await repository.exists(assetDescriptor)).toBe(false);
    expect(await repository.exists(apiDescriptor)).toBe(false);

    await storage.writeJson(root, assetDescriptor.metaPath, createResponseMeta(assetDescriptor, {
      mimeType: "application/javascript",
      resourceType: "Script",
      bodySuggestedExtension: "js"
    }));
    expect(await repository.exists(assetDescriptor)).toBe(true);

    await storage.writeJson(root, apiDescriptor.metaPath, createResponseMeta(apiDescriptor, {
      mimeType: "application/json",
      resourceType: "Fetch",
      bodySuggestedExtension: "json"
    }));
    expect(await repository.exists(apiDescriptor)).toBe(true);
  });

  it("returns null when canonical simple-mode metadata is missing", async () => {
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

    expect(await repository.read(descriptor)).toBeNull();
  });

  it("falls back to a derived request payload when canonical request metadata is missing", async () => {
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
    const meta = createResponseMeta(descriptor, {
      mimeType: "text/css",
      resourceType: "Stylesheet",
      bodySuggestedExtension: "css"
    });

    await storage.writeBody(root, descriptor.bodyPath, {
      body: ".app { color: red; }",
      bodyEncoding: "utf8"
    });
    await storage.writeJson(root, descriptor.metaPath, meta);

    await expect(repository.read(descriptor)).resolves.toEqual({
      request: expect.objectContaining({
        topOrigin: descriptor.topOrigin,
        url: descriptor.requestUrl,
        method: descriptor.method,
        bodyEncoding: descriptor.postDataEncoding,
        bodyHash: descriptor.bodyHash,
        queryHash: descriptor.queryHash
      }),
      meta,
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
    expect(descriptor.projectionPath).toBe("cdn.example.com/styles/app.css");
    expect(Buffer.from(root.files.get(descriptor.projectionPath!) || new Uint8Array()).toString("utf8")).toBe(
      ".app {\n  color: red;\n}"
    );
    expect(await repository.read(descriptor)).toEqual({
      request,
      meta,
      bodyBase64: Buffer.from(".app {\n  color: red;\n}", "utf8").toString("base64"),
      size: Buffer.byteLength(".app {\n  color: red;\n}")
    });

    const manifest = await storage.readOptionalJson<{
      resourcesByPathname: Record<string, Array<{ bodyPath: string; projectionPath?: string | null; requestPath: string; metaPath: string }>>;
    }>(root, ".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json");
    expect(manifest?.resourcesByPathname["/styles/app.css"]).toEqual([
      expect.objectContaining({
        bodyPath: descriptor.bodyPath,
        projectionPath: descriptor.projectionPath,
        requestPath: descriptor.requestPath,
        metaPath: descriptor.metaPath
      })
    ]);
  });

  it("stores query variants canonically while keeping the first visible projection", async () => {
    const root = createMemoryRoot();
    const storage = createMemoryStorage();
    const repository = createFixtureRepository({
      root,
      sentinel,
      storage
    });
    const firstDescriptor = await createDescriptor({
      url: "https://cdn.example.com/assets/a.js?prop1=&prop2=B"
    });
    const secondDescriptor = await createDescriptor({
      url: "https://cdn.example.com/assets/a.js?cache-bust=true&retry-attempt=2"
    });

    expect(firstDescriptor.bodyPath).not.toBe(secondDescriptor.bodyPath);
    expect(firstDescriptor.projectionPath).toBe(secondDescriptor.projectionPath);
    expect(firstDescriptor.requestPath).not.toBe(secondDescriptor.requestPath);
    expect(firstDescriptor.metaPath).not.toBe(secondDescriptor.metaPath);

    const firstWrite = await repository.writeIfAbsent({
      descriptor: firstDescriptor,
      request: createRequestPayload(firstDescriptor),
      response: {
        body: "console.log('shared body');",
        bodyEncoding: "utf8",
        meta: {
          ...createResponseMeta(firstDescriptor, {
            mimeType: "application/javascript",
            resourceType: "Script",
            bodySuggestedExtension: "js"
          }),
          headers: [{ name: "Content-Type", value: "application/javascript" }]
        }
      }
    });
    const secondWrite = await repository.writeIfAbsent({
      descriptor: secondDescriptor,
      request: createRequestPayload(secondDescriptor),
      response: {
        body: "console.log('new body should not overwrite');",
        bodyEncoding: "utf8",
        meta: {
          ...createResponseMeta(secondDescriptor, {
            mimeType: "application/javascript",
            resourceType: "Script",
            bodySuggestedExtension: "js"
          }),
          headers: [
            { name: "Content-Type", value: "application/javascript" },
            { name: "Access-Control-Allow-Origin", value: "https://app.example.com" }
          ]
        }
      }
    });

    expect(firstWrite.written).toBe(true);
    expect(secondWrite.written).toBe(true);
    expect(Buffer.from(root.files.get(firstDescriptor.bodyPath) || new Uint8Array()).toString("utf8")).toBe(
      "console.log('shared body');"
    );
    expect(Buffer.from(root.files.get(secondDescriptor.bodyPath) || new Uint8Array()).toString("utf8")).toBe(
      "console.log('new body should not overwrite');"
    );
    expect(Buffer.from(root.files.get(firstDescriptor.projectionPath!) || new Uint8Array()).toString("utf8")).toBe(
      "console.log(\"shared body\");"
    );
    expect(await storage.readOptionalJson<ResponseMeta>(root, firstDescriptor.metaPath)).toEqual(
      expect.objectContaining({
        headers: [{ name: "Content-Type", value: "application/javascript" }]
      })
    );
    expect(await storage.readOptionalJson<ResponseMeta>(root, secondDescriptor.metaPath)).toEqual(
      expect.objectContaining({
        headers: [
          { name: "Content-Type", value: "application/javascript" },
          { name: "Access-Control-Allow-Origin", value: "https://app.example.com" }
        ]
      })
    );
    expect((await repository.read(secondDescriptor))?.meta.headers).toEqual([
      { name: "Content-Type", value: "application/javascript" },
      { name: "Access-Control-Allow-Origin", value: "https://app.example.com" }
    ]);
    expect(Buffer.from((await repository.read(secondDescriptor))!.bodyBase64, "base64").toString("utf8")).toBe(
      "console.log(\"shared body\");"
    );

    const manifest = await storage.readOptionalJson<{
      resourcesByPathname: Record<string, Array<{ requestUrl: string; search: string; bodyPath: string; projectionPath?: string | null }>>;
    }>(root, ".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json");
    expect(manifest?.resourcesByPathname["/assets/a.js"]).toEqual([
      expect.objectContaining({
        requestUrl: secondDescriptor.requestUrl,
        search: "?cache-bust=true&retry-attempt=2",
        bodyPath: secondDescriptor.bodyPath
      }),
      expect.objectContaining({
        requestUrl: firstDescriptor.requestUrl,
        search: "?prop1=&prop2=B",
        bodyPath: firstDescriptor.bodyPath,
        projectionPath: firstDescriptor.projectionPath
      })
    ]);
  });

  it("serves the visible projection body over the canonical snapshot when replaying assets", async () => {
    const root = createMemoryRoot();
    const storage = createMemoryStorage();
    const repository = createFixtureRepository({
      root,
      sentinel,
      storage
    });
    const descriptor = await createDescriptor();
    const request = createRequestPayload(descriptor);
    const meta = createResponseMeta(descriptor, {
      mimeType: "application/javascript",
      resourceType: "Script",
      bodySuggestedExtension: "js"
    });

    await repository.writeIfAbsent({
      descriptor,
      request,
      response: {
        body: "console.log('canonical');",
        bodyEncoding: "utf8",
        meta
      }
    });
    await storage.writeBody(root, descriptor.projectionPath!, {
      body: "console.log('edited projection');",
      bodyEncoding: "utf8"
    });

    expect(Buffer.from((await repository.read(descriptor))!.bodyBase64, "base64").toString("utf8")).toBe(
      "console.log('edited projection');"
    );
  });

  it("does not replay a query-bearing simple-mode asset from a bare visible file without matching sidecars", async () => {
    const root = createMemoryRoot();
    const storage = createMemoryStorage();
    const repository = createFixtureRepository({
      root,
      sentinel,
      storage
    });
    const descriptor = await createDescriptor({
      url: "https://cdn.example.com/assets/a.js?prop1=&prop2=B"
    });

    await storage.writeBody(root, descriptor.projectionPath!, {
      body: "console.log('projection only');",
      bodyEncoding: "utf8"
    });

    expect(await repository.exists(descriptor)).toBe(false);
    expect(await repository.read(descriptor)).toBeNull();
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
    expect(await storage.readOptionalJson(root, ".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json")).toBeNull();
    expect(await repository.read(descriptor)).toEqual({
      request,
      meta,
      bodyBase64: Buffer.from(body, "utf8").toString("base64"),
      size: Buffer.byteLength(body)
    });
  });
});
