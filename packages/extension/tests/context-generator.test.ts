import { describe, expect, it } from "vitest";

import { createFileSystemGateway } from "../src/lib/file-system-gateway.js";
import {
  createContextGenerator,
  inferJsonShape,
  EDITOR_CONTEXT_FILES
} from "../src/lib/context-generator.js";
import {
  FIXTURE_FILE_NAMES,
  STATIC_RESOURCE_MANIFEST_FILE
} from "../src/lib/constants.js";
import type {
  SiteConfig,
  StaticResourceManifest,
  ResponseMeta
} from "../src/lib/types.js";

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
  readonly kind = "directory" as const;
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
      if (!create) throw new Error(`Missing directory: ${name}`);
      this.directories.set(name, new MemoryDirectoryHandle());
    }
    return this.directories.get(name)!;
  }

  async getFileHandle(
    name: string,
    { create = false }: { create?: boolean } = {}
  ) {
    if (!this.files.has(name)) {
      if (!create) throw new Error(`Missing file: ${name}`);
      this.files.set(name, new MemoryFileHandle());
    }
    return this.files.get(name)!;
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<
    [string, { kind: string }]
  > {
    for (const [name, handle] of this.directories) {
      yield [name, handle as unknown as { kind: string }];
    }
    for (const [name, handle] of this.files) {
      yield [name, handle as unknown as { kind: string }];
    }
  }
}

function asRoot(handle: MemoryDirectoryHandle): FileSystemDirectoryHandle {
  return handle as unknown as FileSystemDirectoryHandle;
}

function makeGateway() {
  return createFileSystemGateway({
    base64ToBytes: (value) => Uint8Array.from(Buffer.from(value, "base64")),
    arrayBufferToBase64: (buffer) => Buffer.from(buffer).toString("base64")
  });
}

async function writeTextFile(
  gateway: ReturnType<typeof makeGateway>,
  root: FileSystemDirectoryHandle,
  path: string,
  text: string
) {
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop()!;
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  const fh = await dir.getFileHandle(fileName, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

describe("inferJsonShape", () => {
  it("infers primitive types", () => {
    expect(inferJsonShape("hello")).toBe("string");
    expect(inferJsonShape(42)).toBe("number");
    expect(inferJsonShape(true)).toBe("boolean");
    expect(inferJsonShape(null)).toBe("null");
  });

  it("infers empty array", () => {
    expect(inferJsonShape([])).toBe("unknown[]");
  });

  it("infers array of primitives", () => {
    expect(inferJsonShape([1, 2, 3])).toBe("number[]");
  });

  it("infers nested objects", () => {
    const result = inferJsonShape({ name: "test", count: 5 });
    expect(result).toContain("name: string");
    expect(result).toContain("count: number");
  });

  it("infers array of objects", () => {
    const result = inferJsonShape([{ id: 1, name: "a" }]);
    expect(result).toContain("id: number");
    expect(result).toContain("name: string");
    expect(result).toMatch(/\[\]$/);
  });

  it("infers empty object", () => {
    expect(inferJsonShape({})).toBe("{}");
  });
});

describe("context generator", () => {
  it("generates context for an origin with no fixtures", async () => {
    const root = new MemoryDirectoryHandle();
    const gateway = makeGateway();
    const siteConfigs: SiteConfig[] = [
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-03T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }
    ];

    const generator = createContextGenerator({
      rootHandle: asRoot(root),
      gateway,
      siteConfigs
    });

    const markdown = await generator.generate();

    expect(markdown).toContain("# WraithWalker Fixture Context");
    expect(markdown).toContain("## Cursor Agent Brief");
    expect(markdown).toContain(
      "Prettify minified or dumped contents before reasoning about them."
    );
    expect(markdown).toContain("https://app.example.com");
    expect(markdown).toContain("No captured fixtures found");
  });

  it("includes static asset summary from RESOURCE_MANIFEST.json", async () => {
    const root = new MemoryDirectoryHandle();
    const gateway = makeGateway();

    const manifest: StaticResourceManifest = {
      schemaVersion: 1,
      topOrigin: "https://app.example.com",
      topOriginKey: "https__app.example.com",
      generatedAt: "2026-04-03T00:00:00.000Z",
      resourcesByPathname: {
        "/assets/app.js": [
          {
            requestUrl: "https://cdn.example.com/assets/app.js",
            requestOrigin: "https://cdn.example.com",
            pathname: "/assets/app.js",
            search: "",
            bodyPath:
              ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/app.js.__body",
            projectionPath: "cdn.example.com/assets/app.js",
            requestPath:
              ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/app.js.__request.json",
            metaPath:
              ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/app.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-03T00:00:00.000Z"
          }
        ],
        "/assets/style.css": [
          {
            requestUrl: "https://cdn.example.com/assets/style.css",
            requestOrigin: "https://cdn.example.com",
            pathname: "/assets/style.css",
            search: "",
            bodyPath:
              ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/style.css.__body",
            projectionPath: "cdn.example.com/assets/style.css",
            requestPath:
              ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/style.css.__request.json",
            metaPath:
              ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/style.css.__response.json",
            mimeType: "text/css",
            resourceType: "Stylesheet",
            capturedAt: "2026-04-03T00:00:00.000Z"
          }
        ]
      }
    };

    await gateway.writeJson(
      asRoot(root),
      `.wraithwalker/manifests/https__app.example.com/${STATIC_RESOURCE_MANIFEST_FILE}`,
      manifest
    );

    const siteConfigs: SiteConfig[] = [
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-03T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }
    ];

    const generator = createContextGenerator({
      rootHandle: asRoot(root),
      gateway,
      siteConfigs
    });
    const markdown = await generator.generate();

    expect(markdown).toContain("### Static Assets");
    expect(markdown).toContain("Script: 1");
    expect(markdown).toContain("Stylesheet: 1");
  });

  it("includes API endpoints from fixture directories", async () => {
    const root = new MemoryDirectoryHandle();
    const gateway = makeGateway();

    const meta: ResponseMeta = {
      status: 200,
      statusText: "OK",
      headers: [],
      mimeType: "application/json",
      resourceType: "XHR",
      url: "https://api.example.com/users",
      method: "GET",
      capturedAt: "2026-04-03T00:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "json"
    };

    const basePath =
      ".wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/GET/users__q-abc123__b-def456";
    await gateway.writeJson(
      asRoot(root),
      `${basePath}/${FIXTURE_FILE_NAMES.API_META}`,
      meta
    );
    await writeTextFile(
      gateway,
      asRoot(root),
      `${basePath}/response.body`,
      JSON.stringify({ users: [{ id: 1, name: "Alice" }], total: 1 })
    );

    const siteConfigs: SiteConfig[] = [
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-03T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }
    ];

    const generator = createContextGenerator({
      rootHandle: asRoot(root),
      gateway,
      siteConfigs
    });
    const markdown = await generator.generate();

    expect(markdown).toContain("### API Endpoints");
    expect(markdown).toContain("| GET | /users | 200 | application/json |");
    expect(markdown).toContain("### Response Shapes");
    expect(markdown).toContain("users:");
    expect(markdown).toContain("total: number");
  });

  it("writes context files based on editor ID", async () => {
    const root = new MemoryDirectoryHandle();
    const gateway = makeGateway();
    const siteConfigs: SiteConfig[] = [
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-03T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }
    ];

    const generator = createContextGenerator({
      rootHandle: asRoot(root),
      gateway,
      siteConfigs
    });
    await generator.generate("cursor");

    expect(root.files.has("CLAUDE.md")).toBe(true);
    expect(root.files.has(".cursorrules")).toBe(true);
  });

  it("defaults unknown editor IDs to the Cursor context files", async () => {
    const root = new MemoryDirectoryHandle();
    const gateway = makeGateway();
    const siteConfigs: SiteConfig[] = [
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-03T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }
    ];

    const generator = createContextGenerator({
      rootHandle: asRoot(root),
      gateway,
      siteConfigs
    });
    await generator.generate("unknown-editor");

    expect(root.files.has("CLAUDE.md")).toBe(true);
    expect(root.files.has(".cursorrules")).toBe(true);
  });

  it("generates .d.ts files from captured JSON API responses", async () => {
    const root = new MemoryDirectoryHandle();
    const gateway = makeGateway();

    const meta: ResponseMeta = {
      status: 200,
      statusText: "OK",
      headers: [],
      mimeType: "application/json",
      resourceType: "XHR",
      url: "https://api.example.com/users",
      method: "GET",
      capturedAt: "2026-04-03T00:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "json"
    };

    const basePath =
      ".wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/GET/users__q-abc__b-def";
    await gateway.writeJson(
      asRoot(root),
      `${basePath}/${FIXTURE_FILE_NAMES.API_META}`,
      meta
    );
    await writeTextFile(
      gateway,
      asRoot(root),
      `${basePath}/response.body`,
      JSON.stringify({ users: [{ id: 1, name: "Alice" }], total: 1 })
    );

    const siteConfigs: SiteConfig[] = [
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-03T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }
    ];

    const generator = createContextGenerator({
      rootHandle: asRoot(root),
      gateway,
      siteConfigs
    });
    await generator.generate();

    // Check .d.ts file was created
    const typesDir = await root
      .getDirectoryHandle(".wraithwalker")
      .then((d) => d.getDirectoryHandle("types"));
    const dtsHandle = await typesDir.getFileHandle(
      "https__app.example.com.d.ts"
    );
    const dtsContent = await (await dtsHandle.getFile()).text();

    expect(dtsContent).toContain("Auto-generated by WraithWalker");
    expect(dtsContent).toContain("export interface GetUsersResponse");
    expect(dtsContent).toContain("users:");
    expect(dtsContent).toContain("total: number");

    // Check barrel file
    const indexHandle = await typesDir.getFileHandle("index.d.ts");
    const indexContent = await (await indexHandle.getFile()).text();
    expect(indexContent).toContain('export * from "./https__app.example.com"');
  });

  it("includes suggested agent tasks when API endpoints exist", async () => {
    const root = new MemoryDirectoryHandle();
    const gateway = makeGateway();

    const meta: ResponseMeta = {
      status: 200,
      statusText: "OK",
      headers: [],
      mimeType: "application/json",
      resourceType: "XHR",
      url: "https://api.example.com/users",
      method: "POST",
      capturedAt: "2026-04-03T00:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "json"
    };

    await gateway.writeJson(
      asRoot(root),
      ".wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/POST/users__q-abc__b-def/" +
        FIXTURE_FILE_NAMES.API_META,
      meta
    );

    const siteConfigs: SiteConfig[] = [
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-03T00:00:00.000Z",
        dumpAllowlistPatterns: []
      }
    ];

    const generator = createContextGenerator({
      rootHandle: asRoot(root),
      gateway,
      siteConfigs
    });
    const markdown = await generator.generate();

    expect(markdown).toContain("## Suggested Agent Tasks");
    expect(markdown).toContain("POST /users");
  });
});
