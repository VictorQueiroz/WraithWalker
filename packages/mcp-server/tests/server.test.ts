import { afterEach, describe, expect, it } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { isLoopbackHost, startHttpServer, startServer } from "../src/server.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

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

async function createFixtureRootWithData() {
  const root = await createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-mcp-server-",
    rootId: "root-mcp-server"
  });

  await root.writeManifest({
    mode: "simple",
    topOrigin: "https://app.example.com",
    manifest: {
      schemaVersion: 1,
      topOrigin: "https://app.example.com",
      topOriginKey: "https__app.example.com",
      generatedAt: "2026-04-05T00:00:00.000Z",
      resourcesByPathname: {
        "/app.js": [{
          requestUrl: "https://cdn.example.com/app.js",
          requestOrigin: "https://cdn.example.com",
          pathname: "/app.js",
          search: "",
          bodyPath: "cdn.example.com/assets/app.js",
          requestPath: ".wraithwalker/simple/https__app.example.com/cdn.example.com/app.js.__request.json",
          metaPath: ".wraithwalker/simple/https__app.example.com/cdn.example.com/app.js.__response.json",
          mimeType: "application/javascript",
          resourceType: "Script",
          capturedAt: "2026-04-05T00:00:00.000Z"
        }]
      }
    }
  });

  await root.writeApiFixture({
    mode: "simple",
    topOrigin: "https://app.example.com",
    requestOrigin: "https://api.example.com",
    method: "GET",
    fixtureName: "users__q-abc__b-def",
    meta: {
      status: 200,
      statusText: "OK",
      mimeType: "application/json",
      resourceType: "XHR",
      url: "https://api.example.com/users",
      method: "GET",
      capturedAt: "2026-04-05T00:00:00.000Z"
    },
    body: "{\"users\":[{\"id\":1}]}"
  });

  await root.writeText("cdn.example.com/assets/app.js", "console.log('fixture');");

  await root.ensureScenario("baseline");
  await root.ensureScenario("candidate");
  await root.writeApiFixture({
    mode: "simple",
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
    mode: "simple",
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
        "diff-scenarios",
        "list-endpoints",
        "list-origins",
        "list-scenarios",
        "read-endpoint-fixture",
        "read-fixture",
        "read-manifest"
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
        name: "list-origins",
        arguments: {}
      });
      const origins = JSON.parse(readTextContent(listOriginsResult)) as Array<{
        origin: string;
        apiEndpoints: number;
        staticAssets: number;
      }>;
      expect(origins).toEqual([
        expect.objectContaining({
          origin: "https://app.example.com",
          apiEndpoints: 1,
          staticAssets: 1
        })
      ]);

      const listEndpointsResult = await client.callTool({
        name: "list-endpoints",
        arguments: { origin: "https://app.example.com" }
      });
      const endpoints = JSON.parse(readTextContent(listEndpointsResult)) as Array<{
        method: string;
        pathname: string;
        status: number;
        fixtureDir: string;
      }>;
      expect(endpoints).toEqual([
        expect.objectContaining({
          method: "GET",
          pathname: "/users",
          status: 200,
          fixtureDir: ".wraithwalker/simple/https__app.example.com/origins/https__api.example.com/http/GET/users__q-abc__b-def"
        })
      ]);

      const endpointFixtureResult = await client.callTool({
        name: "read-endpoint-fixture",
        arguments: { fixtureDir: endpoints[0].fixtureDir }
      });
      const endpointFixture = JSON.parse(readTextContent(endpointFixtureResult)) as {
        fixtureDir: string;
        meta: { status: number; url: string };
        body: string | null;
      };
      expect(endpointFixture).toEqual(expect.objectContaining({
        fixtureDir: endpoints[0].fixtureDir,
        meta: expect.objectContaining({
          status: 200,
          url: "https://api.example.com/users"
        }),
        body: "{\"users\":[{\"id\":1}]}"
      }));

      const fixtureResult = await client.callTool({
        name: "read-fixture",
        arguments: { path: "cdn.example.com/assets/app.js" }
      });
      expect(readTextContent(fixtureResult)).toBe("console.log('fixture');");

      const manifestResult = await client.callTool({
        name: "read-manifest",
        arguments: { origin: "https://app.example.com" }
      });
      const manifest = JSON.parse(readTextContent(manifestResult)) as {
        resourcesByPathname: Record<string, unknown[]>;
      };
      expect(manifest.resourcesByPathname["/app.js"]).toHaveLength(1);

      const scenariosResult = await client.callTool({
        name: "list-scenarios",
        arguments: {}
      });
      const scenarios = JSON.parse(readTextContent(scenariosResult)) as { scenarios: string[] };
      expect(scenarios.scenarios.sort()).toEqual(["baseline", "candidate"]);

      const diffResult = await client.callTool({
        name: "diff-scenarios",
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

  it("returns MCP tool errors for invalid requests", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-",
      rootId: "root-mcp-server"
    });
    await root.ensureScenario("baseline");
    const { client, server } = await connectClient(root.rootPath);

    try {
      const endpointResult = await client.callTool({
        name: "list-endpoints",
        arguments: { origin: "https://missing.example.com" }
      });
      expect(endpointResult.isError).toBe(true);
      expect(readTextContent(endpointResult)).toContain("Origin \"https://missing.example.com\" not found.");

      const fixtureResult = await client.callTool({
        name: "read-fixture",
        arguments: { path: "missing.txt" }
      });
      expect(fixtureResult.isError).toBe(true);
      expect(readTextContent(fixtureResult)).toBe("File not found: missing.txt");

      const invalidFixturePathResult = await client.callTool({
        name: "read-fixture",
        arguments: { path: "../package.json" }
      });
      expect(invalidFixturePathResult.isError).toBe(true);
      expect(readTextContent(invalidFixturePathResult)).toContain("Invalid fixture path: ../package.json");

      const invalidEndpointFixtureResult = await client.callTool({
        name: "read-endpoint-fixture",
        arguments: { fixtureDir: "../escape" }
      });
      expect(invalidEndpointFixtureResult.isError).toBe(true);
      expect(readTextContent(invalidEndpointFixtureResult)).toContain("Invalid fixture directory: ../escape");

      const manifestResult = await client.callTool({
        name: "read-manifest",
        arguments: { origin: "https://missing.example.com" }
      });
      expect(manifestResult.isError).toBe(true);
      expect(readTextContent(manifestResult)).toContain("Origin \"https://missing.example.com\" not found.");

      await root.ensureOrigin({ mode: "advanced", topOrigin: "https://empty.example.com" });
      const emptyManifestResult = await client.callTool({
        name: "read-manifest",
        arguments: { origin: "https://empty.example.com" }
      });
      expect(emptyManifestResult.isError).toBe(true);
      expect(readTextContent(emptyManifestResult)).toContain("No manifest found for \"https://empty.example.com\".");

      const diffResult = await client.callTool({
        name: "diff-scenarios",
        arguments: { scenarioA: "missing-a", scenarioB: "missing-b" }
      });
      expect(diffResult.isError).toBe(true);
      expect(readTextContent(diffResult)).toContain('Scenario "missing-a" does not exist.');
      expect(readTextContent(diffResult)).toContain("Available scenarios: baseline");

      const invalidScenarioResult = await client.callTool({
        name: "diff-scenarios",
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

  it("reports missing scenarios clearly when none are saved", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-server-",
      rootId: "root-mcp-server"
    });
    const { client, server } = await connectClient(root.rootPath);

    try {
      const diffResult = await client.callTool({
        name: "diff-scenarios",
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

  it("serves the same tools over Streamable HTTP", async () => {
    const root = await createFixtureRootWithData();
    const { client, server, transport } = await connectHttpClient(root.rootPath);

    try {
      expect(server.port).toBeGreaterThan(0);
      expect(server.url).toContain(`:${server.port}/mcp`);
      expect(server.tools).toEqual([
        "list-origins",
        "list-endpoints",
        "read-endpoint-fixture",
        "read-fixture",
        "read-manifest",
        "list-scenarios",
        "diff-scenarios"
      ]);

      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "diff-scenarios",
        "list-endpoints",
        "list-origins",
        "list-scenarios",
        "read-endpoint-fixture",
        "read-fixture",
        "read-manifest"
      ]);

      const fixtureResult = await client.callTool({
        name: "read-fixture",
        arguments: { path: "cdn.example.com/assets/app.js" }
      });
      expect(readTextContent(fixtureResult)).toBe("console.log('fixture');");

      const endpointResult = await client.callTool({
        name: "read-endpoint-fixture",
        arguments: {
          fixtureDir: ".wraithwalker/simple/https__app.example.com/origins/https__api.example.com/http/GET/users__q-abc__b-def"
        }
      });
      expect(readTextContent(endpointResult)).toContain("\"status\": 200");

      const listOriginsResult = await client.callTool({
        name: "list-origins",
        arguments: {}
      });
      expect(readTextContent(listOriginsResult)).toContain("https://app.example.com");

      const scenariosResult = await client.callTool({
        name: "list-scenarios",
        arguments: {}
      });
      expect(readTextContent(scenariosResult)).toContain("baseline");

      const diffResult = await client.callTool({
        name: "diff-scenarios",
        arguments: { scenarioA: "baseline", scenarioB: "candidate" }
      });
      expect(readTextContent(diffResult)).toContain("200 → 500");

      const invalidFixtureResult = await client.callTool({
        name: "read-fixture",
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
});
