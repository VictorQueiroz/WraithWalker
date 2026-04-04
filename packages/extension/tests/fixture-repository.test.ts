import { describe, expect, it } from "vitest";

import { createFileSystemGateway } from "../src/lib/file-system-gateway.js";
import { createFixtureDescriptor } from "../src/lib/fixture-mapper.js";
import { createFixtureRepository } from "../src/lib/fixture-repository.js";
import { STATIC_RESOURCE_MANIFEST_FILE } from "../src/lib/constants.js";

class MemoryFileHandle {
  readonly kind = "file" as const;
  bytes: Uint8Array;

  constructor() {
    this.bytes = new Uint8Array();
  }

  async getFile() {
    const bytes = this.bytes;
    return {
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      size: bytes.byteLength
    };
  }

  async createWritable() {
    return {
      write: async (chunk: string | ArrayBuffer | ArrayBufferView) => {
        if (typeof chunk === "string") {
          this.bytes = new TextEncoder().encode(chunk);
          return;
        }
        if (chunk instanceof ArrayBuffer) {
          this.bytes = new Uint8Array(chunk);
          return;
        }
        if (ArrayBuffer.isView(chunk)) {
          this.bytes = new Uint8Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
          return;
        }
        throw new Error(`Unsupported write chunk: ${String(chunk)}`);
      },
      close: async () => {}
    };
  }
}

class MemoryDirectoryHandle {
  readonly kind = "directory" as const;
  directories: Map<string, MemoryDirectoryHandle>;
  files: Map<string, MemoryFileHandle>;

  constructor() {
    this.directories = new Map();
    this.files = new Map();
  }

  async getDirectoryHandle(name: string, { create = false }: { create?: boolean } = {}) {
    if (!this.directories.has(name)) {
      if (!create) {
        throw new Error(`Missing directory: ${name}`);
      }
      this.directories.set(name, new MemoryDirectoryHandle());
    }
    return this.directories.get(name);
  }

  async getFileHandle(name: string, { create = false }: { create?: boolean } = {}) {
    if (!this.files.has(name)) {
      if (!create) {
        throw new Error(`Missing file: ${name}`);
      }
      this.files.set(name, new MemoryFileHandle());
    }
    return this.files.get(name);
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<[string, { kind: string }]> {
    for (const [name, handle] of this.directories) {
      yield [name, handle as unknown as { kind: string }];
    }
    for (const [name, handle] of this.files) {
      yield [name, handle as unknown as { kind: string }];
    }
  }
}

function asFileSystemDirectoryHandle(handle: MemoryDirectoryHandle): FileSystemDirectoryHandle {
  return handle as unknown as FileSystemDirectoryHandle;
}

describe("fixture repository", () => {
  it("writes a fixture once and avoids overwriting an existing body file", async () => {
    const rootHandle = new MemoryDirectoryHandle();
    const gateway = createFileSystemGateway({
      base64ToBytes: (value) => Uint8Array.from(Buffer.from(value, "base64")),
      arrayBufferToBase64: (buffer) => Buffer.from(buffer).toString("base64")
    });
    const repository = createFixtureRepository({
      rootHandle: asFileSystemDirectoryHandle(rootHandle),
      sentinel: { rootId: "root-1", schemaVersion: 1, createdAt: "2026-04-03T00:00:00.000Z" },
      gateway
    });
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/app.js",
      siteMode: "simple"
    });

    const firstWrite = await repository.writeIfAbsent({
      descriptor,
      request: {
        topOrigin: "https://app.example.com",
        url: descriptor.requestUrl,
        method: "GET",
        headers: [],
        body: "",
        bodyEncoding: "utf8",
        bodyHash: descriptor.bodyHash,
        queryHash: descriptor.queryHash,
        capturedAt: "2026-04-03T00:00:00.000Z"
      },
      response: {
        body: "console.log('first');",
        bodyEncoding: "utf8",
        meta: {
          status: 200,
          statusText: "OK",
          headers: [{ name: "Content-Type", value: "application/javascript" }],
          mimeType: "application/javascript",
          resourceType: "Script",
          url: descriptor.requestUrl,
          method: "GET",
          capturedAt: "2026-04-03T00:00:00.000Z",
          bodyEncoding: "utf8",
          bodySuggestedExtension: "js"
        }
      }
    });

    const secondWrite = await repository.writeIfAbsent({
      descriptor,
      request: {
        topOrigin: "https://app.example.com",
        url: descriptor.requestUrl,
        method: "GET",
        headers: [],
        body: "",
        bodyEncoding: "utf8",
        bodyHash: descriptor.bodyHash,
        queryHash: descriptor.queryHash,
        capturedAt: "2026-04-03T00:01:00.000Z"
      },
      response: {
        body: "console.log('second');",
        bodyEncoding: "utf8",
        meta: {
          status: 200,
          statusText: "OK",
          headers: [{ name: "Content-Type", value: "application/javascript" }],
          mimeType: "application/javascript",
          resourceType: "Script",
          url: descriptor.requestUrl,
          method: "GET",
          capturedAt: "2026-04-03T00:01:00.000Z",
          bodyEncoding: "utf8",
          bodySuggestedExtension: "js"
        }
      }
    });

    expect(firstWrite.written).toBe(true);
    expect(secondWrite.written).toBe(false);

    const storedFixture = await repository.read(descriptor);
    expect(Buffer.from(storedFixture.bodyBase64, "base64").toString("utf8")).toBe("console.log('first');");
  });

  it("reads fallback metadata from a visible simple-mode file without sidecars", async () => {
    const rootHandle = new MemoryDirectoryHandle();
    const gateway = createFileSystemGateway({
      base64ToBytes: (value) => Uint8Array.from(Buffer.from(value, "base64")),
      arrayBufferToBase64: (buffer) => Buffer.from(buffer).toString("base64")
    });
    const repository = createFixtureRepository({
      rootHandle: asFileSystemDirectoryHandle(rootHandle),
      sentinel: { rootId: "root-2", schemaVersion: 1, createdAt: "2026-04-03T00:00:00.000Z" },
      gateway
    });
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/app.js?v=1",
      siteMode: "simple"
    });

    await gateway.writeBody(asFileSystemDirectoryHandle(rootHandle), descriptor.bodyPath, {
      body: "console.log('manual');",
      bodyEncoding: "utf8"
    });

    const fixture = await repository.read(descriptor);

    expect(fixture).toMatchObject({
      request: {
        url: descriptor.requestUrl,
        method: "GET"
      },
      meta: {
        status: 200,
        mimeType: "application/javascript"
      }
    });
  });

  it("writes manifests for asset-like fixtures", async () => {
    const rootHandle = new MemoryDirectoryHandle();
    const gateway = createFileSystemGateway({
      base64ToBytes: (value) => Uint8Array.from(Buffer.from(value, "base64")),
      arrayBufferToBase64: (buffer) => Buffer.from(buffer).toString("base64")
    });
    const repository = createFixtureRepository({
      rootHandle: asFileSystemDirectoryHandle(rootHandle),
      sentinel: { rootId: "root-3", schemaVersion: 1, createdAt: "2026-04-03T00:00:00.000Z" },
      gateway
    });
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/app.js",
      resourceType: "Script"
    });

    await repository.writeIfAbsent({
      descriptor,
      request: {
        topOrigin: "https://app.example.com",
        url: descriptor.requestUrl,
        method: "GET",
        headers: [],
        body: "",
        bodyEncoding: "utf8",
        bodyHash: descriptor.bodyHash,
        queryHash: descriptor.queryHash,
        capturedAt: "2026-04-03T00:00:00.000Z"
      },
      response: {
        body: "console.log('manifest');",
        bodyEncoding: "utf8",
        meta: {
          status: 200,
          statusText: "OK",
          headers: [{ name: "Content-Type", value: "application/javascript" }],
          mimeType: "application/javascript",
          resourceType: "Script",
          url: descriptor.requestUrl,
          method: "GET",
          capturedAt: "2026-04-03T00:00:00.000Z",
          bodyEncoding: "utf8",
          bodySuggestedExtension: "js"
        }
      }
    });

    const topOriginDir = await rootHandle.getDirectoryHandle(descriptor.topOriginKey);
    const manifestHandle = await topOriginDir.getFileHandle(STATIC_RESOURCE_MANIFEST_FILE);
    const manifest = JSON.parse(await (await manifestHandle.getFile()).text());

    expect(manifest.resourcesByPathname["/static/app.js"]).toHaveLength(1);
  });
});

describe("file system gateway", () => {
  function makeGateway() {
    return createFileSystemGateway({
      base64ToBytes: (value) => Uint8Array.from(Buffer.from(value, "base64")),
      arrayBufferToBase64: (buffer) => Buffer.from(buffer).toString("base64")
    });
  }

  it("reads a file as UTF-8 text via readText", async () => {
    const rootHandle = new MemoryDirectoryHandle();
    const gateway = makeGateway();

    await gateway.writeJson(asFileSystemDirectoryHandle(rootHandle), "data/test.json", { hello: "world" });

    const text = await gateway.readText(asFileSystemDirectoryHandle(rootHandle), "data/test.json");
    expect(JSON.parse(text)).toEqual({ hello: "world" });
  });

  it("lists directory entries with correct kinds", async () => {
    const rootHandle = new MemoryDirectoryHandle();
    const gateway = makeGateway();

    await gateway.writeJson(asFileSystemDirectoryHandle(rootHandle), "mydir/file-a.json", {});
    await gateway.writeJson(asFileSystemDirectoryHandle(rootHandle), "mydir/file-b.json", {});
    await gateway.writeJson(asFileSystemDirectoryHandle(rootHandle), "mydir/sub/nested.json", {});

    const entries = await gateway.listDirectory(asFileSystemDirectoryHandle(rootHandle), "mydir");

    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["file-a.json", "file-b.json", "sub"]);

    const fileEntry = entries.find((e) => e.name === "file-a.json");
    const dirEntry = entries.find((e) => e.name === "sub");
    expect(fileEntry?.kind).toBe("file");
    expect(dirEntry?.kind).toBe("directory");
  });

  it("lists the root directory when given an empty path", async () => {
    const rootHandle = new MemoryDirectoryHandle();
    const gateway = makeGateway();

    await gateway.writeJson(asFileSystemDirectoryHandle(rootHandle), "top-level.json", {});

    const entries = await gateway.listDirectory(asFileSystemDirectoryHandle(rootHandle), "");
    expect(entries).toEqual([{ name: "top-level.json", kind: "file" }]);
  });
});
