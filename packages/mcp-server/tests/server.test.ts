import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { startServer } from "../src/server.mts";
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
        "read-fixture",
        "read-manifest"
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("serves fixture data over MCP tools", async () => {
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
      }
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
      }>;
      expect(endpoints).toEqual([
        expect.objectContaining({
          method: "GET",
          pathname: "/users",
          status: 200
        })
      ]);

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

      const manifestResult = await client.callTool({
        name: "read-manifest",
        arguments: { origin: "https://missing.example.com" }
      });
      expect(manifestResult.isError).toBe(true);
      expect(readTextContent(manifestResult)).toContain("Origin \"https://missing.example.com\" not found.");

      const diffResult = await client.callTool({
        name: "diff-scenarios",
        arguments: { scenarioA: "missing-a", scenarioB: "missing-b" }
      });
      expect(diffResult.isError).not.toBe(true);
      expect(readTextContent(diffResult)).toContain("No differences found.");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
