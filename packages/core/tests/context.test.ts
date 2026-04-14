import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { generateContext, type FsGateway } from "../src/context.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

function createFsGateway(): FsGateway {
  return {
    async readText(rootPath, relativePath) {
      return fs.readFile(path.join(rootPath, relativePath), "utf8");
    },
    async writeText(rootPath, relativePath, content) {
      const absolute = path.join(rootPath, relativePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content, "utf8");
    }
  };
}

async function createFixtureRoot() {
  return createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-core-context-"
  });
}

describe("context generation", () => {
  it("writes context files and inferred types", async () => {
    const root = await createFixtureRoot();
    await root.writeApiFixture({
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
        capturedAt: "2026-04-03T00:00:00.000Z"
      },
      body: JSON.stringify({ users: [{ id: 1 }] })
    });

    const markdown = await generateContext(
      root.rootPath,
      createFsGateway(),
      "cursor"
    );

    expect(markdown).toContain("WraithWalker Fixture Context");
    expect(
      await fs.readFile(path.join(root.rootPath, "CLAUDE.md"), "utf8")
    ).toContain("GET");
    expect(
      await fs.readFile(path.join(root.rootPath, ".cursorrules"), "utf8")
    ).toContain("WraithWalker");
    expect(
      await fs.readFile(
        path.join(root.rootPath, ".wraithwalker", "types", "index.d.ts"),
        "utf8"
      )
    ).toContain("export *");
  });

  it("uses default context files and describes static-only or empty origins", async () => {
    const root = await createFixtureRoot();

    await root.writeManifest({
      topOrigin: "https://app.example.com",
      manifest: {
        schemaVersion: 1,
        topOrigin: "https://app.example.com",
        topOriginKey: "https__app.example.com",
        generatedAt: "2026-04-03T00:00:00.000Z",
        resourcesByPathname: {
          "/app.js": [
            {
              requestUrl: "https://cdn.example.com/app.js",
              requestOrigin: "https://cdn.example.com",
              pathname: "/app.js",
              search: "",
              bodyPath: "cdn.example.com/app.js",
              requestPath:
                ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/app.js.__request.json",
              metaPath:
                ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/app.js.__response.json",
              mimeType: "application/javascript",
              resourceType: "Script",
              capturedAt: "2026-04-03T00:00:00.000Z"
            }
          ]
        }
      }
    });
    await root.ensureOrigin({ topOrigin: "http://localhost:4173" });

    const markdown = await generateContext(root.rootPath, createFsGateway());

    expect(markdown).toContain("### Static Assets");
    expect(markdown).toContain("Script: 1");
    expect(markdown).toContain("No captured fixtures found for this origin.");
    expect(markdown).not.toContain("## Suggested Agent Tasks");
    expect(
      await fs.readFile(path.join(root.rootPath, "CLAUDE.md"), "utf8")
    ).toContain("Static Assets");
    await expect(
      fs.access(path.join(root.rootPath, ".cursorrules"))
    ).rejects.toThrow();
    await expect(
      fs.access(
        path.join(root.rootPath, ".wraithwalker", "types", "index.d.ts")
      )
    ).rejects.toThrow();
  });

  it("surfaces missing canonical bodies through the root runtime storage adapter", async () => {
    const rootRuntimeModuleId = "../src/root-runtime.mjs";

    vi.resetModules();
    vi.doMock(rootRuntimeModuleId, () => ({
      createWraithwalkerRootRuntime({
        root,
        storage
      }: {
        root: unknown;
        storage: {
          readBody(targetRoot: unknown, relativePath: string): Promise<unknown>;
        };
      }) {
        return {
          async generateContext() {
            await storage.readBody(root, "captures/missing/response.body");
            return "unreachable";
          }
        };
      }
    }));

    try {
      const { generateContext: generateContextWithMock } =
        await import("../src/context.mts?storage-adapter");
      const root = await createFixtureRoot();

      await expect(
        generateContextWithMock(root.rootPath, createFsGateway())
      ).rejects.toThrow(
        "Fixture body not found at captures/missing/response.body"
      );
    } finally {
      vi.doUnmock(rootRuntimeModuleId);
      vi.resetModules();
    }
  });
});
