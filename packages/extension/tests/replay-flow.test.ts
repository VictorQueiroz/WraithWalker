import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DUMP_ALLOWLIST_PATTERN } from "../src/lib/constants.js";
import { createFixtureDescriptor } from "../src/lib/fixture-mapper.js";
import { createRequestLifecycle } from "../src/lib/request-lifecycle.js";
import type { SiteConfig } from "../src/lib/types.js";

class MemoryFileHandle {
  bytes: Uint8Array;

  constructor() {
    this.bytes = new Uint8Array();
  }

  async getFile() {
    const bytes = this.bytes;
    return {
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ),
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
          this.bytes = new Uint8Array(
            chunk.buffer.slice(
              chunk.byteOffset,
              chunk.byteOffset + chunk.byteLength
            )
          );
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

  async getDirectoryHandle(
    name: string,
    { create = false }: { create?: boolean } = {}
  ) {
    if (!this.directories.has(name)) {
      if (!create) {
        throw new Error(`Missing directory: ${name}`);
      }
      this.directories.set(name, new MemoryDirectoryHandle());
    }

    return this.directories.get(name);
  }

  async getFileHandle(
    name: string,
    { create = false }: { create?: boolean } = {}
  ) {
    if (!this.files.has(name)) {
      if (!create) {
        throw new Error(`Missing file: ${name}`);
      }
      this.files.set(name, new MemoryFileHandle());
    }

    return this.files.get(name);
  }
}

async function resolveMemoryFileHandle(
  rootHandle: MemoryDirectoryHandle,
  relativePath: string,
  create = false
) {
  const parts = relativePath.split("/").filter(Boolean);
  const fileName = parts.pop();
  let current = rootHandle;

  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create });
  }

  return current.getFileHandle(fileName, { create });
}

async function writeMemoryFile(
  rootHandle: MemoryDirectoryHandle,
  relativePath: string,
  value: string | ArrayBuffer | ArrayBufferView
) {
  const handle = await resolveMemoryFileHandle(rootHandle, relativePath, true);
  const writer = await handle.createWritable();
  await writer.write(value);
  await writer.close();
}

async function readMemoryText(
  rootHandle: MemoryDirectoryHandle,
  relativePath: string
) {
  const handle = await resolveMemoryFileHandle(rootHandle, relativePath, false);
  const file = await handle.getFile();
  return file.text();
}

async function loadOffscreenModule() {
  vi.resetModules();
  globalThis.__WRAITHWALKER_TEST__ = true;
  return import("../src/offscreen.ts");
}

afterEach(() => {
  delete globalThis.__WRAITHWALKER_TEST__;
  vi.restoreAllMocks();
});

describe("capture and replay flow", () => {
  it("dumps a file, preserves manual edits, and replays the edited file", async () => {
    const { createOffscreenRuntime } = await loadOffscreenModule();
    const rootHandle = new MemoryDirectoryHandle();
    const offscreen = createOffscreenRuntime({
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

    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-03T00:00:00.000Z",
      dumpAllowlistPatterns: [DEFAULT_DUMP_ALLOWLIST_PATTERN]
    };
    const sendDebuggerCommandMock = vi.fn(
      async (
        _tabId: number,
        method: string,
        params?: Record<string, unknown>
      ) => {
        if (method === "Network.getResponseBody") {
          return {
            body: "console.log('captured');",
            base64Encoded: false
          };
        }
        return { method, params };
      }
    );
    const sendDebuggerCommand: Parameters<
      typeof createRequestLifecycle
    >[0]["sendDebuggerCommand"] = (tabId, method, params) =>
      sendDebuggerCommandMock(tabId, method, params) as Promise<any>;
    const sendOffscreenMessage: Parameters<
      typeof createRequestLifecycle
    >[0]["sendOffscreenMessage"] = (type, payload = {}) =>
      offscreen.handleMessage({
        target: "offscreen",
        type,
        payload
      }) as Promise<any>;
    const lifecycle = createRequestLifecycle({
      state: {
        sessionActive: true,
        attachedTabs: new Map([[1, { topOrigin: siteConfig.origin }]]),
        requests: new Map()
      },
      sendDebuggerCommand,
      sendOffscreenMessage,
      setLastError: vi.fn(),
      getSiteConfigForOrigin: (topOrigin) =>
        topOrigin === siteConfig.origin ? siteConfig : undefined,
      createFixtureDescriptor
    });

    lifecycle.handleNetworkRequestWillBeSent(
      { tabId: 1 },
      {
        requestId: "req-capture",
        request: {
          method: "GET",
          url: "https://cdn.example.com/assets/app.js",
          headers: {}
        },
        type: "Script"
      }
    );
    lifecycle.handleNetworkResponseReceived(
      { tabId: 1 },
      {
        requestId: "req-capture",
        response: {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/javascript" },
          mimeType: "application/javascript"
        },
        type: "Script"
      }
    );
    await lifecycle.handleNetworkLoadingFinished(
      { tabId: 1 },
      { requestId: "req-capture" }
    );

    const descriptor = await createFixtureDescriptor({
      topOrigin: siteConfig.origin,
      method: "GET",
      url: "https://cdn.example.com/assets/app.js",
      resourceType: "Script"
    });

    expect(await readMemoryText(rootHandle, descriptor.bodyPath)).toBe(
      "console.log('captured');"
    );
    expect(await readMemoryText(rootHandle, descriptor.projectionPath!)).toBe(
      'console.log("captured");'
    );

    await writeMemoryFile(
      rootHandle,
      descriptor.projectionPath!,
      "console.log('edited');"
    );
    await offscreen.handleMessage({
      target: "offscreen",
      type: "fs.writeFixture",
      payload: {
        descriptor,
        request: {
          topOrigin: siteConfig.origin,
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
          body: "console.log('network-overwrite');",
          bodyEncoding: "utf8",
          meta: {
            status: 201,
            statusText: "Created",
            headers: [
              { name: "Content-Type", value: "application/javascript" }
            ],
            mimeType: "application/javascript",
            resourceType: "Script",
            url: descriptor.requestUrl,
            method: "GET",
            capturedAt: "2026-04-03T00:01:00.000Z",
            bodyEncoding: "utf8",
            bodySuggestedExtension: "js"
          }
        }
      }
    });

    expect(await readMemoryText(rootHandle, descriptor.bodyPath)).toBe(
      "console.log('captured');"
    );
    expect(await readMemoryText(rootHandle, descriptor.projectionPath!)).toBe(
      "console.log('edited');"
    );

    await lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      {
        requestId: "fetch-replay",
        networkId: "network-replay",
        request: {
          method: "GET",
          url: "https://cdn.example.com/assets/app.js",
          headers: {}
        },
        resourceType: "Script"
      }
    );

    const fulfillCall = sendDebuggerCommandMock.mock.calls.find(
      ([, method]) => method === "Fetch.fulfillRequest"
    );
    expect(fulfillCall).toBeTruthy();
    expect(fulfillCall[2]).toEqual(
      expect.objectContaining({
        requestId: "fetch-replay",
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "application/javascript" }
        ]
      })
    );
    const fulfillPayload = fulfillCall?.[2] as { body: string };
    expect(Buffer.from(fulfillPayload.body, "base64").toString("utf8")).toBe(
      "console.log('edited');"
    );
  });
});
