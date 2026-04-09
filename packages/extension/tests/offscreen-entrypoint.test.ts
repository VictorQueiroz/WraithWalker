import { afterEach, describe, expect, it, vi } from "vitest";
import { STATIC_RESOURCE_MANIFEST_FILE } from "../src/lib/constants.js";
import { createFixtureDescriptor } from "../src/lib/fixture-mapper.js";

class MemoryFileHandle {
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

  async *[Symbol.asyncIterator](): AsyncGenerator<[string, { kind: "directory" | "file" }]> {
    for (const [name, directory] of this.directories) {
      yield [name, { kind: "directory", ...directory }];
    }

    for (const [name, file] of this.files) {
      yield [name, { kind: "file", ...file }];
    }
  }
}

async function writeMemoryFile(rootHandle: MemoryDirectoryHandle, relativePath: string, value: string | ArrayBuffer | ArrayBufferView) {
  const parts = relativePath.split("/").filter(Boolean);
  const fileName = parts.pop();
  let current = rootHandle;

  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }

  const handle = await current.getFileHandle(fileName, { create: true });
  const writer = await handle.createWritable();
  await writer.write(value);
  await writer.close();
}

async function loadOffscreenModule() {
  vi.resetModules();
  globalThis.__WRAITHWALKER_TEST__ = true;
  return import("../src/offscreen.ts");
}

async function loadOffscreenModuleOutsideTestMode() {
  vi.resetModules();
  delete globalThis.__WRAITHWALKER_TEST__;
  return import("../src/offscreen.ts");
}

afterEach(() => {
  delete globalThis.__WRAITHWALKER_TEST__;
  delete globalThis.chrome;
  vi.doUnmock("../src/lib/context-generator.js");
  vi.doUnmock("../src/lib/root-runtime.js");
  vi.restoreAllMocks();
});

describe("offscreen entrypoint", () => {
  it("ignores non-offscreen messages and reports root-state errors through fixture handlers", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      ensureRootSentinel: vi.fn(),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn()
    });

    await expect(runtime.handleMessage({ type: "session.getState" })).resolves.toBeUndefined();
    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.hasFixture",
        payload: {
          descriptor: {
            bodyPath: "fixtures/missing.bin",
            requestPath: "fixtures/missing.request.json",
            metaPath: "fixtures/missing.meta.json"
          }
        }
      })
    ).resolves.toEqual({
      ok: false,
      error: "No root directory selected.",
      permission: undefined
    });
  });

  it("returns a root error when no directory handle is stored", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      ensureRootSentinel: vi.fn(),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn()
    });

    await expect(runtime.handleMessage({ target: "offscreen", type: "fs.ensureRoot" })).resolves.toEqual({
      ok: false,
      error: "No root directory selected."
    });
  });

  it("returns the sentinel and permission when ensure-root succeeds", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const rootHandle = new MemoryDirectoryHandle();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-ensure" }),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn().mockResolvedValue("granted")
    });

    await expect(runtime.handleMessage({ target: "offscreen", type: "fs.ensureRoot" })).resolves.toEqual({
      ok: true,
      sentinel: { rootId: "root-ensure" },
      permission: "granted"
    });
  });

  it("returns the denied permission state when ensure-root requests access and the user declines", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const rootHandle = new MemoryDirectoryHandle();
    const queryRootPermission = vi.fn().mockResolvedValue("prompt");
    const requestRootPermission = vi.fn().mockResolvedValue("denied");
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      ensureRootSentinel: vi.fn(),
      queryRootPermission,
      requestRootPermission
    });

    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.ensureRoot",
        payload: { requestPermission: true }
      })
    ).resolves.toEqual({
      ok: false,
      error: "Root directory access is not granted.",
      permission: "denied"
    });
    expect(queryRootPermission).toHaveBeenCalledWith(rootHandle);
    expect(requestRootPermission).toHaveBeenCalledWith(rootHandle);
  });

  it("reads and writes configured site configs through the selected root", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const rootHandle = new MemoryDirectoryHandle();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-config" }),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn().mockResolvedValue("granted")
    });

    await expect(
      runtime.handleMessage({ target: "offscreen", type: "fs.readConfiguredSiteConfigs" })
    ).resolves.toEqual({
      ok: true,
      sentinel: { rootId: "root-config" },
      siteConfigs: []
    });

    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.writeConfiguredSiteConfigs",
        payload: {
          siteConfigs: [{
            origin: "app.example.com",
            createdAt: "2026-04-08T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.svg$"]
          }]
        }
      })
    ).resolves.toEqual({
      ok: true,
      sentinel: { rootId: "root-config" },
      siteConfigs: [{
        origin: "https://app.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.svg$"]
      }]
    });

    const metadataHandle = await rootHandle.getDirectoryHandle(".wraithwalker");
    const configHandle = await metadataHandle.getFileHandle("config.json");
    expect(JSON.parse(await (await configHandle.getFile()).text())).toEqual({
      schemaVersion: 1,
      sites: [{
        origin: "https://app.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.svg$"]
      }]
    });
  });

  it("reads effective site configs by merging configured and discovered origins", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const rootHandle = new MemoryDirectoryHandle();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-effective" }),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn().mockResolvedValue("granted")
    });

    await runtime.handleMessage({
      target: "offscreen",
      type: "fs.writeConfiguredSiteConfigs",
      payload: {
        siteConfigs: [{
          origin: "https://app.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.svg$"]
        }]
      }
    });
    await writeMemoryFile(
      rootHandle,
      ".wraithwalker/manifests/https__admin.example.com/RESOURCE_MANIFEST.json",
      JSON.stringify({ schemaVersion: 1, resourcesByPathname: {} })
    );

    await expect(
      runtime.handleMessage({ target: "offscreen", type: "fs.readEffectiveSiteConfigs" })
    ).resolves.toEqual({
      ok: true,
      sentinel: { rootId: "root-effective" },
      siteConfigs: [
        {
          origin: "https://admin.example.com",
          createdAt: "1970-01-01T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.m?(js|ts)x?$", "\\.css$", "\\.wasm$"]
        },
        {
          origin: "https://app.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.svg$"]
        }
      ]
    });
  });

  it("reports root-state errors through site-config handlers", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      ensureRootSentinel: vi.fn(),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn()
    });

    await expect(
      runtime.handleMessage({ target: "offscreen", type: "fs.readConfiguredSiteConfigs" })
    ).resolves.toEqual({
      ok: false,
      error: "No root directory selected.",
      permission: undefined
    });
    await expect(
      runtime.handleMessage({ target: "offscreen", type: "fs.readEffectiveSiteConfigs" })
    ).resolves.toEqual({
      ok: false,
      error: "No root directory selected.",
      permission: undefined
    });
    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.writeConfiguredSiteConfigs",
        payload: {
          siteConfigs: []
        }
      })
    ).resolves.toEqual({
      ok: false,
      error: "No root directory selected.",
      permission: undefined
    });
  });

  it("reports denied-permission root errors through fixture handlers", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const rootHandle = new MemoryDirectoryHandle();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      ensureRootSentinel: vi.fn(),
      queryRootPermission: vi.fn().mockResolvedValue("denied"),
      requestRootPermission: vi.fn().mockResolvedValue("denied")
    });
    const descriptor = {
      bodyPath: "fixtures/blocked.bin",
      requestPath: "fixtures/blocked.request.json",
      metaPath: "fixtures/blocked.meta.json"
    };

    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.readFixture",
        payload: { descriptor }
      })
    ).resolves.toEqual({
      ok: false,
      error: "Root directory access is not granted.",
      permission: "denied"
    });

    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.writeFixture",
        payload: {
          descriptor,
          request: {
            topOrigin: "https://app.example.com",
            url: "https://cdn.example.com/blocked.bin",
            method: "GET",
            headers: [],
            body: "",
            bodyEncoding: "utf8",
            bodyHash: "",
            queryHash: "",
            capturedAt: "2026-04-03T00:00:00.000Z"
          },
          response: {
            body: "",
            bodyEncoding: "utf8",
            meta: {
              status: 200,
              statusText: "OK",
              headers: [],
              url: "https://cdn.example.com/blocked.bin",
              method: "GET",
              capturedAt: "2026-04-03T00:00:00.000Z",
              bodyEncoding: "utf8"
            }
          }
        }
      })
    ).resolves.toEqual({
      ok: false,
      error: "Root directory access is not granted.",
      permission: "denied"
    });
  });

  it("writes, detects, and reads fixtures from the selected root", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const rootHandle = new MemoryDirectoryHandle();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-1" }),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn().mockResolvedValue("granted")
    });
    const descriptor = {
      bodyPath: "fixtures/app.js",
      requestPath: "fixtures/app.js.__request.json",
      metaPath: "fixtures/app.js.__response.json"
    };

    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.writeFixture",
        payload: {
          descriptor,
          request: {
            topOrigin: "https://app.example.com",
            url: "https://cdn.example.com/app.js",
            method: "GET",
            headers: [],
            body: "",
            bodyEncoding: "utf8",
            bodyHash: "",
            queryHash: "",
            capturedAt: "2026-04-03T00:00:00.000Z"
          },
          response: {
            body: "console.log('hello');",
            bodyEncoding: "utf8",
            meta: {
              status: 200,
              statusText: "OK",
              headers: [{ name: "Content-Type", value: "application/javascript" }],
              mimeType: "application/javascript",
              resourceType: "Script",
              url: "https://cdn.example.com/app.js",
              method: "GET",
              capturedAt: "2026-04-03T00:00:00.000Z",
              bodyEncoding: "utf8",
              bodySuggestedExtension: "js"
            }
          }
        }
      })
    ).resolves.toEqual({
      ok: true,
      descriptor,
      sentinel: { rootId: "root-1" }
    });

    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.hasFixture",
        payload: { descriptor }
      })
    ).resolves.toEqual({
      ok: true,
      exists: true
    });

    const readResult = await runtime.handleMessage({
      target: "offscreen",
      type: "fs.readFixture",
      payload: { descriptor }
    });

    expect(readResult).toMatchObject({
      ok: true,
      exists: true,
      meta: {
        status: 200
      },
      sentinel: {
        rootId: "root-1"
      }
    });
    expect(readResult && "bodyBase64" in readResult ? readResult.bodyBase64 : undefined).toBeTypeOf("string");
  });

  it("serves edited visible projection bodies when reading fixtures from the selected root", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const rootHandle = new MemoryDirectoryHandle();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-projection" }),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn().mockResolvedValue("granted")
    });
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/app.js"
    });

    await runtime.handleMessage({
      target: "offscreen",
      type: "fs.writeFixture",
      payload: {
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
          body: "console.log('canonical');",
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
      }
    });
    await writeMemoryFile(rootHandle, descriptor.projectionPath!, "console.log('edited projection');");

    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.readFixture",
        payload: { descriptor }
      })
    ).resolves.toEqual(expect.objectContaining({
      ok: true,
      exists: true,
      bodyBase64: Buffer.from("console.log('edited projection');", "utf8").toString("base64"),
      sentinel: { rootId: "root-projection" }
    }));
  });

  it("returns root-state errors when fixture writes are attempted without a selected root", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      ensureRootSentinel: vi.fn(),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn()
    });

    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.writeFixture",
        payload: {
          descriptor: {
            bodyPath: "fixtures/app.js",
            requestPath: "fixtures/app.js.__request.json",
            metaPath: "fixtures/app.js.__response.json"
          },
          request: {
            topOrigin: "https://app.example.com",
            url: "https://cdn.example.com/app.js",
            method: "GET",
            headers: [],
            body: "",
            bodyEncoding: "utf8",
            bodyHash: "",
            queryHash: "",
            capturedAt: "2026-04-03T00:00:00.000Z"
          },
          response: {
            body: "console.log('hello');",
            bodyEncoding: "utf8",
            meta: {
              status: 200,
              statusText: "OK",
              headers: [{ name: "Content-Type", value: "application/javascript" }],
              mimeType: "application/javascript",
              resourceType: "Script",
              url: "https://cdn.example.com/app.js",
              method: "GET",
              capturedAt: "2026-04-03T00:00:00.000Z",
              bodyEncoding: "utf8",
              bodySuggestedExtension: "js"
            }
          }
        }
      })
    ).resolves.toEqual({
      ok: false,
      error: "No root directory selected.",
      permission: undefined
    });
  });

  it("generates editor context from the selected root", async () => {
    const rootHandle = new MemoryDirectoryHandle();
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-context" }),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn().mockResolvedValue("granted")
    });

    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.generateContext",
        payload: {
          editorId: "cursor",
          siteConfigs: [{ origin: "https://app.example.com", createdAt: "2026-04-03T00:00:00.000Z" }]
        }
      })
    ).resolves.toEqual({ ok: true });

    const claudeHandle = await rootHandle.getFileHandle("CLAUDE.md");
    const cursorRulesHandle = await rootHandle.getFileHandle(".cursorrules");
    expect(await (await claudeHandle.getFile()).text()).toContain("WraithWalker Fixture Context");
    expect(await (await cursorRulesHandle.getFile()).text()).toContain("Cursor Agent Brief");
  });

  it("returns a root-state error when generating editor context without a selected root", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      ensureRootSentinel: vi.fn(),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn()
    });

    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.generateContext",
        payload: {
          editorId: "cursor",
          siteConfigs: []
        }
      })
    ).resolves.toEqual({
      ok: false,
      error: "No root directory selected.",
      permission: undefined
    });
  });

  it("writes a per-domain JSON manifest for mirrored static assets", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const rootHandle = new MemoryDirectoryHandle();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-5" }),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn().mockResolvedValue("granted")
    });

    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/app.bundle.js?v=123",
      resourceType: "Script"
    });

    await runtime.handleMessage({
      target: "offscreen",
      type: "fs.writeFixture",
      payload: {
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
          body: "console.log('hello');",
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
      }
    });

    const metadataDir = await rootHandle.getDirectoryHandle(".wraithwalker");
    const manifestsDir = await metadataDir.getDirectoryHandle("manifests");
    const domainDirectory = await manifestsDir.getDirectoryHandle(descriptor.topOriginKey);
    const manifestHandle = await domainDirectory.getFileHandle(STATIC_RESOURCE_MANIFEST_FILE);
    const manifest = JSON.parse(await (await manifestHandle.getFile()).text());

    expect(manifest.topOrigin).toBe("https://app.example.com");
    expect(manifest.resourcesByPathname["/static/app.bundle.js"]).toEqual([
      expect.objectContaining({
        requestUrl: descriptor.requestUrl,
        requestOrigin: "https://cdn.example.com",
        bodyPath: expect.stringMatching(
          /^\.wraithwalker\/captures\/assets\/https__app\.example\.com\/cdn\.example\.com\/static\/app\.bundle\.js\.__q-/
        ),
        requestPath: expect.stringMatching(/__request\.json$/),
        metaPath: expect.stringMatching(/__response\.json$/),
        mimeType: "application/javascript",
        resourceType: "Script"
      })
    ]);
  });

  it("requires canonical metadata for simple-mode fixtures even when a visible mirrored file exists", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const rootHandle = new MemoryDirectoryHandle();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-6" }),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn().mockResolvedValue("granted")
    });

    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/chunk-a.js"
    });

    await writeMemoryFile(rootHandle, descriptor.bodyPath, "console.log('simple');");

    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.hasFixture",
        payload: { descriptor }
      })
    ).resolves.toEqual({
      ok: true,
      exists: false
    });

    await expect(runtime.handleMessage({
      target: "offscreen",
      type: "fs.readFixture",
      payload: { descriptor }
    })).resolves.toEqual({
      ok: true,
      exists: false
    });
  });

  it("does not replay query-bearing simple-mode fixtures from a bare visible mirrored file without sidecars", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const rootHandle = new MemoryDirectoryHandle();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-6b" }),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn().mockResolvedValue("granted")
    });

    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/chunk-a.js?v=1"
    });

    await writeMemoryFile(rootHandle, descriptor.bodyPath, "console.log('simple');");

    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.hasFixture",
        payload: { descriptor }
      })
    ).resolves.toEqual({
      ok: true,
      exists: false
    });

    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.readFixture",
        payload: { descriptor }
      })
    ).resolves.toEqual({
      ok: true,
      exists: false
    });
  });

  it("writes the simple-mode manifest into the hidden metadata tree", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const rootHandle = new MemoryDirectoryHandle();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-7" }),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn().mockResolvedValue("granted")
    });

    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/chunk-a.js"
    });

    await runtime.handleMessage({
      target: "offscreen",
      type: "fs.writeFixture",
      payload: {
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
          body: "console.log('hello');",
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
      }
    });

    const manifestDir = await rootHandle.getDirectoryHandle(".wraithwalker");
    const manifestsDir = await manifestDir.getDirectoryHandle("manifests");
    const topOriginDir = await manifestsDir.getDirectoryHandle(descriptor.topOriginKey);
    const manifestHandle = await topOriginDir.getFileHandle(STATIC_RESOURCE_MANIFEST_FILE);
    const manifest = JSON.parse(await (await manifestHandle.getFile()).text());

    expect(manifest.resourcesByPathname["/assets/chunk-a.js"]).toEqual([
      expect.objectContaining({
        bodyPath: descriptor.bodyPath,
        projectionPath: descriptor.projectionPath,
        requestPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/chunk-a.js.__request.json"
      })
    ]);
  });

  it("requests root permission on demand and supports binary fixture bodies", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const rootHandle = new MemoryDirectoryHandle();
    const requestRootPermission = vi.fn().mockResolvedValue("granted");
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-2" }),
      queryRootPermission: vi.fn().mockResolvedValueOnce("prompt").mockResolvedValue("granted"),
      requestRootPermission,
      base64ToBytes: (value) => Uint8Array.from(Buffer.from(value, "base64")),
      arrayBufferToBase64: (buffer) => Buffer.from(buffer).toString("base64")
    });
    const descriptor = {
      bodyPath: "fixtures/font.woff2",
      requestPath: "fixtures/font.request.json",
      metaPath: "fixtures/font.meta.json"
    };

    await expect(runtime.getRootState({ requestPermission: true })).resolves.toMatchObject({
      ok: true,
      permission: "granted",
      sentinel: { rootId: "root-2" }
    });
    expect(requestRootPermission).toHaveBeenCalledWith(rootHandle);

    await runtime.handleMessage({
      target: "offscreen",
      type: "fs.writeFixture",
      payload: {
        descriptor,
        request: {
          topOrigin: "https://app.example.com",
          url: "https://cdn.example.com/font.woff2",
          method: "GET",
          headers: [],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: "",
          queryHash: "",
          capturedAt: "2026-04-03T00:00:00.000Z"
        },
        response: {
          body: "AQID",
          bodyEncoding: "base64",
          meta: {
            status: 200,
            statusText: "OK",
            headers: [{ name: "Content-Type", value: "font/woff2" }],
            mimeType: "font/woff2",
            resourceType: "Font",
            url: "https://cdn.example.com/font.woff2",
            method: "GET",
            capturedAt: "2026-04-03T00:00:00.000Z",
            bodyEncoding: "base64",
            bodySuggestedExtension: "woff2"
          }
        }
      }
    });

    await expect(
      runtime.handleMessage({
        target: "offscreen",
        type: "fs.readFixture",
        payload: { descriptor }
      })
    ).resolves.toMatchObject({
      ok: true,
      exists: true,
      bodyBase64: "AQID"
    });
  });

  it("returns explicit errors for denied root permission and missing fixture files", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const permittedRoot = new MemoryDirectoryHandle();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(permittedRoot),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-3" }),
      queryRootPermission: vi.fn().mockResolvedValue("denied"),
      requestRootPermission: vi.fn().mockResolvedValue("denied")
    });

    await expect(runtime.getRootState()).resolves.toEqual({
      ok: false,
      error: "Root directory access is not granted.",
      permission: "denied"
    });

    const readableRuntime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(new MemoryDirectoryHandle()),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-4" }),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn().mockResolvedValue("granted")
    });

    await expect(
      readableRuntime.handleMessage({
        target: "offscreen",
        type: "fs.readFixture",
        payload: {
          descriptor: {
            bodyPath: "fixtures/absent.bin",
            requestPath: "fixtures/absent.request.json",
            metaPath: "fixtures/absent.meta.json"
          }
        }
      })
    ).resolves.toEqual({
      ok: true,
      exists: false
    });
  });

  it("returns an explicit error for unknown offscreen messages", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      }
    });

    await expect(
      runtime.handleMessage({ target: "offscreen", type: "fs.unknown" })
    ).resolves.toEqual({
      ok: false,
      error: "Unknown offscreen message: fs.unknown"
    });
  });

  it("registers a runtime listener that forwards responses", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const listeners = [];
    const runtimeApi = {
      onMessage: {
        addListener: vi.fn((listener) => listeners.push(listener))
      }
    };
    const runtime = createOffscreenRuntime({
      runtime: runtimeApi,
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined)
    });

    runtime.register();
    const sendResponse = vi.fn();
    const handled = listeners[0]({ target: "offscreen", type: "fs.ensureRoot" }, {}, sendResponse);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handled).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: "No root directory selected."
    });
  });

  it("registers listener branches for ignored and rejected runtime messages", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const listeners = [];
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn((listener) => listeners.push(listener))
        }
      },
      loadStoredRootHandle: vi.fn().mockRejectedValue(new Error("Storage failed."))
    });

    runtime.register();
    expect(listeners[0]({ type: "session.getState" }, {}, vi.fn())).toBeUndefined();

    const sendResponse = vi.fn();
    const handled = listeners[0]({ target: "offscreen", type: "fs.ensureRoot" }, {}, sendResponse);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handled).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: "Storage failed."
    });
  });

  it("registers listener branches for runtime failures after root resolution succeeds", async () => {
    vi.doMock("../src/lib/root-runtime.js", () => ({
      createExtensionRootRuntime: vi.fn(() => ({
        ensureReady: vi.fn().mockResolvedValue({ rootId: "root-register-error" }),
        generateContext: vi.fn().mockRejectedValue(new Error("Context generation failed."))
      }))
    }));
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const listeners = [];
    const runtime = createOffscreenRuntime({
      runtime: {
        onMessage: {
          addListener: vi.fn((listener) => listeners.push(listener))
        }
      },
      loadStoredRootHandle: vi.fn().mockResolvedValue(new MemoryDirectoryHandle()),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-register-error" }),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn().mockResolvedValue("granted")
    });

    runtime.register();
    const sendResponse = vi.fn();
    const handled = listeners[0]({
      target: "offscreen",
      type: "fs.generateContext",
      payload: {
        editorId: "cursor",
        siteConfigs: []
      }
    }, {}, sendResponse);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handled).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: "Context generation failed."
    });
  });

  it("bootstraps with the default runtime listener", async () => {
    const { bootstrapOffscreen } = await loadOffscreenModule();
    const chromeApi = {
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      }
    };
    globalThis.chrome = chromeApi as any;

    bootstrapOffscreen();

    expect(chromeApi.runtime.onMessage.addListener).toHaveBeenCalled();
  });

  it("bootstraps automatically outside test mode", async () => {
    const chromeApi = {
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      }
    };
    globalThis.chrome = chromeApi as any;

    await loadOffscreenModuleOutsideTestMode();

    expect(chromeApi.runtime.onMessage.addListener).toHaveBeenCalled();
  });
});
