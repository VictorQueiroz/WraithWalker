import { describe, expect, it, vi } from "vitest";

import { promises as fs } from "node:fs";

import {
  createFixtureDescriptor,
  type FixtureDescriptor,
  type RequestPayload,
  type ResponseMeta
} from "../src/fixture-layout.mts";
import { createRoot } from "../src/root.mts";
import { createFixtureRootFs, type FixtureRootFs } from "../src/root-fs.mts";
import {
  createWraithwalkerRootRuntime,
  inferJsonShape,
  type RootRuntimeStorage
} from "../src/root-runtime.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

function createStorage(
  rootFs: FixtureRootFs,
  ensureSentinel: (root: FixtureRootFs) => Promise<Awaited<ReturnType<typeof createRoot>>> = (root) => createRoot(root.rootPath)
): RootRuntimeStorage<FixtureRootFs> {
  return {
    ensureSentinel,
    exists: (root, relativePath) => root.exists(relativePath),
    writeText: (root, relativePath, content) => root.writeText(relativePath, content),
    writeJson: (root, relativePath, value) => root.writeJson(relativePath, value),
    writeBody: (root, relativePath, payload) => root.writeBody(relativePath, payload),
    readOptionalJson: (root, relativePath) => root.readOptionalJson(relativePath),
    readBody: async (root, relativePath) => {
      const stats = await root.stat(relativePath);
      if (!stats || !stats.isFile()) {
        throw new Error(`Fixture body not found at ${relativePath}`);
      }

      return {
        bodyBase64: await root.readBodyAsBase64(relativePath),
        size: stats.size
      };
    },
    readText: (root, relativePath) => root.readText(relativePath),
    listDirectory: (root, relativePath) => root.listDirectory(relativePath)
  };
}

function createRequestPayload(descriptor: FixtureDescriptor, capturedAt = "2026-04-07T00:00:00.000Z"): RequestPayload {
  return {
    topOrigin: descriptor.topOrigin,
    url: descriptor.requestUrl,
    method: descriptor.method,
    headers: [],
    body: "",
    bodyEncoding: "utf8",
    bodyHash: descriptor.bodyHash,
    queryHash: descriptor.queryHash,
    capturedAt
  };
}

function createResponseMeta(
  descriptor: FixtureDescriptor,
  values: Partial<ResponseMeta> & Pick<ResponseMeta, "mimeType" | "resourceType" | "bodySuggestedExtension">
): ResponseMeta {
  return {
    status: 200,
    statusText: "OK",
    headers: [{ name: "Content-Type", value: values.mimeType }],
    mimeType: values.mimeType,
    resourceType: values.resourceType,
    url: descriptor.requestUrl,
    method: descriptor.method,
    capturedAt: values.capturedAt ?? "2026-04-07T00:00:00.000Z",
    bodyEncoding: values.bodyEncoding ?? "utf8",
    bodySuggestedExtension: values.bodySuggestedExtension,
    ...values
  };
}

describe("root runtime", () => {
  it("infers JSON shapes across primitives, arrays, and objects", () => {
    expect(inferJsonShape(null)).toBe("null");
    expect(inferJsonShape("hello")).toBe("string");
    expect(inferJsonShape(42)).toBe("number");
    expect(inferJsonShape(true)).toBe("boolean");
    expect(inferJsonShape(undefined)).toBe("unknown");
    expect(inferJsonShape([])).toBe("unknown[]");
    expect(inferJsonShape([{ id: 1 }])).toContain("id: number");
    expect(inferJsonShape({})).toBe("{}");
    expect(inferJsonShape({ nested: { ok: true } })).toContain("ok: boolean");
  });

  it("shares sentinel, repository, and manifest behavior through one runtime", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-root-runtime-"
    });
    const rootFs = createFixtureRootFs(root.rootPath);
    const ensureSentinel = vi.fn(async (nextRoot: FixtureRootFs) => createRoot(nextRoot.rootPath));
    const runtime = createWraithwalkerRootRuntime({
      root: rootFs,
      storage: createStorage(rootFs, ensureSentinel)
    });
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/app.css",
      resourceType: "Stylesheet",
      mimeType: "text/css"
    });

    expect(await runtime.has(descriptor)).toBe(false);
    expect(await runtime.read(descriptor)).toBeNull();

    const writeResult = await runtime.writeIfAbsent({
      descriptor,
      request: createRequestPayload(descriptor),
      response: {
        body: ".app { color: red; }",
        bodyEncoding: "utf8",
        meta: createResponseMeta(descriptor, {
          mimeType: "text/css",
          resourceType: "Stylesheet",
          bodySuggestedExtension: "css"
        })
      }
    });

    expect(writeResult.written).toBe(true);
    expect(await runtime.has(descriptor)).toBe(true);

    const fixture = await runtime.read(descriptor);
    expect(fixture).toMatchObject({
      request: {
        url: descriptor.requestUrl
      },
      meta: {
        mimeType: "text/css"
      }
    });
    expect(Buffer.from(fixture!.bodyBase64, "base64").toString("utf8")).toContain("color: red");

    const manifest = await root.readJson<{ resourcesByPathname: Record<string, unknown[]> }>(
      ".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json"
    );
    expect(manifest.resourcesByPathname["/assets/app.css"]).toHaveLength(1);
    expect(ensureSentinel).toHaveBeenCalledTimes(1);
  });

  it("shares guided scenario trace storage through the same root runtime", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-root-runtime-"
    });
    const rootFs = createFixtureRootFs(root.rootPath);
    const runtime = createWraithwalkerRootRuntime({
      root: rootFs,
      storage: createStorage(rootFs)
    });

    const armed = await runtime.startTrace({
      traceId: "trace-guided",
      name: "Guided trace",
      goal: "Capture the login button flow for the dashboard.",
      selectedOrigins: ["https://app.example.com"],
      extensionClientId: "client-1",
      createdAt: "2026-04-08T00:00:00.000Z"
    });
    expect(armed.status).toBe("armed");
    expect(armed.goal).toBe("Capture the login button flow for the dashboard.");
    expect((await runtime.getActiveTrace())?.traceId).toBe("trace-guided");

    const recording = await runtime.recordClick({
      traceId: "trace-guided",
      step: {
        stepId: "step-1",
        tabId: 7,
        recordedAt: "2026-04-08T00:00:01.000Z",
        pageUrl: "https://app.example.com/dashboard",
        topOrigin: "https://app.example.com",
        selector: "#login-button",
        tagName: "button",
        textSnippet: "Login"
      }
    });
    expect(recording?.status).toBe("recording");

    const linked = await runtime.linkFixture({
      traceId: "trace-guided",
      tabId: 7,
      requestedAt: "2026-04-08T00:00:02.000Z",
      fixture: {
        bodyPath: "cdn.example.com/assets/app.js",
        requestUrl: "https://cdn.example.com/assets/app.js",
        resourceType: "Script",
        capturedAt: "2026-04-08T00:00:02.500Z"
      }
    });
    expect(linked.linked).toBe(true);
    expect(linked.trace?.steps[0]?.linkedFixtures).toEqual([
      expect.objectContaining({
        bodyPath: "cdn.example.com/assets/app.js"
      })
    ]);

    const completed = await runtime.stopTrace("trace-guided", "2026-04-08T00:00:03.000Z");
    expect(completed.status).toBe("completed");
    expect(await runtime.listTraces()).toEqual([
      expect.objectContaining({
        traceId: "trace-guided",
        status: "completed",
        goal: "Capture the login button flow for the dashboard.",
        linkedFixtureCount: 1
      })
    ]);
  });

  it("generates shared context and type files for static assets, API fixtures, and empty origins", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-root-runtime-"
    });
    const rootFs = createFixtureRootFs(root.rootPath);
    const runtime = createWraithwalkerRootRuntime({
      root: rootFs,
      storage: createStorage(rootFs)
    });

    await root.writeManifest({
      topOrigin: "https://app.example.com",
      manifest: {
        schemaVersion: 1,
        topOrigin: "https://app.example.com",
        topOriginKey: "https__app.example.com",
        generatedAt: "2026-04-07T00:00:00.000Z",
        resourcesByPathname: {
          "/assets/app.js": [{
            requestUrl: "https://cdn.example.com/assets/app.js",
            requestOrigin: "https://cdn.example.com",
            pathname: "/assets/app.js",
            search: "",
            bodyPath: "cdn.example.com/assets/app.js",
            requestPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/app.js.__request.json",
            metaPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/app.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-07T00:00:00.000Z"
          }],
          "/assets/style.css": [{
            requestUrl: "https://cdn.example.com/assets/style.css",
            requestOrigin: "https://cdn.example.com",
            pathname: "/assets/style.css",
            search: "",
            bodyPath: "cdn.example.com/assets/style.css",
            requestPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/style.css.__request.json",
            metaPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/style.css.__response.json",
            mimeType: "text/css",
            resourceType: "Stylesheet",
            capturedAt: "2026-04-07T00:00:00.000Z"
          }],
          "/assets/runtime.wasm": [{
            requestUrl: "https://cdn.example.com/assets/runtime.wasm",
            requestOrigin: "https://cdn.example.com",
            pathname: "/assets/runtime.wasm",
            search: "",
            bodyPath: "cdn.example.com/assets/runtime.wasm",
            requestPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/runtime.wasm.__request.json",
            metaPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/runtime.wasm.__response.json",
            mimeType: "application/wasm",
            resourceType: "",
            capturedAt: "2026-04-07T00:00:00.000Z"
          }]
        }
      }
    });

    const topOriginDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://app.example.com/status",
      resourceType: "Fetch",
      mimeType: "text/plain"
    });
    await runtime.writeIfAbsent({
      descriptor: topOriginDescriptor,
      request: createRequestPayload(topOriginDescriptor),
      response: {
        body: "ok",
        bodyEncoding: "utf8",
        meta: createResponseMeta(topOriginDescriptor, {
          mimeType: "text/plain",
          resourceType: "Fetch",
          bodySuggestedExtension: "txt"
        })
      }
    });

    const usersDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://api.example.com/users",
      resourceType: "Fetch",
      mimeType: "application/json"
    });
    await runtime.writeIfAbsent({
      descriptor: usersDescriptor,
      request: createRequestPayload(usersDescriptor),
      response: {
        body: JSON.stringify({ users: [{ id: 1 }], total: 1 }),
        bodyEncoding: "utf8",
        meta: createResponseMeta(usersDescriptor, {
          mimeType: "application/json",
          resourceType: "Fetch",
          bodySuggestedExtension: "json"
        })
      }
    });

    const usersVariantDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://api.example.com/users?page=2",
      resourceType: "Fetch",
      mimeType: "application/json"
    });
    await runtime.writeIfAbsent({
      descriptor: usersVariantDescriptor,
      request: createRequestPayload(usersVariantDescriptor, "2026-04-07T00:01:00.000Z"),
      response: {
        body: JSON.stringify({ users: [{ name: "Alice" }], nextPage: 2 }),
        bodyEncoding: "utf8",
        meta: createResponseMeta(usersVariantDescriptor, {
          mimeType: "application/json",
          resourceType: "Fetch",
          bodySuggestedExtension: "json",
          url: "https://api.example.com/users"
        })
      }
    });

    const invalidJsonDir = root.apiFixturePaths({
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      method: "GET",
      fixtureName: "health-check__q-invalid__b-invalid"
    });
    await root.writeJson(invalidJsonDir.metaPath, {
      status: 200,
      statusText: "OK",
      headers: [{ name: "Content-Type", value: "application/json" }],
      mimeType: "application/json",
      resourceType: "Fetch",
      url: "",
      method: "GET",
      capturedAt: "2026-04-07T00:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "json"
    });
    await root.writeText(invalidJsonDir.bodyPath, "{not-json");

    await root.ensureOrigin({
      topOrigin: "http://localhost:4173"
    });

    const markdown = await runtime.generateContext({
      editorId: "cursor",
      siteConfigs: [
        {
          origin: "https://app.example.com"
        },
        {
          origin: "http://localhost:4173"
        }
      ]
    });

    expect(markdown).toContain("## Cursor Agent Brief");
    expect(markdown).toContain("Selected origins: https://app.example.com, http://localhost:4173");
    expect(markdown).toContain("### API Endpoints");
    expect(markdown).toContain("| GET | /users | 200 | application/json |");
    expect(markdown).toContain("### Static Assets");
    expect(markdown).toContain("Other: 1");
    expect(markdown).toContain("Script: 1");
    expect(markdown).toContain("Stylesheet: 1");
    expect(markdown).toContain("No captured fixtures found for this origin.");
    expect(markdown).toContain("## Suggested Agent Tasks");
    expect(markdown).toContain("GET /users");
    expect(markdown).toContain("#### GET /users (200)");
    expect(markdown).toContain("| GET | health/check | 200 | application/json |");

    await expect(fs.readFile(root.resolve("CLAUDE.md"), "utf8")).resolves.toContain("WraithWalker Fixture Context");
    await expect(fs.readFile(root.resolve(".cursorrules"), "utf8")).resolves.toContain("Cursor Agent Brief");
    await expect(fs.readFile(root.resolve(".wraithwalker/types/index.d.ts"), "utf8")).resolves.toContain("export *");
    await expect(fs.readFile(root.resolve(".wraithwalker/types/https__app.example.com.d.ts"), "utf8")).resolves.toContain("GetUsersResponse");
  });

  it("falls back to the default context files when no editor is provided and can recover from fixture directory listing failures", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-root-runtime-"
    });
    const rootFs = createFixtureRootFs(root.rootPath);
    const runtime = createWraithwalkerRootRuntime({
      root: rootFs,
      storage: {
        ...createStorage(rootFs),
        async listDirectory(nextRoot, relativePath) {
          if (relativePath.endsWith("/http/GET")) {
            throw new Error("fixture listing failed");
          }
          return createStorage(nextRoot).listDirectory(nextRoot, relativePath);
        }
      }
    });

    const brokenDir = root.apiFixturePaths({
      topOrigin: "https://broken.example.com",
      method: "GET",
      fixtureName: "users__q-a__b-b"
    });
    await root.writeJson(brokenDir.metaPath, {
      status: 200,
      statusText: "OK",
      headers: [],
      mimeType: "application/json",
      resourceType: "Fetch",
      url: "https://broken.example.com/users",
      method: "GET",
      capturedAt: "2026-04-07T00:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "json"
    });
    await root.writeText(brokenDir.bodyPath, JSON.stringify({ ok: true }));

    const markdown = await runtime.generateContext({
      siteConfigs: [
        {
          origin: "https://broken.example.com"
        }
      ]
    });

    expect(markdown).toContain("No captured fixtures found for this origin.");
    await expect(fs.readFile(root.resolve("CLAUDE.md"), "utf8")).resolves.toContain("Selected origins: https://broken.example.com");
    await expect(fs.access(root.resolve(".cursorrules"))).rejects.toThrow();
  });

  it("handles empty roots and non-json endpoint summaries through the shared context collector", async () => {
    const sentinel = {
      rootId: "root-stub",
      schemaVersion: 1,
      createdAt: "2026-04-07T00:00:00.000Z"
    };
    const writes = new Map<string, string>();
    const runtime = createWraithwalkerRootRuntime({
      root: { id: "stub-root" },
      storage: {
        ensureSentinel: async () => sentinel,
        exists: async () => false,
        writeText: async (_root, relativePath, content) => {
          writes.set(relativePath, content);
        },
        writeJson: async () => {},
        writeBody: async () => {},
        readOptionalJson: async <T>(_root, relativePath) => {
          if (relativePath.endsWith("/plain-text/response.meta.json")) {
            return {
              status: 200,
              statusText: "OK",
              headers: [],
              mimeType: "text/plain",
              resourceType: "Fetch",
              url: "https://plain.example.com/plain-text",
              method: "GET",
              capturedAt: "2026-04-07T00:00:00.000Z",
              bodyEncoding: "utf8",
              bodySuggestedExtension: "txt"
            } as T;
          }

          if (relativePath.endsWith("/missing-mime/response.meta.json")) {
            return {
              status: 200,
              statusText: "OK",
              headers: [],
              mimeType: "",
              resourceType: "Fetch",
              url: "https://plain.example.com/missing-mime",
              method: "GET",
              capturedAt: "2026-04-07T00:00:00.000Z",
              bodyEncoding: "utf8",
              bodySuggestedExtension: "txt"
            } as T;
          }

          return null;
        },
        readBody: async () => ({ bodyBase64: "", size: 0 }),
        readText: async () => "ignored",
        listDirectory: async (_root, relativePath) => {
          if (relativePath === ".wraithwalker/captures/http/https__stub.example.com/origins/https__stub.example.com/http") {
            return [
              { name: "README.md", kind: "file" },
              { name: "GET", kind: "directory" }
            ];
          }

          if (relativePath === ".wraithwalker/captures/http/https__stub.example.com/origins/https__stub.example.com/http/GET") {
            return [
              { name: "preview.txt", kind: "file" },
              { name: "plain-text", kind: "directory" },
              { name: "missing-mime", kind: "directory" },
              { name: "missing-meta", kind: "directory" }
            ];
          }

          if (relativePath === ".wraithwalker/captures/http/https__stub.example.com/origins") {
            return [{ name: "notes.txt", kind: "file" }];
          }

          throw new Error(`Unexpected directory lookup: ${relativePath}`);
        }
      }
    });

    const markdown = await runtime.generateContext({
      siteConfigs: [{
        origin: "https://stub.example.com"
      }]
    });

    expect(markdown).toContain("| GET | /plain-text | 200 | text/plain |");
    expect(markdown).toContain("| GET | /missing-mime | 200 |  |");
    expect(markdown).not.toContain("### Response Shapes");
    expect(markdown).not.toContain("No captured fixtures found for this origin.");
    expect(writes.get("CLAUDE.md")).toContain("Selected origins: https://stub.example.com");

    const emptyMarkdown = await runtime.generateContext({
      siteConfigs: []
    });

    expect(emptyMarkdown).toContain("Selected origins: none yet.");
    expect(emptyMarkdown).not.toContain("## Suggested Agent Tasks");
  });
});
