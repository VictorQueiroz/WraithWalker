import { describe, expect, it, vi } from "vitest";

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import {
  createFixtureDescriptor,
  type FixtureDescriptor,
  type RequestPayload,
  type ResponseMeta
} from "@wraithwalker/core/fixture-layout";
import { readSentinel } from "@wraithwalker/core/root";

import { createFixtureRepository } from "../src/fixture-repository.mts";
import { createServerRootRuntime } from "../src/root-runtime.mts";
import { DEFAULT_HTTP_TRPC_MAX_BODY_SIZE_BYTES, startHttpServer } from "../src/server.mts";
import { createWraithwalkerRouter, type AppRouter } from "../src/trpc.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

function createClient(
  serverUrl: string,
  {
    methodOverride,
    headers,
    fetchImpl
  }: {
    methodOverride?: "POST";
    headers?: Record<string, string>;
    fetchImpl?: typeof fetch;
  } = {}
) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: serverUrl,
        ...(methodOverride ? { methodOverride } : {}),
        ...(headers
          ? {
              headers() {
                return headers;
              }
            }
          : {}),
        ...(fetchImpl ? { fetch: fetchImpl } : {})
      })
    ]
  });
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
  {
    mimeType,
    resourceType,
    bodySuggestedExtension,
    capturedAt = "2026-04-07T00:00:00.000Z"
  }: {
    mimeType: string;
    resourceType: string;
    bodySuggestedExtension: string;
    capturedAt?: string;
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
    capturedAt,
    bodyEncoding: "utf8",
    bodySuggestedExtension
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

describe("tRPC capture backend", () => {
  it("requires canonical metadata for simple-mode assets", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-",
      rootId: "root-trpc"
    });
    const descriptor = await createDescriptor();
    const repository = createFixtureRepository({
      rootPath: root.rootPath,
      sentinel: await readSentinel(root.rootPath)
    });

    await root.writeText(descriptor.bodyPath, "console.log('fixture');");
    const apiDescriptor = await createDescriptor({
      url: "https://api.example.com/users",
      resourceType: "Fetch",
      mimeType: "application/json"
    });
    await root.writeText(apiDescriptor.bodyPath, JSON.stringify({ ok: true }));

    expect(await repository.exists(descriptor)).toBe(false);
    expect(await repository.exists(apiDescriptor)).toBe(false);
    expect(await repository.read(await createDescriptor({
      url: "https://cdn.example.com/assets/missing.js"
    }))).toBeNull();

    expect(await repository.read(descriptor)).toBeNull();
  });

  it("writes fixtures and static manifests only once", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-",
      rootId: "root-trpc"
    });
    const sentinel = await readSentinel(root.rootPath);
    const repository = createFixtureRepository({
      rootPath: root.rootPath,
      sentinel
    });
    const descriptor = await createDescriptor({
      url: "https://cdn.example.com/styles/app.css",
      resourceType: "Stylesheet",
      mimeType: "text/css"
    });
    const request: RequestPayload = {
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
    const meta: ResponseMeta = {
      status: 200,
      statusText: "OK",
      headers: [{ name: "Content-Type", value: "text/css" }],
      mimeType: "text/css",
      resourceType: "Stylesheet",
      url: descriptor.requestUrl,
      method: descriptor.method,
      capturedAt: "2026-04-07T00:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "css"
    };

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
      request,
      response: {
        body: ".app { color: blue; }",
        bodyEncoding: "utf8",
        meta
      }
    });

    expect(firstWrite.written).toBe(true);
    expect(secondWrite.written).toBe(false);
    const manifest = await root.readJson<{ resourcesByPathname: Record<string, unknown[]> }>(
      ".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json"
    );
    expect(manifest.resourcesByPathname["/styles/app.css"]).toHaveLength(1);
  });

  it("serves system info and fixture operations over HTTP tRPC", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-"
    });
    const server = await startHttpServer(root.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const client = await createClient(server.trpcUrl);
    const descriptor = await createDescriptor({
      url: "https://api.example.com/users",
      resourceType: "Fetch",
      mimeType: "application/json"
    });

    try {
      const info = await client.system.info.query();
      expect(info.rootPath).toBe(root.rootPath);
      expect(info.mcpUrl).toBe(server.url);
      expect(info.trpcUrl).toBe(server.trpcUrl);
      expect(info.sentinel.rootId).toBeTruthy();

      const initialHas = await client.fixtures.has.query({ descriptor });
      expect(initialHas.exists).toBe(false);

      const writeResult = await client.fixtures.writeIfAbsent.mutate({
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
          body: JSON.stringify({ users: [{ id: 1 }] }),
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
      expect(writeResult.written).toBe(true);

      const hasFixture = await client.fixtures.has.query({ descriptor });
      expect(hasFixture.exists).toBe(true);

      const fixture = await client.fixtures.read.query({ descriptor });
      expect(fixture.exists).toBe(true);
      if (fixture.exists) {
        expect(Buffer.from(fixture.bodyBase64, "base64").toString("utf8")).toContain("\"users\"");
      }

      const context = await client.fixtures.generateContext.mutate({
        siteConfigs: [{
          origin: "https://app.example.com",
          createdAt: "2026-04-07T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }],
        editorId: "cursor"
      });
      expect(context.ok).toBe(true);
      expect(await root.readJson<{ rootId: string }>(".wraithwalker/root.json")).toEqual(expect.objectContaining({
        rootId: info.sentinel.rootId
      }));
      expect(await root.readJson<{ users: Array<{ id: number }> }>(descriptor.bodyPath)).toEqual({ users: [{ id: 1 }] });
      expect(await fs.readFile(root.resolve(".cursorrules"), "utf8")).toContain("WraithWalker Fixture Context");
    } finally {
      await server.close();
    }
  });

  it("reads and writes explicit configured site configs over HTTP tRPC", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-"
    });
    await root.writeProjectConfig({
      schemaVersion: 1,
      sites: [{
        origin: "https://configured.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.svg$"]
      }]
    });
    const server = await startHttpServer(root.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const client = await createClient(server.trpcUrl);

    try {
      const configured = await client.config.readConfiguredSiteConfigs.query();
      expect(configured.sentinel.rootId).toBeTruthy();
      expect(configured.siteConfigs).toEqual([{
        origin: "https://configured.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.svg$"]
      }]);

      const updated = await client.config.writeConfiguredSiteConfigs.mutate({
        siteConfigs: [{
          origin: "https://server-write.example.com",
          createdAt: "2026-04-08T12:00:00.000Z",
          dumpAllowlistPatterns: ["\\.css$"]
        }]
      });

      expect(updated).toEqual({
        sentinel: expect.objectContaining({ rootId: expect.any(String) }),
        siteConfigs: [{
          origin: "https://server-write.example.com",
          createdAt: "2026-04-08T12:00:00.000Z",
          dumpAllowlistPatterns: ["\\.css$"]
        }]
      });
      await expect(root.readJson(root.projectConfigRelativePath())).resolves.toEqual({
        schemaVersion: 1,
        sites: [{
          origin: "https://server-write.example.com",
          createdAt: "2026-04-08T12:00:00.000Z",
          dumpAllowlistPatterns: ["\\.css$"]
        }]
      });
    } finally {
      await server.close();
    }
  });

  it("returns effective site configs that merge explicit config with discovered origins", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-"
    });
    await root.writeProjectConfig({
      schemaVersion: 1,
      sites: [{
        origin: "https://configured.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.svg$"]
      }]
    });
    const server = await startHttpServer(root.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const client = await createClient(server.trpcUrl);
    const descriptor = await createDescriptor({
      topOrigin: "https://discovered.example.com",
      url: "https://discovered.example.com/assets/app.js",
      resourceType: "Script",
      mimeType: "application/javascript"
    });

    try {
      await client.fixtures.writeIfAbsent.mutate({
        descriptor,
        request: createRequestPayload(descriptor),
        response: {
          body: "console.log('discovered');",
          bodyEncoding: "utf8",
          meta: createResponseMeta(descriptor, {
            mimeType: "application/javascript",
            resourceType: "Script",
            bodySuggestedExtension: "js"
          })
        }
      });

      const effective = await client.config.readEffectiveSiteConfigs.query();

      expect(effective.siteConfigs).toEqual([
        {
          origin: "https://configured.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.svg$"]
        },
        {
          origin: "https://discovered.example.com",
          createdAt: expect.any(String),
          dumpAllowlistPatterns: ["\\.m?(js|ts)x?$", "\\.css$", "\\.wasm$"]
        }
      ]);
    } finally {
      await server.close();
    }
  });

  it("returns exists=false for reads of missing fixtures over HTTP tRPC", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-"
    });
    const server = await startHttpServer(root.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const client = createClient(server.trpcUrl);
    const descriptor = await createDescriptor({
      url: "https://api.example.com/missing",
      resourceType: "Fetch",
      mimeType: "application/json"
    });

    try {
      const fixture = await client.fixtures.read.query({ descriptor });
      expect(fixture).toEqual({
        exists: false,
        sentinel: expect.objectContaining({
          rootId: expect.any(String),
          schemaVersion: 1
        })
      });
    } finally {
      await server.close();
    }
  });

  it("writes and serves a simple-mode static asset using the extension-compatible on-disk contract", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-"
    });
    const server = await startHttpServer(root.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const client = createClient(server.trpcUrl);
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

    try {
      const writeResult = await client.fixtures.writeIfAbsent.mutate({
        descriptor,
        request,
        response: {
          body: ".app { color: red; }",
          bodyEncoding: "utf8",
          meta
        }
      });

      expect(writeResult).toEqual({
        written: true,
        descriptor,
        sentinel: expect.objectContaining({
          rootId: expect.any(String)
        })
      });

      expect(await root.readJson<RequestPayload>(descriptor.requestPath)).toEqual(request);
      expect(await root.readJson<ResponseMeta>(descriptor.metaPath)).toEqual(meta);
      expect(await fs.readFile(root.resolve(descriptor.bodyPath), "utf8")).toBe(".app { color: red; }");

      const manifest = await root.readJson<{
        resourcesByPathname: Record<string, Array<{ bodyPath: string; requestPath: string; metaPath: string; mimeType: string; resourceType: string }>>;
      }>(".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json");
      expect(manifest.resourcesByPathname["/styles/app.css"]).toEqual([
        expect.objectContaining({
          bodyPath: descriptor.bodyPath,
          requestPath: descriptor.requestPath,
          metaPath: descriptor.metaPath,
          mimeType: "text/css",
          resourceType: "Stylesheet"
        })
      ]);

      const readResult = await client.fixtures.read.query({ descriptor });
      expect(readResult).toEqual({
        exists: true,
        request,
        meta,
        bodyBase64: Buffer.from(".app {\n  color: red;\n}", "utf8").toString("base64"),
        size: Buffer.byteLength(".app {\n  color: red;\n}"),
        sentinel: expect.objectContaining({
          rootId: expect.any(String)
        })
      });
    } finally {
      await server.close();
    }
  });

  it("stores query-specific sidecars for simple-mode asset variants while keeping the visible asset path stable", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-query-variants-"
    });
    const server = await startHttpServer(root.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const client = createClient(server.trpcUrl);
    const firstDescriptor = await createDescriptor({
      topOrigin: "https://domain-b.example.com",
      url: "https://domain-a.example.com/a.js?prop1=&prop2=B",
      resourceType: "Script",
      mimeType: "application/javascript"
    });
    const secondDescriptor = await createDescriptor({
      topOrigin: "https://domain-b.example.com",
      url: "https://domain-a.example.com/a.js?cache-bust=true&retry-attempt=2",
      resourceType: "Script",
      mimeType: "application/javascript"
    });

    expect(firstDescriptor.bodyPath).not.toBe(secondDescriptor.bodyPath);
    expect(firstDescriptor.projectionPath).toBe(secondDescriptor.projectionPath);
    expect(firstDescriptor.requestPath).not.toBe(secondDescriptor.requestPath);
    expect(firstDescriptor.metaPath).not.toBe(secondDescriptor.metaPath);

    try {
      const firstMeta = createResponseMeta(firstDescriptor, {
        mimeType: "application/javascript",
        resourceType: "Script",
        bodySuggestedExtension: "js"
      });
      const secondMeta = {
        ...createResponseMeta(secondDescriptor, {
          mimeType: "application/javascript",
          resourceType: "Script",
          bodySuggestedExtension: "js",
          capturedAt: "2026-04-07T00:00:01.000Z"
        }),
        headers: [
          { name: "Content-Type", value: "application/javascript" },
          { name: "Access-Control-Allow-Origin", value: "https://domain-b.example.com" }
        ]
      };

      expect(await client.fixtures.writeIfAbsent.mutate({
        descriptor: firstDescriptor,
        request: createRequestPayload(firstDescriptor),
        response: {
          body: "console.log('shared body');",
          bodyEncoding: "utf8",
          meta: firstMeta
        }
      })).toEqual(expect.objectContaining({ written: true }));
      expect(await client.fixtures.writeIfAbsent.mutate({
        descriptor: secondDescriptor,
        request: createRequestPayload(secondDescriptor, "2026-04-07T00:00:01.000Z"),
        response: {
          body: "console.log('should not overwrite body');",
          bodyEncoding: "utf8",
          meta: secondMeta
        }
      })).toEqual(expect.objectContaining({ written: true }));

      expect(await fs.readFile(root.resolve(firstDescriptor.bodyPath), "utf8")).toBe("console.log('shared body');");
      expect(await fs.readFile(root.resolve(secondDescriptor.bodyPath), "utf8")).toBe("console.log('should not overwrite body');");
      expect(await fs.readFile(root.resolve(firstDescriptor.projectionPath!), "utf8")).toBe("console.log(\"shared body\");");
      expect(await root.readJson<RequestPayload>(firstDescriptor.requestPath)).toEqual(createRequestPayload(firstDescriptor));
      expect(await root.readJson<RequestPayload>(secondDescriptor.requestPath)).toEqual(
        createRequestPayload(secondDescriptor, "2026-04-07T00:00:01.000Z")
      );
      expect(await root.readJson<ResponseMeta>(secondDescriptor.metaPath)).toEqual(secondMeta);

      const readResult = await client.fixtures.read.query({ descriptor: secondDescriptor });
      expect(readResult).toEqual(expect.objectContaining({
        exists: true,
        meta: secondMeta,
        bodyBase64: Buffer.from("console.log(\"shared body\");", "utf8").toString("base64")
      }));

      const manifest = await root.readJson<{
        resourcesByPathname: Record<string, Array<{ requestUrl: string; search: string; bodyPath: string }>>;
      }>(".wraithwalker/manifests/https__domain-b.example.com/RESOURCE_MANIFEST.json");
      expect(manifest.resourcesByPathname["/a.js"]).toEqual([
        expect.objectContaining({
          requestUrl: secondDescriptor.requestUrl,
          search: "?cache-bust=true&retry-attempt=2",
          bodyPath: secondDescriptor.bodyPath
        }),
        expect.objectContaining({
          requestUrl: firstDescriptor.requestUrl,
          search: "?prop1=&prop2=B",
          bodyPath: firstDescriptor.bodyPath
        })
      ]);
    } finally {
      await server.close();
    }
  });

  it("serves an edited human-facing projection body over HTTP tRPC for asset fixtures", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-projection-read-"
    });
    const server = await startHttpServer(root.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const client = createClient(server.trpcUrl);
    const descriptor = await createDescriptor({
      url: "https://cdn.example.com/assets/app.js",
      resourceType: "Script",
      mimeType: "application/javascript"
    });
    const request = createRequestPayload(descriptor);
    const meta = createResponseMeta(descriptor, {
      mimeType: "application/javascript",
      resourceType: "Script",
      bodySuggestedExtension: "js"
    });

    try {
      await client.fixtures.writeIfAbsent.mutate({
        descriptor,
        request,
        response: {
          body: "console.log('canonical');",
          bodyEncoding: "utf8",
          meta
        }
      });
      await fs.writeFile(root.resolve(descriptor.projectionPath!), "window.__projection__ = true;\n");

      const readResult = await client.fixtures.read.query({ descriptor });
      expect(readResult).toEqual({
        exists: true,
        request,
        meta,
        bodyBase64: Buffer.from("window.__projection__ = true;\n", "utf8").toString("base64"),
        size: Buffer.byteLength("window.__projection__ = true;\n"),
        sentinel: expect.objectContaining({
          rootId: expect.any(String)
        })
      });
    } finally {
      await server.close();
    }
  });

  it("writes and serves a simple-mode API fixture without creating a static asset manifest entry", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-"
    });
    const server = await startHttpServer(root.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const client = createClient(server.trpcUrl);
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
    const body = JSON.stringify({ users: [{ id: 1, name: "Ada" }] });

    try {
      const writeResult = await client.fixtures.writeIfAbsent.mutate({
        descriptor,
        request,
        response: {
          body,
          bodyEncoding: "utf8",
          meta
        }
      });
      expect(writeResult.written).toBe(true);

      expect(await root.readJson<RequestPayload>(descriptor.requestPath)).toEqual(request);
      expect(await root.readJson<ResponseMeta>(descriptor.metaPath)).toEqual(meta);
      expect(await fs.readFile(root.resolve(descriptor.bodyPath), "utf8")).toBe(body);

      await expect(
        fs.access(root.resolve(".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json"))
      ).rejects.toThrow();

      const hasResult = await client.fixtures.has.query({ descriptor });
      expect(hasResult).toEqual({
        exists: true,
        sentinel: expect.objectContaining({
          rootId: expect.any(String)
        })
      });

      const readResult = await client.fixtures.read.query({ descriptor });
      expect(readResult).toEqual({
        exists: true,
        request,
        meta,
        bodyBase64: Buffer.from(body, "utf8").toString("base64"),
        size: Buffer.byteLength(body),
        sentinel: expect.objectContaining({
          rootId: expect.any(String)
        })
      });
    } finally {
      await server.close();
    }
  });

  it("allows browser extension CORS requests to the tRPC endpoint and rejects regular web origins", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-"
    });
    const server = await startHttpServer(root.rootPath, {
      host: "127.0.0.1",
      port: 0
    });

    try {
      const queryUrl = `${server.trpcUrl}/system.info?batch=1&input=${encodeURIComponent("{}")}`;
      const descriptor = await createDescriptor({
        url: "https://api.example.com/users",
        resourceType: "Fetch",
        mimeType: "application/json"
      });
      const mutationUrl = `${server.trpcUrl}/fixtures.writeIfAbsent?batch=1`;
      const largePayload = "x".repeat(150_000);

      const extensionResponse = await fetch(queryUrl, {
        headers: {
          Origin: "chrome-extension://test-extension-id"
        }
      });
      expect(extensionResponse.status).toBe(200);
      expect(extensionResponse.headers.get("access-control-allow-origin")).toBe("chrome-extension://test-extension-id");

      const preflightResponse = await fetch(mutationUrl, {
        method: "OPTIONS",
        headers: {
          Origin: "chrome-extension://test-extension-id",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type, x-trpc-source",
          "Access-Control-Request-Private-Network": "true"
        }
      });
      expect(preflightResponse.status).toBe(204);
      expect(preflightResponse.headers.get("access-control-allow-origin")).toBe("chrome-extension://test-extension-id");
      expect(preflightResponse.headers.get("access-control-allow-headers")).toBe("content-type, x-trpc-source");
      expect(preflightResponse.headers.get("access-control-allow-private-network")).toBe("true");
      expect(preflightResponse.headers.get("vary")).toBe("Origin");

      const mutationResponse = await fetch(mutationUrl, {
        method: "POST",
        headers: {
          Origin: "chrome-extension://test-extension-id",
          "content-type": "application/json",
          "x-trpc-source": "wraithwalker-extension"
        },
        body: JSON.stringify({
          0: {
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
              body: JSON.stringify({ ok: true, payload: largePayload }),
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
          }
        })
      });
      expect(mutationResponse.status).toBe(200);
      expect(mutationResponse.headers.get("access-control-allow-origin")).toBe("chrome-extension://test-extension-id");

      const oversizedMutationResponse = await fetch(mutationUrl, {
        method: "POST",
        headers: {
          Origin: "chrome-extension://test-extension-id",
          "content-type": "application/json",
          "x-trpc-source": "wraithwalker-extension"
        },
        body: JSON.stringify({
          0: {
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
              body: "x".repeat(DEFAULT_HTTP_TRPC_MAX_BODY_SIZE_BYTES + 1),
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
          }
        })
      });
      expect(oversizedMutationResponse.status).toBe(413);
      expect(oversizedMutationResponse.headers.get("access-control-allow-origin")).toBe("chrome-extension://test-extension-id");

      const webOriginResponse = await fetch(queryUrl, {
        headers: {
          Origin: "https://example.com"
        }
      });
      expect(webOriginResponse.status).toBe(200);
      expect(webOriginResponse.headers.get("access-control-allow-origin")).toBeNull();

      const deniedPreflight = await fetch(mutationUrl, {
        method: "OPTIONS",
        headers: {
          Origin: "https://example.com",
          "Access-Control-Request-Method": "POST"
        }
      });
      expect(deniedPreflight.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("supports extension-style POST batched queries without oversized GET URLs", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-"
    });
    const server = await startHttpServer(root.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const descriptor = await createDescriptor();
    let lastRequest: { method?: string; url: string } | null = null;
    let lastResponse: Response | null = null;

    try {
      const client = createClient(server.trpcUrl, {
        methodOverride: "POST",
        headers: {
          Origin: "chrome-extension://test-extension-id",
          "x-trpc-source": "wraithwalker-extension"
        },
        fetchImpl: async (input, init) => {
          const response = await fetch(input, init);
          lastRequest = {
            method: init?.method ?? (input instanceof Request ? input.method : undefined),
            url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
          };
          lastResponse = response.clone();
          return response;
        }
      });

      const results = await Promise.all([
        client.fixtures.has.query({ descriptor }),
        client.fixtures.has.query({ descriptor }),
        client.fixtures.has.query({ descriptor })
      ]);

      expect(results).toEqual([
        expect.objectContaining({ exists: false }),
        expect.objectContaining({ exists: false }),
        expect.objectContaining({ exists: false })
      ]);
      expect(lastRequest).toEqual(expect.objectContaining({
        method: "POST"
      }));
      expect(lastRequest?.url).toContain("/fixtures.has,fixtures.has,fixtures.has");
      expect(lastRequest?.url).not.toContain("input=%7B");
      expect(lastResponse?.headers.get("access-control-allow-origin")).toBe("chrome-extension://test-extension-id");
    } finally {
      await server.close();
    }
  });

  it("supports direct caller usage for the typed tRPC router", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-",
      rootId: "root-trpc"
    });
    const sentinel = await readSentinel(root.rootPath);
    const descriptor = await createDescriptor({
      url: "https://api.example.com/direct",
      resourceType: "Fetch",
      mimeType: "application/json"
    });
    const router = createWraithwalkerRouter({
      rootPath: root.rootPath,
      sentinel,
      serverName: "wraithwalker",
      serverVersion: "0.6.1",
      extensionSessions: {
        heartbeat: async ({ clientId, extensionVersion, sessionActive, enabledOrigins }) => ({
          connected: true,
          captureReady: sessionActive && enabledOrigins.length > 0,
          sessionActive,
          lastHeartbeatAt: "2026-04-08T00:00:00.000Z",
          extensionVersion,
          clientId,
          captureDestination: "server" as const,
          enabledOrigins,
          siteConfigs: enabledOrigins.map((origin) => ({
            origin,
            createdAt: "2026-04-08T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          })),
          activeTrace: null,
          tracePhase: sessionActive && enabledOrigins.length > 0 ? "idle" : "not_ready",
          activeTraceSummary: null
        })
      },
      getServerUrls: () => ({
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc"
      })
    });
    const caller = router.createCaller({});

    expect(await caller.system.info()).toEqual(expect.objectContaining({
      rootPath: root.rootPath,
      sentinel: expect.objectContaining({ rootId: "root-trpc" }),
      siteConfigs: []
    }));

    expect(await caller.fixtures.has({ descriptor })).toEqual({
      exists: false,
      sentinel
    });
    expect(await caller.fixtures.read({ descriptor })).toEqual({
      exists: false,
      sentinel
    });

    await caller.fixtures.writeIfAbsent({
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
        body: JSON.stringify({ ok: true }),
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

    const fixture = await caller.fixtures.read({ descriptor });
    expect(fixture.exists).toBe(true);
    await caller.fixtures.generateContext({
      siteConfigs: [{
        origin: "https://app.example.com",
        createdAt: "2026-04-07T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }],
      editorId: "cursor"
    });
    expect(await fs.readFile(root.resolve(".cursorrules"), "utf8")).toContain("WraithWalker Fixture Context");
  });

  it("reveals the active root through the server-side OS handler", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-",
      rootId: "root-trpc"
    });
    const sentinel = await readSentinel(root.rootPath);
    const revealRoot = vi.fn().mockResolvedValue({
      ok: true,
      command: `xdg-open ${root.rootPath}`
    });

    const router = createWraithwalkerRouter({
      rootPath: root.rootPath,
      sentinel,
      serverName: "wraithwalker",
      serverVersion: "0.6.1",
      revealRoot,
      extensionSessions: {
        heartbeat: async ({ clientId, extensionVersion, sessionActive, enabledOrigins }) => ({
          connected: true,
          captureReady: sessionActive && enabledOrigins.length > 0,
          sessionActive,
          lastHeartbeatAt: "2026-04-08T00:00:00.000Z",
          extensionVersion,
          clientId,
          captureDestination: "server" as const,
          enabledOrigins,
          siteConfigs: [],
          activeTrace: null,
          tracePhase: sessionActive && enabledOrigins.length > 0 ? "idle" : "not_ready",
          activeTraceSummary: null
        })
      },
      getServerUrls: () => ({
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc"
      })
    });
    const caller = router.createCaller({});

    await expect(caller.system.revealRoot()).resolves.toEqual({
      ok: true,
      command: `xdg-open ${root.rootPath}`
    });
    expect(revealRoot).toHaveBeenCalledTimes(1);
  });

  it("lists, saves, and switches scenarios through the typed tRPC router", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-",
      rootId: "root-trpc"
    });
    const sentinel = await readSentinel(root.rootPath);

    const router = createWraithwalkerRouter({
      rootPath: root.rootPath,
      sentinel,
      serverName: "wraithwalker",
      serverVersion: "0.6.1",
      extensionSessions: {
        heartbeat: async ({ clientId, extensionVersion, sessionActive, enabledOrigins }) => ({
          connected: true,
          captureReady: sessionActive && enabledOrigins.length > 0,
          sessionActive,
          lastHeartbeatAt: "2026-04-08T00:00:00.000Z",
          extensionVersion,
          clientId,
          captureDestination: "server" as const,
          enabledOrigins,
          siteConfigs: [],
          activeTrace: null,
          tracePhase: sessionActive && enabledOrigins.length > 0 ? "idle" : "not_ready",
          activeTraceSummary: null
        })
      },
      getServerUrls: () => ({
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc"
      })
    });
    const caller = router.createCaller({});

    await expect(caller.scenarios.list()).resolves.toEqual({ scenarios: [] });
    await expect(caller.scenarios.save({ name: "baseline" })).resolves.toEqual({
      ok: true,
      name: "baseline"
    });
    await expect(caller.scenarios.list()).resolves.toEqual({ scenarios: ["baseline"] });
    await expect(caller.scenarios.switch({ name: "baseline" })).resolves.toEqual({
      ok: true,
      name: "baseline"
    });
  });

  it("serves extension heartbeats and guided trace record/link operations", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-",
      rootId: "root-trpc"
    });
    const sentinel = await readSentinel(root.rootPath);
    const rootRuntime = createServerRootRuntime({
      rootPath: root.rootPath,
      sentinel
    });

    await rootRuntime.startTrace({
      traceId: "trace-http",
      name: "HTTP trace",
      goal: "Capture the settings click path for agent debugging.",
      selectedOrigins: ["https://app.example.com"],
      extensionClientId: "client-1",
      createdAt: "2026-04-08T00:00:00.000Z"
    });

    const router = createWraithwalkerRouter({
      rootPath: root.rootPath,
      sentinel,
      serverName: "wraithwalker",
      serverVersion: "0.6.1",
      runtime: rootRuntime,
      extensionSessions: {
        heartbeat: async ({ clientId, extensionVersion, sessionActive, enabledOrigins }) => {
          const activeTrace = await rootRuntime.getActiveTrace();

          return {
            connected: true,
            captureReady: sessionActive && enabledOrigins.length > 0,
            sessionActive,
            lastHeartbeatAt: "2026-04-08T00:00:00.000Z",
            extensionVersion,
            clientId,
            captureDestination: "server" as const,
            enabledOrigins,
            siteConfigs: enabledOrigins.map((origin) => ({
              origin,
              createdAt: "2026-04-08T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.js$"]
            })),
            activeTrace,
            tracePhase: activeTrace
              ? (activeTrace.status === "recording" ? "recording" : "armed")
              : (sessionActive && enabledOrigins.length > 0 ? "idle" : "not_ready"),
            activeTraceSummary: activeTrace
              ? {
                  traceId: activeTrace.traceId,
                  name: activeTrace.name,
                  goal: activeTrace.goal,
                  status: activeTrace.status,
                  createdAt: activeTrace.createdAt,
                  startedAt: activeTrace.startedAt,
                  endedAt: activeTrace.endedAt,
                  selectedOrigins: [...activeTrace.selectedOrigins],
                  stepCount: activeTrace.steps.length,
                  linkedFixtureCount: activeTrace.steps.reduce((count, step) => count + step.linkedFixtures.length, 0),
                  recentSteps: []
                }
              : null
          };
        }
      },
      getServerUrls: () => ({
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc"
      })
    });
    const caller = router.createCaller({});
    const descriptor = await createDescriptor({
      url: "https://cdn.example.com/assets/app.js",
      resourceType: "Script",
      mimeType: "application/javascript"
    });

    const heartbeat = await caller.extension.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"]
    });
    expect(heartbeat.activeTrace).toEqual(
      expect.objectContaining({
        traceId: "trace-http",
        goal: "Capture the settings click path for agent debugging."
      })
    );
    expect(heartbeat.siteConfigs).toEqual([
      expect.objectContaining({ origin: "https://app.example.com" })
    ]);

    const recorded = await caller.scenarioTraces.recordClick({
      traceId: "trace-http",
      step: {
        stepId: "step-1",
        tabId: 3,
        recordedAt: "2026-04-08T00:00:01.000Z",
        pageUrl: "https://app.example.com/settings",
        topOrigin: "https://app.example.com",
        selector: "#save-button",
        tagName: "button",
        textSnippet: "Save"
      }
    });
    expect(recorded).toEqual(
      expect.objectContaining({
        recorded: true,
        activeTrace: expect.objectContaining({
          status: "recording"
        })
      })
    );

    await rootRuntime.writeIfAbsent({
      descriptor,
      request: createRequestPayload(descriptor, "2026-04-08T00:00:02.000Z"),
      response: {
        body: "console.log('trace');",
        bodyEncoding: "utf8",
        meta: createResponseMeta(descriptor, {
          mimeType: "application/javascript",
          resourceType: "Script",
          bodySuggestedExtension: "js",
          capturedAt: "2026-04-08T00:00:02.500Z"
        })
      }
    });

    const linked = await caller.scenarioTraces.linkFixture({
      traceId: "trace-http",
      tabId: 3,
      requestedAt: "2026-04-08T00:00:02.000Z",
      fixture: {
        bodyPath: descriptor.bodyPath,
        requestUrl: descriptor.requestUrl,
        resourceType: "Script",
        capturedAt: "2026-04-08T00:00:02.500Z"
      }
    });
    expect(linked.linked).toBe(true);
    expect(linked.trace?.steps[0]?.linkedFixtures).toEqual([
      expect.objectContaining({
        bodyPath: descriptor.bodyPath
      })
    ]);

    await expect(
      fs.readFile(root.resolve(".wraithwalker/scenario-traces/trace-http/trace.json"), "utf8")
    ).resolves.toContain(`"bodyPath": "${descriptor.bodyPath}"`);
  });

  it("rejects non-loopback HTTP hosts", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-trpc-"
    });

    await expect(startHttpServer(root.rootPath, {
      host: "0.0.0.0",
      port: 0
    })).rejects.toThrow('Refusing to start WraithWalker HTTP server on non-loopback host "0.0.0.0".');
  });
});
import { promises as fs } from "node:fs";
