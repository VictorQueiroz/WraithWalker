import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { AppRouter } from "../src/trpc.mts";
import { isLoopbackHost, startHttpServer, startServer } from "../src/server.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

async function loadServerModuleWithMockedExpress({
  address = { address: "127.0.0.1", family: "IPv4", port: 4319 },
  closeError,
  transportHandleRequest
}: {
  address?: AddressInfo | string | null;
  closeError?: Error;
  transportHandleRequest?: (req: unknown, res: unknown, body: unknown) => Promise<unknown> | unknown;
} = {}) {
  vi.resetModules();

  const fakeApp = {
    use: vi.fn(),
    all: vi.fn(),
    listen: vi.fn()
  };
  const fakeListener = {
    once: vi.fn(),
    address: vi.fn(() => address as never),
    close: vi.fn((callback?: (error?: Error | null) => void) => callback?.(closeError ?? null))
  };
  fakeApp.listen.mockImplementation((_port: number, _host: string, callback?: () => void) => {
    if (callback) {
      queueMicrotask(callback);
    }
    return fakeListener;
  });

  const expressMock = Object.assign(vi.fn(() => fakeApp), {
    json: vi.fn(() => "json-middleware")
  });
  const fakeMcpServerInstances: Array<{
    tool: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }> = [];
  class FakeMcpServer {
    tool = vi.fn();
    connect = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);

    constructor() {
      fakeMcpServerInstances.push(this);
    }
  }
  const fakeTransportInstances: Array<{
    close: ReturnType<typeof vi.fn>;
    handleRequest: ReturnType<typeof vi.fn>;
    onclose?: () => void;
  }> = [];
  class FakeStreamableHTTPServerTransport {
    close = vi.fn().mockResolvedValue(undefined);
    handleRequest = vi.fn(async (req: unknown, res: unknown, body: unknown) => transportHandleRequest?.(req, res, body));
    onclose?: () => void;

    constructor(options: { onsessioninitialized?: (sessionId: string) => void }) {
      fakeTransportInstances.push(this);
      queueMicrotask(() => options.onsessioninitialized?.("session-1"));
    }
  }
  vi.doMock("express", () => ({
    default: expressMock
  }));
  vi.doMock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
    McpServer: FakeMcpServer
  }));
  vi.doMock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
    StreamableHTTPServerTransport: FakeStreamableHTTPServerTransport
  }));

  try {
    const module = await import("../src/server.mts");
    return { module, fakeApp, fakeListener, expressMock, fakeMcpServerInstances, fakeTransportInstances };
  } finally {
    vi.doUnmock("express");
    vi.doUnmock("@modelcontextprotocol/sdk/server/mcp.js");
    vi.doUnmock("@modelcontextprotocol/sdk/server/streamableHttp.js");
  }
}

function readTextContent(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) {
    throw new Error("Expected a CallTool content result.");
  }

  const entry = result.content.find((item): item is { type: string; text?: string } => (
    Boolean(item)
    && typeof item === "object"
    && "type" in item
    && typeof item.type === "string"
  ));
  if (!entry?.text) {
    throw new Error("Expected text content.");
  }

  return entry.text;
}

async function connectClient(rootPath: string) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "wraithwalker-mcp-test-client",
    version: "1.0.0"
  });

  const serverPromise = startServer(rootPath, { transport: serverTransport });
  await client.connect(clientTransport);
  const server = await serverPromise;

  return { client, server };
}

async function connectHttpClient(rootPath: string) {
  const server = await startHttpServer(rootPath, {
    host: "127.0.0.1",
    port: 0
  });
  const client = new Client({
    name: "wraithwalker-mcp-http-test-client",
    version: "1.0.0"
  });
  const transport = new StreamableHTTPClientTransport(new URL(server.url));

  try {
    await client.connect(transport);
    return { client, server, transport };
  } catch (error) {
    await server.close();
    throw error;
  }
}

function createTrpcClient(serverUrl: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: serverUrl
      })
    ]
  });
}

async function createFixtureRootWithData() {
  const root = await createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-mcp-server-",
    rootId: "root-mcp-server"
  });
  const topOriginKey = "https__app.example.com";
  const appAsset = {
    requestUrl: "https://cdn.example.com/app.js",
    requestOrigin: "https://cdn.example.com",
    pathname: "/app.js",
    search: "",
    bodyPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/app.js.__body`,
    projectionPath: "cdn.example.com/assets/app.js",
    requestPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/app.js.__request.json`,
    metaPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/app.js.__response.json`,
    mimeType: "application/javascript",
    resourceType: "Script",
    capturedAt: "2026-04-05T00:00:00.000Z"
  };
  const chunkAsset = {
    requestUrl: "https://cdn.example.com/assets/chunk.js",
    requestOrigin: "https://cdn.example.com",
    pathname: "/assets/chunk.js",
    search: "",
    bodyPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/chunk.js.__body`,
    projectionPath: "cdn.example.com/assets/chunk.js",
    requestPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/chunk.js.__request.json`,
    metaPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/chunk.js.__response.json`,
    mimeType: "application/javascript",
    resourceType: "Script",
    capturedAt: "2026-04-05T00:00:00.000Z"
  };
  const stylesheetAsset = {
    requestUrl: "https://cdn.example.com/styles/dropdown.css",
    requestOrigin: "https://cdn.example.com",
    pathname: "/styles/dropdown.css",
    search: "",
    bodyPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/styles/dropdown.css.__body`,
    projectionPath: "cdn.example.com/styles/dropdown.css",
    requestPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/styles/dropdown.css.__request.json`,
    metaPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/styles/dropdown.css.__response.json`,
    mimeType: "text/css",
    resourceType: "Stylesheet",
    capturedAt: "2026-04-05T00:00:00.000Z"
  };

  await root.writeManifest({
    topOrigin: "https://app.example.com",
    manifest: {
      schemaVersion: 1,
      topOrigin: "https://app.example.com",
      topOriginKey: "https__app.example.com",
      generatedAt: "2026-04-05T00:00:00.000Z",
      resourcesByPathname: {
        "/app.js": [appAsset],
        "/assets/chunk.js": [chunkAsset],
        "/styles/dropdown.css": [stylesheetAsset]
      }
    }
  });

  await root.writeApiFixture({
    topOrigin: "https://app.example.com",
    requestOrigin: "https://api.example.com",
    method: "GET",
    fixtureName: "users__q-abc__b-def",
    meta: {
      status: 200,
      statusText: "OK",
      mimeType: "application/json",
      resourceType: "Fetch",
      url: "https://api.example.com/users",
      method: "GET",
      capturedAt: "2026-04-05T00:00:00.000Z"
    },
    body: "{\"users\":[{\"id\":1}],\"dropdownTheme\":\"dark\"}"
  });

  await root.writeText(appAsset.bodyPath, "renderDropdown({ animated: true });");
  await root.writeJson(appAsset.requestPath, {
    topOrigin: "https://app.example.com",
    url: appAsset.requestUrl,
    method: "GET",
    headers: [],
    body: "",
    bodyEncoding: "utf8",
    bodyHash: "b-body",
    queryHash: "q-empty",
    capturedAt: appAsset.capturedAt
  });
  await root.writeJson(appAsset.metaPath, {
    status: 200,
    statusText: "OK",
    headers: [{ name: "Content-Type", value: appAsset.mimeType }],
    mimeType: appAsset.mimeType,
    resourceType: appAsset.resourceType,
    url: appAsset.requestUrl,
    method: "GET",
    capturedAt: appAsset.capturedAt,
    bodyEncoding: "utf8",
    bodySuggestedExtension: "js"
  });
  await root.writeText(appAsset.projectionPath, "renderDropdown({ animated: true });");
  await root.writeText(
    chunkAsset.bodyPath,
    "function renderMenu(){if(open){return{variant:\"dark\"}}return null}"
  );
  await root.writeJson(chunkAsset.requestPath, {
    topOrigin: "https://app.example.com",
    url: chunkAsset.requestUrl,
    method: "GET",
    headers: [],
    body: "",
    bodyEncoding: "utf8",
    bodyHash: "b-body",
    queryHash: "q-empty",
    capturedAt: chunkAsset.capturedAt
  });
  await root.writeJson(chunkAsset.metaPath, {
    status: 200,
    statusText: "OK",
    headers: [{ name: "Content-Type", value: chunkAsset.mimeType }],
    mimeType: chunkAsset.mimeType,
    resourceType: chunkAsset.resourceType,
    url: chunkAsset.requestUrl,
    method: "GET",
    capturedAt: chunkAsset.capturedAt,
    bodyEncoding: "utf8",
    bodySuggestedExtension: "js"
  });
  await root.writeText(
    chunkAsset.projectionPath,
    "function renderMenu(){if(open){return{variant:\"dark\"}}return null}"
  );
  await root.writeText(stylesheetAsset.bodyPath, ".dropdown { color: #111; }");
  await root.writeJson(stylesheetAsset.requestPath, {
    topOrigin: "https://app.example.com",
    url: stylesheetAsset.requestUrl,
    method: "GET",
    headers: [],
    body: "",
    bodyEncoding: "utf8",
    bodyHash: "b-body",
    queryHash: "q-empty",
    capturedAt: stylesheetAsset.capturedAt
  });
  await root.writeJson(stylesheetAsset.metaPath, {
    status: 200,
    statusText: "OK",
    headers: [{ name: "Content-Type", value: stylesheetAsset.mimeType }],
    mimeType: stylesheetAsset.mimeType,
    resourceType: stylesheetAsset.resourceType,
    url: stylesheetAsset.requestUrl,
    method: "GET",
    capturedAt: stylesheetAsset.capturedAt,
    bodyEncoding: "utf8",
    bodySuggestedExtension: "css"
  });
  await root.writeText(stylesheetAsset.projectionPath, ".dropdown { color: #111; }");
  await root.writeText("notes/ui-guidelines.txt", "Dropdown styling reference for agents.");
  await fs.mkdir(path.dirname(root.resolve("bin/blob.bin")), { recursive: true });
  await fs.writeFile(root.resolve("bin/blob.bin"), Buffer.from([0, 1, 2, 3]));

  await root.ensureScenario("baseline");
  await root.ensureScenario("candidate");
  await root.writeApiFixture({
    scenario: "candidate",
    topOrigin: "https://app.example.com",
    requestOrigin: "https://api.example.com",
    method: "GET",
    fixtureName: "users__q-abc__b-def",
    meta: {
      status: 500,
      mimeType: "application/json",
      url: "https://api.example.com/users",
      method: "GET"
    },
    body: "{\"error\":true}"
  });
  await root.writeApiFixture({
    scenario: "baseline",
    topOrigin: "https://app.example.com",
    requestOrigin: "https://api.example.com",
    method: "GET",
    fixtureName: "users__q-abc__b-def",
    meta: {
      status: 200,
      mimeType: "application/json",
      url: "https://api.example.com/users",
      method: "GET"
    },
    body: "{\"users\":[]}"
  });

  return root;
}

afterEach(() => {
  // The tests explicitly close the MCP client/server pair. This hook keeps the
  // test file symmetric with other suites and makes later cleanup additions safe.
});

describe("mcp server", () => {
  it("registers the expected tools", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-",
      rootId: "root-mcp-server"
    });
    const { client, server } = await connectClient(root.rootPath);

    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "browser-status",
        "diff-snapshots",
        "list-api-routes",
        "list-files",
        "list-sites",
        "list-snapshots",
        "list-traces",
        "patch-file",
        "read-api-response",
        "read-file",
        "read-file-snippet",
        "read-site-manifest",
        "read-trace",
        "restore-file",
        "search-files",
        "start-trace",
        "stop-trace",
        "write-file"
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("serves fixture data over MCP tools", async () => {
    const root = await createFixtureRootWithData();

    const { client, server } = await connectClient(root.rootPath);

    try {
      const listOriginsResult = await client.callTool({
        name: "list-sites",
        arguments: {}
      });
      const origins = JSON.parse(readTextContent(listOriginsResult)) as Array<{
        origin: string;
        manifestPath: string | null;
        apiEndpoints: number;
        staticAssets: number;
      }>;
      expect(origins).toEqual([
        expect.objectContaining({
          origin: "https://app.example.com",
          manifestPath: ".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json",
          apiEndpoints: 1,
          staticAssets: 3
        })
      ]);

      const listAssetsResult = await client.callTool({
        name: "list-files",
        arguments: {
          origin: "https://app.example.com",
          resourceTypes: ["Script"],
          mimeTypes: ["application/javascript"],
          pathnameContains: "app"
        }
      });
      const assets = JSON.parse(readTextContent(listAssetsResult)) as {
        matchedOrigins: string[];
        items: Array<{
          origin: string;
          path: string;
          pathname: string;
          mimeType: string;
          bodyPath: string;
          hasBody: boolean;
          bodySize: number | null;
          editable: boolean;
          canonicalPath: string | null;
        }>;
        totalMatched: number;
        nextCursor: string | null;
      };
      expect(assets).toEqual({
        matchedOrigins: ["https://app.example.com"],
        items: [
          expect.objectContaining({
            origin: "https://app.example.com",
            path: "cdn.example.com/assets/app.js",
            pathname: "/app.js",
            mimeType: "application/javascript",
            bodyPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/app.js.__body",
            hasBody: true,
            bodySize: Buffer.byteLength("renderDropdown({ animated: true });", "utf8"),
            editable: true,
            canonicalPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/app.js.__body"
          })
        ],
        totalMatched: 1,
        nextCursor: null
      });

      const listEndpointsResult = await client.callTool({
        name: "list-api-routes",
        arguments: { origin: "https://app.example.com" }
      });
      const endpoints = JSON.parse(readTextContent(listEndpointsResult)) as {
        matchedOrigins: string[];
        items: Array<{
          origin: string;
          method: string;
          pathname: string;
          status: number;
          fixtureDir: string;
          bodyPath: string;
          metaPath: string;
        }>;
      };
      expect(endpoints).toEqual({
        matchedOrigins: ["https://app.example.com"],
        items: [
          expect.objectContaining({
            origin: "https://app.example.com",
            method: "GET",
            pathname: "/users",
            status: 200,
            fixtureDir: ".wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/GET/users__q-abc__b-def",
            metaPath: ".wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/GET/users__q-abc__b-def/response.meta.json",
            bodyPath: ".wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/GET/users__q-abc__b-def/response.body"
          })
        ]
      });

      const endpointFixtureResult = await client.callTool({
        name: "read-api-response",
        arguments: { fixtureDir: endpoints.items[0].fixtureDir }
      });
      const endpointFixture = JSON.parse(readTextContent(endpointFixtureResult)) as {
        fixtureDir: string;
        meta: { status: number; url: string };
        body: string | null;
      };
      expect(endpointFixture).toEqual(expect.objectContaining({
        fixtureDir: endpoints.items[0].fixtureDir,
        meta: expect.objectContaining({
          status: 200,
          url: "https://api.example.com/users"
        }),
        body: "{\"users\":[{\"id\":1}],\"dropdownTheme\":\"dark\"}"
      }));

      const prettyEndpointFixtureResult = await client.callTool({
        name: "read-api-response",
        arguments: {
          fixtureDir: endpoints.items[0].fixtureDir,
          pretty: true
        }
      });
      const prettyEndpointFixture = JSON.parse(readTextContent(prettyEndpointFixtureResult)) as {
        body: string | null;
      };
      expect(prettyEndpointFixture.body).toBe('{ "users": [{ "id": 1 }], "dropdownTheme": "dark" }');

      const searchResult = await client.callTool({
        name: "search-files",
        arguments: {
          query: "dropdown"
        }
      });
      const searchMatches = JSON.parse(readTextContent(searchResult)) as {
        matchedOrigins: string[];
        items: Array<{
          path: string;
          sourceKind: string;
          matchKind: string;
          matchCount: number;
          editable: boolean;
          canonicalPath: string | null;
        }>;
        totalMatched: number;
      };
      expect(searchMatches.totalMatched).toBe(4);
      expect(searchMatches.matchedOrigins).toEqual(["https://app.example.com"]);
      expect(searchMatches.items.map((item) => item.sourceKind)).toEqual([
        "endpoint",
        "asset",
        "asset",
        "file"
      ]);
      expect(searchMatches.items.map((item) => item.matchKind)).toEqual([
        "body",
        "body",
        "body",
        "body"
      ]);
      expect(searchMatches.items.map((item) => item.matchCount)).toEqual([1, 1, 1, 1]);
      expect(searchMatches.items.find((item) => item.path === "cdn.example.com/assets/app.js")).toEqual(
        expect.objectContaining({
          editable: true,
          canonicalPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/app.js.__body"
        })
      );

      const snippetResult = await client.callTool({
        name: "read-file-snippet",
        arguments: {
          path: "cdn.example.com/assets/app.js",
          startLine: 1,
          lineCount: 1
        }
      });
      const snippet = JSON.parse(readTextContent(snippetResult)) as {
        path: string;
        startLine: number;
        endLine: number;
        truncated: boolean;
        text: string;
      };
      expect(snippet).toEqual({
        path: "cdn.example.com/assets/app.js",
        startLine: 1,
        endLine: 1,
        truncated: false,
        text: "renderDropdown({ animated: true });"
      });

      const fixtureResult = await client.callTool({
        name: "read-file",
        arguments: { path: "cdn.example.com/assets/app.js" }
      });
      expect(readTextContent(fixtureResult)).toBe("renderDropdown({ animated: true });");

      const prettyFixtureResult = await client.callTool({
        name: "read-file",
        arguments: {
          path: "cdn.example.com/assets/chunk.js",
          pretty: true
        }
      });
      expect(readTextContent(prettyFixtureResult)).toBe(
        "function renderMenu() {\n  if (open) {\n    return { variant: \"dark\" };\n  }\n  return null;\n}"
      );

      const prettySnippetResult = await client.callTool({
        name: "read-file-snippet",
        arguments: {
          path: "cdn.example.com/assets/chunk.js",
          pretty: true,
          startLine: 2,
          lineCount: 3
        }
      });
      const prettySnippet = JSON.parse(readTextContent(prettySnippetResult)) as {
        path: string;
        startLine: number;
        endLine: number;
        truncated: boolean;
        text: string;
      };
      expect(prettySnippet).toEqual({
        path: "cdn.example.com/assets/chunk.js",
        startLine: 2,
        endLine: 4,
        truncated: false,
        text: "  if (open) {\n    return { variant: \"dark\" };\n  }"
      });

      const manifestResult = await client.callTool({
        name: "read-site-manifest",
        arguments: { origin: "https://app.example.com" }
      });
      const manifest = JSON.parse(readTextContent(manifestResult)) as {
        resourcesByPathname: Record<string, unknown[]>;
      };
      expect(manifest.resourcesByPathname["/app.js"]).toHaveLength(1);
      expect(manifest.resourcesByPathname["/styles/dropdown.css"]).toHaveLength(1);

      const scenariosResult = await client.callTool({
        name: "list-snapshots",
        arguments: {}
      });
      const scenarios = JSON.parse(readTextContent(scenariosResult)) as { scenarios: string[] };
      expect(scenarios.scenarios.sort()).toEqual(["baseline", "candidate"]);

      const diffResult = await client.callTool({
        name: "diff-snapshots",
        arguments: { scenarioA: "baseline", scenarioB: "candidate" }
      });
      const diffText = readTextContent(diffResult);
      expect(diffText).toContain("# Fixture Diff: baseline vs candidate");
      expect(diffText).toContain("## Changed Endpoints");
      expect(diffText).toContain("200 → 500");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("writes, patches, and restores editable projection files without mutating canonical bodies", async () => {
    const root = await createFixtureRootWithData();
    const { client, server } = await connectClient(root.rootPath);
    const canonicalPath = ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/chunk.js.__body";
    const projectionPath = "cdn.example.com/assets/chunk.js";

    try {
      const writeResult = await client.callTool({
        name: "write-file",
        arguments: {
          path: projectionPath,
          content: "const seededUsers = [{ id: 1 }];\nconst theme = \"dark\";\n"
        }
      });
      expect(writeResult.isError).not.toBe(true);
      expect(JSON.parse(readTextContent(writeResult))).toEqual(expect.objectContaining({
        path: projectionPath,
        canonicalPath,
        editable: true,
        currentText: "const seededUsers = [{ id: 1 }];\nconst theme = \"dark\";\n"
      }));
      await expect(fs.readFile(root.resolve(projectionPath), "utf8")).resolves.toBe(
        "const seededUsers = [{ id: 1 }];\nconst theme = \"dark\";\n"
      );
      await expect(fs.readFile(root.resolve(canonicalPath), "utf8")).resolves.toBe(
        "function renderMenu(){if(open){return{variant:\"dark\"}}return null}"
      );

      const patchResult = await client.callTool({
        name: "patch-file",
        arguments: {
          path: projectionPath,
          startLine: 1,
          endLine: 1,
          expectedText: "const seededUsers = [{ id: 1 }];",
          replacement: "const seededUsers = [{ id: 1 }, { id: 2 }];"
        }
      });
      expect(patchResult.isError).not.toBe(true);
      expect(JSON.parse(readTextContent(patchResult))).toEqual(expect.objectContaining({
        currentText: "const seededUsers = [{ id: 1 }, { id: 2 }];\nconst theme = \"dark\";\n"
      }));

      const conflictResult = await client.callTool({
        name: "patch-file",
        arguments: {
          path: projectionPath,
          startLine: 1,
          endLine: 1,
          expectedText: "const seededUsers = [{ id: 1 }];",
          replacement: "const seededUsers = [];"
        }
      });
      expect(conflictResult.isError).toBe(true);
      expect(readTextContent(conflictResult)).toContain("Patch conflict");

      const restoreResult = await client.callTool({
        name: "restore-file",
        arguments: { path: projectionPath }
      });
      expect(restoreResult.isError).not.toBe(true);
      expect(JSON.parse(readTextContent(restoreResult))).toEqual(expect.objectContaining({
        path: projectionPath,
        canonicalPath,
        editable: true,
        currentText: "function renderMenu() {\n  if (open) {\n    return { variant: \"dark\" };\n  }\n  return null;\n}"
      }));
      await expect(fs.readFile(root.resolve(projectionPath), "utf8")).resolves.toBe(
        "function renderMenu() {\n  if (open) {\n    return { variant: \"dark\" };\n  }\n  return null;\n}"
      );
      await expect(fs.readFile(root.resolve(canonicalPath), "utf8")).resolves.toBe(
        "function renderMenu(){if(open){return{variant:\"dark\"}}return null}"
      );

      const hiddenPathResult = await client.callTool({
        name: "write-file",
        arguments: {
          path: canonicalPath,
          content: "oops"
        }
      });
      expect(hiddenPathResult.isError).toBe(true);
      expect(readTextContent(hiddenPathResult)).toContain("Hidden canonical files under .wraithwalker cannot be edited");

      const apiResult = await client.callTool({
        name: "write-file",
        arguments: {
          path: ".wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/GET/users__q-abc__b-def/response.body",
          content: "{\"users\":[]}"
        }
      });
      expect(apiResult.isError).toBe(true);
      expect(readTextContent(apiResult)).toContain("API response fixtures are read-only in this pass");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns MCP tool errors for invalid requests", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-",
      rootId: "root-mcp-server"
    });
    await root.ensureScenario("baseline");
    const { client, server } = await connectClient(root.rootPath);

    try {
      const assetResult = await client.callTool({
        name: "list-files",
        arguments: { origin: "https://missing.example.com" }
      });
      expect(assetResult.isError).toBe(true);
      expect(readTextContent(assetResult)).toContain("Origin \"https://missing.example.com\" not found.");

      const endpointResult = await client.callTool({
        name: "list-api-routes",
        arguments: { origin: "https://missing.example.com" }
      });
      expect(endpointResult.isError).toBe(true);
      expect(readTextContent(endpointResult)).toContain("Origin \"https://missing.example.com\" not found.");

      const fixtureResult = await client.callTool({
        name: "read-file",
        arguments: { path: "missing.txt" }
      });
      expect(fixtureResult.isError).toBe(true);
      expect(readTextContent(fixtureResult)).toBe("File not found: missing.txt");

      const invalidFixturePathResult = await client.callTool({
        name: "read-file",
        arguments: { path: "../package.json" }
      });
      expect(invalidFixturePathResult.isError).toBe(true);
      expect(readTextContent(invalidFixturePathResult)).toContain("Invalid fixture path: ../package.json");

      const snippetMissingResult = await client.callTool({
        name: "read-file-snippet",
        arguments: { path: "missing.txt" }
      });
      expect(snippetMissingResult.isError).toBe(true);
      expect(readTextContent(snippetMissingResult)).toContain("File not found: missing.txt");

      const snippetInvalidPathResult = await client.callTool({
        name: "read-file-snippet",
        arguments: { path: "../package.json" }
      });
      expect(snippetInvalidPathResult.isError).toBe(true);
      expect(readTextContent(snippetInvalidPathResult)).toContain("Invalid fixture path: ../package.json");

      const invalidEndpointFixtureResult = await client.callTool({
        name: "read-api-response",
        arguments: { fixtureDir: "../escape" }
      });
      expect(invalidEndpointFixtureResult.isError).toBe(true);
      expect(readTextContent(invalidEndpointFixtureResult)).toContain("Invalid fixture directory: ../escape");

      const manifestResult = await client.callTool({
        name: "read-site-manifest",
        arguments: { origin: "https://missing.example.com" }
      });
      expect(manifestResult.isError).toBe(true);
      expect(readTextContent(manifestResult)).toContain("Origin \"https://missing.example.com\" not found.");

      const searchResult = await client.callTool({
        name: "search-files",
        arguments: {
          query: "dropdown",
          origin: "https://missing.example.com"
        }
      });
      expect(searchResult.isError).toBe(true);
      expect(readTextContent(searchResult)).toContain("Origin \"https://missing.example.com\" not found.");

      await root.ensureOrigin({ topOrigin: "https://empty.example.com" });
      const emptyManifestResult = await client.callTool({
        name: "read-site-manifest",
        arguments: { origin: "https://empty.example.com" }
      });
      expect(emptyManifestResult.isError).toBe(true);
      expect(readTextContent(emptyManifestResult)).toContain("No manifest found for \"https://empty.example.com\".");

      const invalidCursorResult = await client.callTool({
        name: "list-files",
        arguments: {
          origin: "https://empty.example.com",
          cursor: "not-a-cursor"
        }
      });
      expect(invalidCursorResult.isError).toBe(true);
      expect(readTextContent(invalidCursorResult)).toContain("Invalid cursor");

      await fs.mkdir(path.dirname(root.resolve("bin/blob.bin")), { recursive: true });
      await fs.writeFile(root.resolve("bin/blob.bin"), Buffer.from([0, 1, 2, 3]));
      const binarySnippetResult = await client.callTool({
        name: "read-file-snippet",
        arguments: { path: "bin/blob.bin" }
      });
      expect(binarySnippetResult.isError).toBe(true);
      expect(readTextContent(binarySnippetResult)).toContain("Fixture is not a text file");

      const diffResult = await client.callTool({
        name: "diff-snapshots",
        arguments: { scenarioA: "missing-a", scenarioB: "missing-b" }
      });
      expect(diffResult.isError).toBe(true);
      expect(readTextContent(diffResult)).toContain('Scenario "missing-a" does not exist.');
      expect(readTextContent(diffResult)).toContain("Available scenarios: baseline");

      const invalidScenarioResult = await client.callTool({
        name: "diff-snapshots",
        arguments: { scenarioA: "../escape", scenarioB: "baseline" }
      });
      expect(invalidScenarioResult.isError).toBe(true);
      expect(readTextContent(invalidScenarioResult)).toContain("Scenario name must be 1-64 alphanumeric");
      expect(readTextContent(invalidScenarioResult)).not.toContain("Available scenarios:");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("filters origins, surfaces asset body availability, and falls back to path matches", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-",
      rootId: "root-mcp-server"
    });
    await root.writeManifest({
      topOrigin: "https://app.example.com",
      manifest: {
        schemaVersion: 1,
        topOrigin: "https://app.example.com",
        topOriginKey: "https__app.example.com",
        generatedAt: "2026-04-06T00:00:00.000Z",
        resourcesByPathname: {
          "/assets/hierarchy.chunk.js": [{
            requestUrl: "https://cdn.example.com/assets/hierarchy.chunk.js",
            requestOrigin: "https://cdn.example.com",
            pathname: "/assets/hierarchy.chunk.js",
            search: "",
            bodyPath: "cdn.example.com/assets/hierarchy.chunk.js",
            requestPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/hierarchy.chunk.js.__request.json",
            metaPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/hierarchy.chunk.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-06T00:00:00.000Z"
          }]
        }
      }
    });
    await root.ensureOrigin({ topOrigin: "https://admin.example.com" });

    const { client, server } = await connectClient(root.rootPath);

    try {
      const filteredOriginsResult = await client.callTool({
        name: "list-sites",
        arguments: { search: "ADMIN" }
      });
      const filteredOrigins = JSON.parse(readTextContent(filteredOriginsResult)) as Array<{ origin: string }>;
      expect(filteredOrigins).toEqual([
        expect.objectContaining({
          origin: "https://admin.example.com"
        })
      ]);

      const assetsResult = await client.callTool({
        name: "list-files",
        arguments: { origin: "https://app.example.com" }
      });
      const assets = JSON.parse(readTextContent(assetsResult)) as {
        items: Array<{
          pathname: string;
          origin: string;
          hasBody: boolean;
          bodySize: number | null;
        }>;
        matchedOrigins: string[];
      };
      expect(assets.matchedOrigins).toEqual(["https://app.example.com"]);
      expect(assets.items).toEqual([
        expect.objectContaining({
          origin: "https://app.example.com",
          pathname: "/assets/hierarchy.chunk.js",
          hasBody: false,
          bodySize: null
        })
      ]);

      const searchResult = await client.callTool({
        name: "search-files",
        arguments: {
          query: "hierarchy",
          resourceTypes: ["Script"]
        }
      });
      const searchMatches = JSON.parse(readTextContent(searchResult)) as {
        matchedOrigins: string[];
        items: Array<{
          path: string;
          matchKind: string;
          matchCount: number;
          excerpt: string;
        }>;
      };
      expect(searchMatches.matchedOrigins).toEqual(["https://app.example.com"]);
      expect(searchMatches.items).toEqual([
        expect.objectContaining({
          path: "cdn.example.com/assets/hierarchy.chunk.js",
          matchKind: "path",
          matchCount: 1,
          excerpt: "Matched path: /assets/hierarchy.chunk.js"
        })
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("filters origins by search with zero and multiple matches", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-",
      rootId: "root-mcp-server"
    });
    await root.ensureOrigin({ topOrigin: "https://admin.example.com" });
    await root.ensureOrigin({ topOrigin: "http://admin.example.com" });
    await root.ensureOrigin({ topOrigin: "https://app.example.com" });

    const { client, server } = await connectClient(root.rootPath);

    try {
      const adminOriginsResult = await client.callTool({
        name: "list-sites",
        arguments: { search: "ADMIN" }
      });
      const adminOrigins = JSON.parse(readTextContent(adminOriginsResult)) as Array<{ origin: string }>;
      expect(adminOrigins.map((origin) => origin.origin).sort()).toEqual([
        "http://admin.example.com",
        "https://admin.example.com"
      ]);

      const missingOriginsResult = await client.callTool({
        name: "list-sites",
        arguments: { search: "missing" }
      });
      expect(JSON.parse(readTextContent(missingOriginsResult))).toEqual([]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("reports repeated search matches and keeps manifest reads exact by scheme", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-",
      rootId: "root-mcp-server"
    });
    await root.writeManifest({
      topOrigin: "http://app.example.com",
      manifest: {
        schemaVersion: 1,
        topOrigin: "http://app.example.com",
        topOriginKey: "http__app.example.com",
        generatedAt: "2026-04-06T00:00:00.000Z",
        resourcesByPathname: {
          "/assets/http-only.js": [{
            requestUrl: "http://cdn.example.com/assets/http-only.js",
            requestOrigin: "http://cdn.example.com",
            pathname: "/assets/http-only.js",
            search: "",
            bodyPath: "cdn.example.com/assets/http-only.js",
            requestPath: ".wraithwalker/captures/assets/http__app.example.com/cdn.example.com/http-only.js.__request.json",
            metaPath: ".wraithwalker/captures/assets/http__app.example.com/cdn.example.com/http-only.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-06T00:00:00.000Z"
          }]
        }
      }
    });
    await root.writeManifest({
      topOrigin: "https://app.example.com",
      manifest: {
        schemaVersion: 1,
        topOrigin: "https://app.example.com",
        topOriginKey: "https__app.example.com",
        generatedAt: "2026-04-06T00:00:00.000Z",
        resourcesByPathname: {
          "/assets/repeat.js": [{
            requestUrl: "https://cdn.example.com/assets/repeat.js",
            requestOrigin: "https://cdn.example.com",
            pathname: "/assets/repeat.js",
            search: "",
            bodyPath: "cdn.example.com/assets/repeat.js",
            requestPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/repeat.js.__request.json",
            metaPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/repeat.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-06T00:00:00.000Z"
          }]
        }
      }
    });
    await root.writeText("cdn.example.com/assets/repeat.js", "dropdown();\nshowDropdown();\ndropdown();");
    await root.writeText("cdn.example.com/assets/http-only.js", "console.log('http only');");

    const { client, server } = await connectClient(root.rootPath);

    try {
      const searchResult = await client.callTool({
        name: "search-files",
        arguments: {
          origin: "https://app.example.com",
          query: "dropdown"
        }
      });
      const searchMatches = JSON.parse(readTextContent(searchResult)) as {
        matchedOrigins: string[];
        items: Array<{
          origin: string | null;
          path: string;
          matchKind: string;
          matchCount: number;
        }>;
      };
      expect(searchMatches.matchedOrigins).toEqual([
        "http://app.example.com",
        "https://app.example.com"
      ]);
      expect(searchMatches.items).toEqual([
        expect.objectContaining({
          origin: "https://app.example.com",
          path: "cdn.example.com/assets/repeat.js",
          matchKind: "body",
          matchCount: 3
        })
      ]);

      const httpsManifestResult = await client.callTool({
        name: "read-site-manifest",
        arguments: { origin: "https://app.example.com" }
      });
      const httpsManifest = JSON.parse(readTextContent(httpsManifestResult)) as {
        topOrigin: string;
        resourcesByPathname: Record<string, unknown[]>;
      };
      expect(httpsManifest.topOrigin).toBe("https://app.example.com");
      expect(Object.keys(httpsManifest.resourcesByPathname)).toEqual(["/assets/repeat.js"]);

      const httpManifestResult = await client.callTool({
        name: "read-site-manifest",
        arguments: { origin: "http://app.example.com" }
      });
      const httpManifest = JSON.parse(readTextContent(httpManifestResult)) as {
        topOrigin: string;
        resourcesByPathname: Record<string, unknown[]>;
      };
      expect(httpManifest.topOrigin).toBe("http://app.example.com");
      expect(Object.keys(httpManifest.resourcesByPathname)).toEqual(["/assets/http-only.js"]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("matches discovery origins by host and port across schemes", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-",
      rootId: "root-mcp-server"
    });
    await root.writeManifest({
      topOrigin: "http://app.example.com:8443",
      manifest: {
        schemaVersion: 1,
        topOrigin: "http://app.example.com:8443",
        topOriginKey: "http__app.example.com__8443",
        generatedAt: "2026-04-06T00:00:00.000Z",
        resourcesByPathname: {
          "/assets/http-port.js": [{
            requestUrl: "http://cdn.example.com:8443/assets/http-port.js",
            requestOrigin: "http://cdn.example.com:8443",
            pathname: "/assets/http-port.js",
            search: "",
            bodyPath: "cdn.example.com/assets/http-port.js",
            requestPath: ".wraithwalker/captures/assets/http__app.example.com__8443/cdn.example.com/http-port.js.__request.json",
            metaPath: ".wraithwalker/captures/assets/http__app.example.com__8443/cdn.example.com/http-port.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-06T00:00:00.000Z"
          }]
        }
      }
    });
    await root.writeManifest({
      topOrigin: "https://app.example.com:8443",
      manifest: {
        schemaVersion: 1,
        topOrigin: "https://app.example.com:8443",
        topOriginKey: "https__app.example.com__8443",
        generatedAt: "2026-04-06T00:00:00.000Z",
        resourcesByPathname: {
          "/assets/https-port.js": [{
            requestUrl: "https://cdn.example.com:8443/assets/https-port.js",
            requestOrigin: "https://cdn.example.com:8443",
            pathname: "/assets/https-port.js",
            search: "",
            bodyPath: "cdn.example.com/assets/https-port.js",
            requestPath: ".wraithwalker/captures/assets/https__app.example.com__8443/cdn.example.com/https-port.js.__request.json",
            metaPath: ".wraithwalker/captures/assets/https__app.example.com__8443/cdn.example.com/https-port.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-06T00:00:00.000Z"
          }]
        }
      }
    });
    await root.writeManifest({
      topOrigin: "https://app.example.com:9443",
      manifest: {
        schemaVersion: 1,
        topOrigin: "https://app.example.com:9443",
        topOriginKey: "https__app.example.com__9443",
        generatedAt: "2026-04-06T00:00:00.000Z",
        resourcesByPathname: {
          "/assets/other-port.js": [{
            requestUrl: "https://cdn.example.com:9443/assets/other-port.js",
            requestOrigin: "https://cdn.example.com:9443",
            pathname: "/assets/other-port.js",
            search: "",
            bodyPath: "cdn.example.com/assets/other-port.js",
            requestPath: ".wraithwalker/captures/assets/https__app.example.com__9443/cdn.example.com/other-port.js.__request.json",
            metaPath: ".wraithwalker/captures/assets/https__app.example.com__9443/cdn.example.com/other-port.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-06T00:00:00.000Z"
          }]
        }
      }
    });
    await root.writeText("cdn.example.com/assets/http-port.js", "console.log('http port');");
    await root.writeText("cdn.example.com/assets/https-port.js", "console.log('https port');");
    await root.writeText("cdn.example.com/assets/other-port.js", "console.log('other port');");

    const { client, server } = await connectClient(root.rootPath);

    try {
      const assetsResult = await client.callTool({
        name: "list-files",
        arguments: { origin: "https://app.example.com:8443" }
      });
      const assets = JSON.parse(readTextContent(assetsResult)) as {
        matchedOrigins: string[];
        items: Array<{ origin: string; pathname: string }>;
      };
      expect(assets.matchedOrigins).toEqual([
        "http://app.example.com:8443",
        "https://app.example.com:8443"
      ]);
      expect(assets.items.map((item) => item.pathname)).toEqual([
        "/assets/http-port.js",
        "/assets/https-port.js"
      ]);
      expect(assets.items.map((item) => item.origin)).toEqual([
        "http://app.example.com:8443",
        "https://app.example.com:8443"
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("matches discovery tools across http and https origins and rejects oversized full reads", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-",
      rootId: "root-mcp-server"
    });
    const largeBody = "x".repeat(70_000);

    await root.writeManifest({
      topOrigin: "http://app.example.com",
      manifest: {
        schemaVersion: 1,
        topOrigin: "http://app.example.com",
        topOriginKey: "http__app.example.com",
        generatedAt: "2026-04-06T00:00:00.000Z",
        resourcesByPathname: {
          "/assets/http.js": [{
            requestUrl: "http://cdn.example.com/assets/http.js",
            requestOrigin: "http://cdn.example.com",
            pathname: "/assets/http.js",
            search: "",
            bodyPath: "cdn.example.com/assets/http.js",
            requestPath: ".wraithwalker/captures/assets/http__app.example.com/cdn.example.com/http.js.__request.json",
            metaPath: ".wraithwalker/captures/assets/http__app.example.com/cdn.example.com/http.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-06T00:00:00.000Z"
          }]
        }
      }
    });
    await root.writeManifest({
      topOrigin: "https://app.example.com",
      manifest: {
        schemaVersion: 1,
        topOrigin: "https://app.example.com",
        topOriginKey: "https__app.example.com",
        generatedAt: "2026-04-06T00:00:00.000Z",
        resourcesByPathname: {
          "/assets/huge.js": [{
            requestUrl: "https://cdn.example.com/assets/huge.js",
            requestOrigin: "https://cdn.example.com",
            pathname: "/assets/huge.js",
            search: "",
            bodyPath: "cdn.example.com/assets/huge.js",
            requestPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/huge.js.__request.json",
            metaPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/huge.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-06T00:00:00.000Z"
          }]
        }
      }
    });
    await root.writeApiFixture({
      topOrigin: "http://app.example.com",
      requestOrigin: "http://api.example.com",
      method: "GET",
      fixtureName: "status__q-abc__b-def",
      meta: {
        status: 200,
        mimeType: "application/json",
        resourceType: "Fetch",
        url: "http://api.example.com/status",
        method: "GET"
      },
      body: "{\"scheme\":\"http\"}"
    });
    const largeEndpoint = await root.writeApiFixture({
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      method: "GET",
      fixtureName: "large__q-abc__b-def",
      meta: {
        status: 200,
        mimeType: "application/json",
        resourceType: "Fetch",
        url: "https://api.example.com/large",
        method: "GET"
      },
      body: largeBody
    });
    await root.writeText("cdn.example.com/assets/http.js", "console.log('http');");
    await root.writeText("cdn.example.com/assets/huge.js", largeBody);

    const { client, server } = await connectClient(root.rootPath);

    try {
      const assetsResult = await client.callTool({
        name: "list-files",
        arguments: { origin: "https://app.example.com" }
      });
      const assets = JSON.parse(readTextContent(assetsResult)) as {
        matchedOrigins: string[];
        items: Array<{ origin: string; pathname: string }>;
      };
      expect(assets.matchedOrigins).toEqual([
        "http://app.example.com",
        "https://app.example.com"
      ]);
      expect(assets.items.map((item) => item.origin)).toEqual([
        "http://app.example.com",
        "https://app.example.com"
      ]);

      const endpointsResult = await client.callTool({
        name: "list-api-routes",
        arguments: { origin: "https://app.example.com" }
      });
      const endpoints = JSON.parse(readTextContent(endpointsResult)) as {
        matchedOrigins: string[];
        items: Array<{ origin: string; fixtureDir: string }>;
      };
      expect(endpoints.matchedOrigins).toEqual([
        "http://app.example.com",
        "https://app.example.com"
      ]);
      expect(endpoints.items.map((item) => item.origin)).toEqual([
        "https://app.example.com",
        "http://app.example.com"
      ]);

      const searchResult = await client.callTool({
        name: "search-files",
        arguments: {
          origin: "https://app.example.com",
          query: "scheme"
        }
      });
      const search = JSON.parse(readTextContent(searchResult)) as {
        matchedOrigins: string[];
        items: Array<{ origin: string; matchCount: number }>;
      };
      expect(search.matchedOrigins).toEqual([
        "http://app.example.com",
        "https://app.example.com"
      ]);
      expect(search.items).toEqual([
        expect.objectContaining({
          origin: "http://app.example.com",
          matchCount: 1
        })
      ]);

      const largeFixtureRead = await client.callTool({
        name: "read-file",
        arguments: { path: "cdn.example.com/assets/huge.js" }
      });
      expect(largeFixtureRead.isError).toBe(true);
      expect(readTextContent(largeFixtureRead)).toContain("File is too large to read in full: cdn.example.com/assets/huge.js");
      expect(readTextContent(largeFixtureRead)).toContain("Use read-file-snippet with this path and specify startLine and lineCount.");

      const largeEndpointRead = await client.callTool({
        name: "read-api-response",
        arguments: { fixtureDir: largeEndpoint.fixtureDir }
      });
      expect(largeEndpointRead.isError).toBe(true);
      expect(readTextContent(largeEndpointRead)).toContain(`Endpoint fixture body is too large to read in full: ${largeEndpoint.bodyPath}`);
      expect(readTextContent(largeEndpointRead)).toContain(
        `Use read-file-snippet with path "${largeEndpoint.bodyPath}" and specify startLine and lineCount.`
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("enforces the full-read boundary exactly, including pretty reads", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-",
      rootId: "root-mcp-server"
    });
    const exactBody = "x".repeat(65_536);
    const overLimitBody = "y".repeat(65_537);

    await root.writeManifest({
      topOrigin: "https://app.example.com",
      manifest: {
        schemaVersion: 1,
        topOrigin: "https://app.example.com",
        topOriginKey: "https__app.example.com",
        generatedAt: "2026-04-06T00:00:00.000Z",
        resourcesByPathname: {
          "/assets/exact.js": [{
            requestUrl: "https://cdn.example.com/assets/exact.js",
            requestOrigin: "https://cdn.example.com",
            pathname: "/assets/exact.js",
            search: "",
            bodyPath: "cdn.example.com/assets/exact.js",
            requestPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/exact.js.__request.json",
            metaPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/exact.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-06T00:00:00.000Z"
          }],
          "/assets/over.js": [{
            requestUrl: "https://cdn.example.com/assets/over.js",
            requestOrigin: "https://cdn.example.com",
            pathname: "/assets/over.js",
            search: "",
            bodyPath: "cdn.example.com/assets/over.js",
            requestPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/over.js.__request.json",
            metaPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/over.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-06T00:00:00.000Z"
          }]
        }
      }
    });
    const exactEndpoint = await root.writeApiFixture({
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      method: "GET",
      fixtureName: "exact__q-abc__b-def",
      meta: {
        status: 200,
        mimeType: "text/plain",
        resourceType: "Fetch",
        url: "https://api.example.com/exact",
        method: "GET"
      },
      body: exactBody
    });
    const overLimitEndpoint = await root.writeApiFixture({
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      method: "GET",
      fixtureName: "over__q-abc__b-def",
      meta: {
        status: 200,
        mimeType: "application/javascript",
        resourceType: "Fetch",
        url: "https://api.example.com/over",
        method: "GET"
      },
      body: overLimitBody
    });
    await root.writeText("cdn.example.com/assets/exact.js", exactBody);
    await root.writeText("cdn.example.com/assets/over.js", overLimitBody);

    const { client, server } = await connectClient(root.rootPath);

    try {
      const exactFixtureResult = await client.callTool({
        name: "read-file",
        arguments: { path: "cdn.example.com/assets/exact.js" }
      });
      expect(exactFixtureResult.isError).not.toBe(true);
      expect(readTextContent(exactFixtureResult)).toHaveLength(65_536);

      const overLimitFixtureResult = await client.callTool({
        name: "read-file",
        arguments: {
          path: "cdn.example.com/assets/over.js",
          pretty: true
        }
      });
      expect(overLimitFixtureResult.isError).toBe(true);
      expect(readTextContent(overLimitFixtureResult)).toContain("File is too large to read in full: cdn.example.com/assets/over.js");

      const exactEndpointResult = await client.callTool({
        name: "read-api-response",
        arguments: { fixtureDir: exactEndpoint.fixtureDir }
      });
      const exactEndpointFixture = JSON.parse(readTextContent(exactEndpointResult)) as {
        body: string | null;
      };
      expect(exactEndpointFixture.body).toHaveLength(65_536);

      const overLimitEndpointResult = await client.callTool({
        name: "read-api-response",
        arguments: {
          fixtureDir: overLimitEndpoint.fixtureDir,
          pretty: true
        }
      });
      expect(overLimitEndpointResult.isError).toBe(true);
      expect(readTextContent(overLimitEndpointResult)).toContain(
        `Endpoint fixture body is too large to read in full: ${overLimitEndpoint.bodyPath}`
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("reports missing scenarios clearly when none are saved", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-",
      rootId: "root-mcp-server"
    });
    const { client, server } = await connectClient(root.rootPath);

    try {
      const diffResult = await client.callTool({
        name: "diff-snapshots",
        arguments: { scenarioA: "missing-a", scenarioB: "missing-b" }
      });
      expect(diffResult.isError).toBe(true);
      expect(readTextContent(diffResult)).toContain('Scenario "missing-a" does not exist.');
      expect(readTextContent(diffResult)).toContain("No saved scenarios are available.");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("reports that no extension is connected before guided tracing starts", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-",
      rootId: "root-mcp-server"
    });
    const { client, server } = await connectClient(root.rootPath);

    try {
      const statusResult = await client.callTool({ name: "browser-status", arguments: {} });
      expect(JSON.parse(readTextContent(statusResult))).toEqual(
        expect.objectContaining({
          connected: false,
          captureReady: false
        })
      );

      const startResult = await client.callTool({
        name: "start-trace",
        arguments: { name: "Trace without extension" }
      });
      expect(startResult.isError).toBe(true);
      expect(readTextContent(startResult)).toContain("No connected extension is available");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("starts, reads, lists, and stops guided traces after a tRPC extension heartbeat", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-",
      rootId: "root-mcp-server"
    });
    const { client, server, transport } = await connectHttpClient(root.rootPath);
    const trpcClient = createTrpcClient(server.trpcUrl);
    await root.writeProjectConfig({
      schemaVersion: 1,
      sites: [{
        origin: "https://app.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }]
    });

    try {
      const heartbeat = await trpcClient.extension.heartbeat.mutate({
        clientId: "client-1",
        extensionVersion: "1.0.0",
        sessionActive: true,
        enabledOrigins: ["https://app.example.com"]
      });
      expect(heartbeat.activeTrace).toBeNull();

      const statusResult = await client.callTool({ name: "browser-status", arguments: {} });
      expect(JSON.parse(readTextContent(statusResult))).toEqual(
        expect.objectContaining({
          connected: true,
          captureReady: true,
          clientId: "client-1",
          enabledOrigins: ["https://app.example.com"],
          siteConfigs: [expect.objectContaining({ origin: "https://app.example.com" })]
        })
      );

      const startResult = await client.callTool({
        name: "start-trace",
        arguments: { name: "Settings trace" }
      });
      expect(startResult.isError).toBeFalsy();
      const startedTrace = JSON.parse(readTextContent(startResult));
      expect(startedTrace).toEqual(
        expect.objectContaining({
          name: "Settings trace",
          status: "armed",
          extensionClientId: "client-1"
        })
      );

      const listResult = await client.callTool({ name: "list-traces", arguments: {} });
      expect(JSON.parse(readTextContent(listResult))).toEqual([
        expect.objectContaining({
          traceId: startedTrace.traceId,
          status: "armed"
        })
      ]);

      const readResult = await client.callTool({
        name: "read-trace",
        arguments: { traceId: startedTrace.traceId }
      });
      expect(JSON.parse(readTextContent(readResult))).toEqual(
        expect.objectContaining({
          traceId: startedTrace.traceId,
          status: "armed"
        })
      );

      const stopResult = await client.callTool({
        name: "stop-trace",
        arguments: { traceId: startedTrace.traceId }
      });
      expect(JSON.parse(readTextContent(stopResult))).toEqual(
        expect.objectContaining({
          traceId: startedTrace.traceId,
          status: "completed"
        })
      );

      await expect(
        fs.readFile(path.join(root.rootPath, ".wraithwalker", "scenario-traces", startedTrace.traceId, "trace.json"), "utf8")
      ).resolves.toContain(`"traceId": "${startedTrace.traceId}"`);
    } finally {
      await transport.close();
      await client.close();
      await server.close();
    }
  });

  it("serves the same tools over Streamable HTTP", async () => {
    const root = await createFixtureRootWithData();
    const { client, server, transport } = await connectHttpClient(root.rootPath);

    try {
      expect(server.port).toBeGreaterThan(0);
      expect(server.url).toContain(`:${server.port}/mcp`);
      expect(server.tools).toEqual([
        "browser-status",
        "start-trace",
        "stop-trace",
        "list-traces",
        "read-trace",
        "list-sites",
        "list-files",
        "list-api-routes",
        "search-files",
        "read-api-response",
        "read-file",
        "read-file-snippet",
        "read-site-manifest",
        "write-file",
        "patch-file",
        "restore-file",
        "list-snapshots",
        "diff-snapshots"
      ]);

      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "browser-status",
        "diff-snapshots",
        "list-api-routes",
        "list-files",
        "list-sites",
        "list-snapshots",
        "list-traces",
        "patch-file",
        "read-api-response",
        "read-file",
        "read-file-snippet",
        "read-site-manifest",
        "read-trace",
        "restore-file",
        "search-files",
        "start-trace",
        "stop-trace",
        "write-file"
      ]);

      const fixtureResult = await client.callTool({
        name: "read-file",
        arguments: { path: "cdn.example.com/assets/app.js" }
      });
      expect(readTextContent(fixtureResult)).toBe("renderDropdown({ animated: true });");

      const assetResult = await client.callTool({
        name: "list-files",
        arguments: { origin: "https://app.example.com" }
      });
      expect(readTextContent(assetResult)).toContain("\"totalMatched\": 3");

      const endpointResult = await client.callTool({
        name: "read-api-response",
        arguments: {
          fixtureDir: ".wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/GET/users__q-abc__b-def",
          pretty: true
        }
      });
      expect(JSON.parse(readTextContent(endpointResult))).toEqual(expect.objectContaining({
        body: '{ "users": [{ "id": 1 }], "dropdownTheme": "dark" }'
      }));

      const searchResult = await client.callTool({
        name: "search-files",
        arguments: { query: "dropdown" }
      });
      expect(readTextContent(searchResult)).toContain("\"sourceKind\": \"endpoint\"");

      const snippetResult = await client.callTool({
        name: "read-file-snippet",
        arguments: {
          path: "cdn.example.com/assets/chunk.js",
          pretty: true,
          startLine: 2,
          lineCount: 2
        }
      });
      expect(JSON.parse(readTextContent(snippetResult))).toEqual({
        path: "cdn.example.com/assets/chunk.js",
        startLine: 2,
        endLine: 3,
        truncated: false,
        text: "  if (open) {\n    return { variant: \"dark\" };"
      });

      const listOriginsResult = await client.callTool({
        name: "list-sites",
        arguments: {}
      });
      expect(readTextContent(listOriginsResult)).toContain("https://app.example.com");

      const scenariosResult = await client.callTool({
        name: "list-snapshots",
        arguments: {}
      });
      expect(readTextContent(scenariosResult)).toContain("baseline");

      const diffResult = await client.callTool({
        name: "diff-snapshots",
        arguments: { scenarioA: "baseline", scenarioB: "candidate" }
      });
      expect(readTextContent(diffResult)).toContain("200 → 500");

      const invalidFixtureResult = await client.callTool({
        name: "read-file",
        arguments: { path: "../escape" }
      });
      expect(invalidFixtureResult.isError).toBe(true);
      expect(readTextContent(invalidFixtureResult)).toContain("Invalid fixture path: ../escape");

      const invalidSessionResponse = await fetch(server.url, { method: "GET" });
      expect(invalidSessionResponse.status).toBe(400);
      expect(await invalidSessionResponse.text()).toContain("No valid session ID provided");
    } finally {
      await transport.terminateSession();
      await client.close();
      await server.close();
    }
  });

  it("returns a clear 404 for unknown HTTP session IDs", async () => {
    const root = await createFixtureRootWithData();
    const server = await startHttpServer(root.rootPath, {
      host: "127.0.0.1",
      port: 0
    });

    try {
      const response = await fetch(server.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "missing-session"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {}
        })
      });

      expect(response.status).toBe(404);
      const payload = await response.json() as { error: { message: string } };
      expect(payload.error.message).toBe('Session "missing-session" not found.');
    } finally {
      await server.close();
    }
  });

  it("formats loopback hosts consistently for HTTP mode", async () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);

    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-",
      rootId: "root-mcp-server"
    });
    const server = await startHttpServer(root.rootPath, {
      host: "::1",
      port: 0
    });

    try {
      expect(server.url).toContain("http://[::1]:");
    } finally {
      await server.close();
    }
  });

  it("closes active HTTP sessions when shutting down the listener", async () => {
    const root = await createFixtureRootWithData();
    const { client, server } = await connectHttpClient(root.rootPath);

    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);

      await server.close();
    } finally {
      await client.close().catch(() => undefined);
    }
  });

  it("throws when the HTTP listener address cannot be resolved", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-address-",
      rootId: "root-mcp-server-address"
    });
    const { module } = await loadServerModuleWithMockedExpress({
      address: "pipe"
    });

    await expect(
      module.startHttpServer(root.rootPath, { host: "127.0.0.1", port: 0 })
    ).rejects.toThrow("Could not resolve the HTTP listener address.");
  });

  it("propagates listener close errors from the HTTP handle", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-close-",
      rootId: "root-mcp-server-close"
    });
    const { module } = await loadServerModuleWithMockedExpress({
      closeError: new Error("Close failed.")
    });

    const server = await module.startHttpServer(root.rootPath, { host: "127.0.0.1", port: 0 });
    await expect(server.close()).rejects.toThrow("Close failed.");
  });

  it("closes a newly created HTTP MCP session when the transport handler throws", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-transport-",
      rootId: "root-mcp-server-transport"
    });
    const transportError = new Error("Transport failed.");
    const { module, fakeApp, fakeMcpServerInstances, fakeTransportInstances } = await loadServerModuleWithMockedExpress({
      transportHandleRequest: async () => {
        throw transportError;
      }
    });

    const server = await module.startHttpServer(root.rootPath, { host: "127.0.0.1", port: 0 });
    const mcpHandler = fakeApp.all.mock.calls.find(([route]) => route === "/mcp")?.[1] as (
      req: Record<string, unknown>,
      res: {
        headersSent: boolean;
        status: (code: number) => unknown;
        json: (payload: unknown) => unknown;
      }
    ) => Promise<void>;
    const response = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };

    try {
      await mcpHandler(
        {
          headers: {},
          method: "POST",
          body: {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "test-client", version: "1.0.0" }
            }
          }
        },
        response
      );

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining("Transport failed.")
        })
      }));
      expect(fakeTransportInstances[0]?.close).toHaveBeenCalled();
      expect(fakeMcpServerInstances[0]?.close).toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});
