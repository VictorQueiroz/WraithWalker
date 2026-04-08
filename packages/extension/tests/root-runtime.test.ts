import { describe, expect, it, vi } from "vitest";

import { createFileSystemGateway } from "../src/lib/file-system-gateway.js";
import { createFixtureDescriptor } from "../src/lib/fixture-mapper.js";
import { createExtensionRootRuntime } from "../src/lib/root-runtime.js";
import type { SiteConfig } from "../src/lib/types.js";

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
  directories = new Map<string, MemoryDirectoryHandle>();
  files = new Map<string, MemoryFileHandle>();

  async getDirectoryHandle(name: string, { create = false }: { create?: boolean } = {}) {
    if (!this.directories.has(name)) {
      if (!create) {
        throw new Error(`Missing directory: ${name}`);
      }
      this.directories.set(name, new MemoryDirectoryHandle());
    }
    return this.directories.get(name)!;
  }

  async getFileHandle(name: string, { create = false }: { create?: boolean } = {}) {
    if (!this.files.has(name)) {
      if (!create) {
        throw new Error(`Missing file: ${name}`);
      }
      this.files.set(name, new MemoryFileHandle());
    }
    return this.files.get(name)!;
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

function asRootHandle(handle: MemoryDirectoryHandle): FileSystemDirectoryHandle {
  return handle as unknown as FileSystemDirectoryHandle;
}

function createGateway() {
  return createFileSystemGateway({
    base64ToBytes: (value) => Uint8Array.from(Buffer.from(value, "base64")),
    arrayBufferToBase64: (buffer) => Buffer.from(buffer).toString("base64")
  });
}

describe("extension root runtime adapter", () => {
  it("shares fixture and context operations through the browser file-system gateway", async () => {
    const rootHandle = new MemoryDirectoryHandle();
    const gateway = createGateway();
    const ensureSentinel = vi.fn().mockResolvedValue({
      rootId: "root-extension",
      schemaVersion: 1,
      createdAt: "2026-04-07T00:00:00.000Z"
    });
    const runtime = createExtensionRootRuntime({
      rootHandle: asRootHandle(rootHandle),
      gateway,
      ensureSentinel
    });
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://api.example.com/users",
      siteMode: "simple",
      resourceType: "Fetch",
      mimeType: "application/json"
    });
    const siteConfigs: SiteConfig[] = [{
      origin: "https://app.example.com",
      createdAt: "2026-04-07T00:00:00.000Z",
      mode: "simple",
      dumpAllowlistPatterns: ["\\.m?(js|ts)x?$", "\\.css$", "\\.wasm$"]
    }];

    expect(await runtime.ensureReady()).toMatchObject({ rootId: "root-extension" });
    expect(await runtime.has(descriptor)).toBe(false);

    await runtime.writeIfAbsent({
      descriptor,
      request: {
        topOrigin: descriptor.topOrigin,
        url: descriptor.requestUrl,
        method: descriptor.method,
        headers: [],
        body: "",
        bodyEncoding: "utf8",
        bodyHash: descriptor.bodyHash,
        queryHash: descriptor.queryHash,
        capturedAt: "2026-04-07T00:00:00.000Z"
      },
      response: {
        body: JSON.stringify({ users: [{ id: 1, name: "Alice" }] }),
        bodyEncoding: "utf8",
        meta: {
          status: 200,
          statusText: "OK",
          headers: [{ name: "Content-Type", value: "application/json" }],
          mimeType: "application/json",
          resourceType: "Fetch",
          url: descriptor.requestUrl,
          method: descriptor.method,
          capturedAt: "2026-04-07T00:00:00.000Z",
          bodyEncoding: "utf8",
          bodySuggestedExtension: "json"
        }
      }
    });

    expect(await runtime.has(descriptor)).toBe(true);
    const fixture = await runtime.read(descriptor);
    expect(fixture?.meta.mimeType).toBe("application/json");

    const markdown = await runtime.generateContext({
      editorId: "cursor",
      siteConfigs
    });

    expect(markdown).toContain("Cursor Agent Brief");
    expect(rootHandle.files.has("CLAUDE.md")).toBe(true);
    expect(rootHandle.files.has(".cursorrules")).toBe(true);
    expect(ensureSentinel).toHaveBeenCalledTimes(1);
  });

  it("persists guided traces through the browser root runtime adapter", async () => {
    const rootHandle = new MemoryDirectoryHandle();
    const runtime = createExtensionRootRuntime({
      rootHandle: asRootHandle(rootHandle),
      gateway: createGateway(),
      ensureSentinel: vi.fn().mockResolvedValue({
        rootId: "root-extension",
        schemaVersion: 1,
        createdAt: "2026-04-08T00:00:00.000Z"
      })
    });

    await runtime.startTrace({
      traceId: "trace-browser",
      selectedOrigins: ["https://app.example.com"],
      extensionClientId: "client-1",
      createdAt: "2026-04-08T00:00:00.000Z"
    });
    await runtime.recordClick({
      traceId: "trace-browser",
      step: {
        stepId: "step-1",
        tabId: 1,
        recordedAt: "2026-04-08T00:00:01.000Z",
        pageUrl: "https://app.example.com",
        topOrigin: "https://app.example.com",
        selector: "#primary-action",
        tagName: "button",
        textSnippet: "Continue"
      }
    });
    const linked = await runtime.linkFixture({
      traceId: "trace-browser",
      tabId: 1,
      requestedAt: "2026-04-08T00:00:02.000Z",
      fixture: {
        bodyPath: "cdn.example.com/assets/app.js",
        requestUrl: "https://cdn.example.com/assets/app.js",
        resourceType: "Script",
        capturedAt: "2026-04-08T00:00:02.500Z"
      }
    });

    expect(linked.linked).toBe(true);
    expect(await runtime.getActiveTrace()).toEqual(
      expect.objectContaining({
        traceId: "trace-browser",
        status: "recording"
      })
    );
  });
});
