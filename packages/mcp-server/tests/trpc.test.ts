import { describe, expect, it } from "vitest";

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import {
  createFixtureDescriptor,
  type FixtureDescriptor,
  type RequestPayload,
  type ResponseMeta
} from "@wraithwalker/core/fixture-layout";
import { readSentinel } from "@wraithwalker/core/root";

import { createFixtureRepository } from "../src/fixture-repository.mts";
import { startHttpServer } from "../src/server.mts";
import { createWraithwalkerRouter, type AppRouter } from "../src/trpc.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

async function createClient(serverUrl: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: serverUrl
      })
    ]
  });
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

describe("tRPC capture backend", () => {
  it("reads fallback request and response metadata when only the body file exists", async () => {
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

    expect(await repository.exists(descriptor)).toBe(true);
    expect(await repository.exists(apiDescriptor)).toBe(false);
    expect(await repository.read(await createDescriptor({
      url: "https://cdn.example.com/assets/missing.js"
    }))).toBeNull();

    const fixture = await repository.read(descriptor);
    expect(fixture).toEqual(expect.objectContaining({
      request: expect.objectContaining({
        topOrigin: "https://app.example.com",
        url: "https://cdn.example.com/assets/app.js",
        method: "GET"
      }),
      meta: expect.objectContaining({
        status: 200,
        statusText: "OK",
        mimeType: "application/javascript",
        method: "GET"
      })
    }));
    expect(fixture?.size).toBeGreaterThan(0);
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
      ".wraithwalker/simple/https__app.example.com/RESOURCE_MANIFEST.json"
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
          mode: "simple",
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
      getServerUrls: () => ({
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc"
      })
    });
    const caller = router.createCaller({});

    expect(await caller.system.info()).toEqual(expect.objectContaining({
      rootPath: root.rootPath,
      sentinel: expect.objectContaining({ rootId: "root-trpc" })
    }));

    expect(await caller.fixtures.has({ descriptor })).toEqual({
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
        mode: "simple",
        dumpAllowlistPatterns: ["\\.js$"]
      }],
      editorId: "cursor"
    });
    expect(await fs.readFile(root.resolve(".cursorrules"), "utf8")).toContain("WraithWalker Fixture Context");
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
