import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { startServer } from "../src/server.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";
import type { StaticResourceManifest } from "@wraithwalker/core/fixtures";

interface FixtureReadPageShape {
  path: string;
  sizeBytes: number;
  startByte: number;
  bytesReturned: number;
  maxBytes: number;
  truncated: boolean;
  nextCursor: string | null;
  text: string;
}

function readTextContent(result: unknown): string {
  if (
    !result ||
    typeof result !== "object" ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    throw new Error("Expected a CallTool content result.");
  }

  const entry = result.content.find(
    (item): item is { type: string; text?: string } =>
      Boolean(item) &&
      typeof item === "object" &&
      "type" in item &&
      typeof item.type === "string"
  );
  if (!entry?.text) {
    throw new Error("Expected text content.");
  }

  return entry.text;
}

function readJsonContent<T>(result: unknown): T {
  return JSON.parse(readTextContent(result)) as T;
}

async function connectClient(rootPath: string) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "wraithwalker-bounded-read-dogfood-client",
    version: "1.0.0"
  });

  const serverPromise = startServer(rootPath, { transport: serverTransport });
  await client.connect(clientTransport);
  const server = await serverPromise;

  return { client, server };
}

describe("bounded MCP read dogfood", () => {
  // Agent workflow under test: discover captures, semantic-search JS, read bounded
  // pages, page deeper on demand, use line snippets, and inspect API bodies safely.
  it("lets an agent inspect large captured files without unbounded read output", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-bounded-dogfood-"
    });
    const topOrigin = "https://dogfood.example.com";
    const largeJsPath = "cdn.dogfood.example.com/assets/app-huge.js";
    const smallJsPath = "cdn.dogfood.example.com/assets/small.js";
    const binaryPath = "cdn.dogfood.example.com/assets/font.woff2";
    const largeApiBody = JSON.stringify({
      marker: "DOGFOOD_API_START",
      payload: "r".repeat(90_000),
      tail: "DOGFOOD_API_TAIL"
    });
    const largeJsLines = [
      "import { smallFlag } from './small.js';",
      "const apiEndpoint = '/api/settings/dogfood';",
      "const selector = '#settings-panel';",
      "export function bootDogfood(){ return smallFlag; }",
      ...Array.from(
        { length: 900 },
        (_, index) => `const filler${index} = "${"x".repeat(80)}";`
      ),
      "function openSettingsPanel(){",
      "  document.querySelector(selector);",
      "  return fetch(apiEndpoint).then((response) => response.json());",
      "}",
      "const DOGFOOD_TAIL_MARKER = true;",
      "//# sourceMappingURL=app-huge.js.map"
    ];
    const largeJs = largeJsLines.join("\n");
    const targetLine =
      largeJsLines.findIndex((line) => line.includes("openSettingsPanel")) + 1;

    const manifest: StaticResourceManifest = {
      schemaVersion: 1,
      topOrigin,
      topOriginKey: "https__dogfood.example.com",
      generatedAt: "2026-04-27T00:00:00.000Z",
      resourcesByPathname: {
        "/assets/app-huge.js": [
          {
            requestUrl: `https://${largeJsPath}`,
            requestOrigin: "https://cdn.dogfood.example.com",
            pathname: "/assets/app-huge.js",
            search: "",
            bodyPath: largeJsPath,
            requestPath:
              ".wraithwalker/captures/assets/https__dogfood.example.com/cdn.dogfood.example.com/assets/app-huge.js.__request.json",
            metaPath:
              ".wraithwalker/captures/assets/https__dogfood.example.com/cdn.dogfood.example.com/assets/app-huge.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-27T00:00:00.000Z"
          }
        ],
        "/assets/small.js": [
          {
            requestUrl: `https://${smallJsPath}`,
            requestOrigin: "https://cdn.dogfood.example.com",
            pathname: "/assets/small.js",
            search: "",
            bodyPath: smallJsPath,
            requestPath:
              ".wraithwalker/captures/assets/https__dogfood.example.com/cdn.dogfood.example.com/assets/small.js.__request.json",
            metaPath:
              ".wraithwalker/captures/assets/https__dogfood.example.com/cdn.dogfood.example.com/assets/small.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-27T00:00:00.000Z"
          }
        ],
        "/assets/font.woff2": [
          {
            requestUrl: `https://${binaryPath}`,
            requestOrigin: "https://cdn.dogfood.example.com",
            pathname: "/assets/font.woff2",
            search: "",
            bodyPath: binaryPath,
            requestPath:
              ".wraithwalker/captures/assets/https__dogfood.example.com/cdn.dogfood.example.com/assets/font.woff2.__request.json",
            metaPath:
              ".wraithwalker/captures/assets/https__dogfood.example.com/cdn.dogfood.example.com/assets/font.woff2.__response.json",
            mimeType: "font/woff2",
            resourceType: "Font",
            capturedAt: "2026-04-27T00:00:00.000Z"
          }
        ]
      }
    };

    await root.writeManifest({ topOrigin, manifest });
    await root.writeText(largeJsPath, largeJs);
    await root.writeText(smallJsPath, "export const smallFlag = true;\n");
    await fs.mkdir(path.dirname(root.resolve(binaryPath)), { recursive: true });
    await fs.writeFile(root.resolve(binaryPath), Buffer.from([0, 1, 2, 3]));
    const apiFixture = await root.writeApiFixture({
      topOrigin,
      requestOrigin: "https://api.dogfood.example.com",
      method: "GET",
      fixtureName: "settings__q-agent__b-read",
      meta: {
        status: 200,
        statusText: "OK",
        mimeType: "application/json",
        resourceType: "Fetch",
        url: "https://api.dogfood.example.com/api/settings/dogfood",
        method: "GET",
        capturedAt: "2026-04-27T00:00:00.000Z"
      },
      body: largeApiBody
    });

    const { client, server } = await connectClient(root.rootPath);

    try {
      const sites = readJsonContent<Array<{ origin: string }>>(
        await client.callTool({ name: "list-sites", arguments: {} })
      );
      expect(sites).toEqual([
        expect.objectContaining({ origin: "https://dogfood.example.com" })
      ]);

      const files = readJsonContent<{
        items: Array<{ path: string; bodySize: number | null }>;
      }>(
        await client.callTool({
          name: "list-files",
          arguments: { origin: topOrigin, pathnameContains: "app-huge" }
        })
      );
      expect(files.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: largeJsPath,
            bodySize: Buffer.byteLength(largeJs, "utf8")
          })
        ])
      );

      const jsSearch = readJsonContent<{
        items: Array<{ path: string; value: string }>;
      }>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "/api/settings/dogfood",
            kind: "endpoint",
            pathContains: "app-huge"
          }
        })
      );
      expect(jsSearch.items).toEqual([
        expect.objectContaining({
          path: largeJsPath,
          value: "/api/settings/dogfood"
        })
      ]);

      const firstPage = readJsonContent<FixtureReadPageShape>(
        await client.callTool({
          name: "read-file",
          arguments: { path: largeJsPath }
        })
      );
      expect(firstPage).toEqual(
        expect.objectContaining({
          path: largeJsPath,
          sizeBytes: Buffer.byteLength(largeJs, "utf8"),
          startByte: 0,
          bytesReturned: 32_768,
          maxBytes: 32_768,
          truncated: true
        })
      );
      expect(Buffer.byteLength(firstPage.text, "utf8")).toBeLessThanOrEqual(
        32_768
      );
      expect(firstPage.nextCursor).not.toBeNull();
      expect(firstPage.text).not.toContain("DOGFOOD_TAIL_MARKER");

      const secondPage = readJsonContent<FixtureReadPageShape>(
        await client.callTool({
          name: "read-file",
          arguments: {
            path: largeJsPath,
            cursor: firstPage.nextCursor,
            maxBytes: 128
          }
        })
      );
      expect(secondPage).toEqual(
        expect.objectContaining({
          path: largeJsPath,
          startByte: firstPage.bytesReturned,
          bytesReturned: 128,
          maxBytes: 128,
          truncated: true
        })
      );

      const snippet = readJsonContent<{
        startLine: number;
        endLine: number;
        text: string;
      }>(
        await client.callTool({
          name: "read-file-snippet",
          arguments: {
            path: largeJsPath,
            startLine: targetLine,
            lineCount: 4
          }
        })
      );
      expect(snippet).toEqual(
        expect.objectContaining({
          path: largeJsPath,
          startLine: targetLine,
          endLine: targetLine + 3,
          truncated: false,
          text: [
            "function openSettingsPanel(){",
            "  document.querySelector(selector);",
            "  return fetch(apiEndpoint).then((response) => response.json());",
            "}"
          ].join("\n")
        })
      );

      const apiResponse = readJsonContent<{
        body: FixtureReadPageShape | null;
      }>(
        await client.callTool({
          name: "read-api-response",
          arguments: { fixtureDir: apiFixture.fixtureDir }
        })
      );
      expect(apiResponse.body).toEqual(
        expect.objectContaining({
          path: apiFixture.bodyPath,
          sizeBytes: Buffer.byteLength(largeApiBody, "utf8"),
          bytesReturned: 32_768,
          maxBytes: 32_768,
          truncated: true,
          nextCursor: expect.any(String)
        })
      );
      expect(apiResponse.body?.text).toContain("DOGFOOD_API_START");
      expect(apiResponse.body?.text).not.toContain("DOGFOOD_API_TAIL");

      const smallFile = readJsonContent<FixtureReadPageShape>(
        await client.callTool({
          name: "read-file",
          arguments: { path: smallJsPath }
        })
      );
      expect(smallFile).toEqual(
        expect.objectContaining({
          path: smallJsPath,
          truncated: false,
          nextCursor: null,
          text: "export const smallFlag = true;\n"
        })
      );

      const invalidReadCursor = await client.callTool({
        name: "read-file",
        arguments: { path: smallJsPath, cursor: "not-a-cursor" }
      });
      expect(invalidReadCursor.isError).toBe(true);
      expect(readTextContent(invalidReadCursor)).toContain(
        "Invalid read cursor"
      );

      const invalidApiCursor = await client.callTool({
        name: "read-api-response",
        arguments: { fixtureDir: apiFixture.fixtureDir, cursor: "bad-cursor" }
      });
      expect(invalidApiCursor.isError).toBe(true);
      expect(readTextContent(invalidApiCursor)).toContain(
        "Invalid read cursor"
      );

      const binaryRead = await client.callTool({
        name: "read-file",
        arguments: { path: binaryPath }
      });
      expect(binaryRead.isError).toBe(true);
      expect(readTextContent(binaryRead)).toContain(
        "Fixture is not a text file"
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});
