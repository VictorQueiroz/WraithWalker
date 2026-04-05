import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import { generateContext, type FsGateway } from "../src/context.mts";
import { createRoot } from "../src/root.mts";

function createFsGateway(): FsGateway {
  return {
    async exists(rootPath, relativePath) {
      try {
        await fs.access(path.join(rootPath, relativePath));
        return true;
      } catch {
        return false;
      }
    },
    async readJson(rootPath, relativePath) {
      return JSON.parse(await fs.readFile(path.join(rootPath, relativePath), "utf8"));
    },
    async readOptionalJson(rootPath, relativePath) {
      try {
        return JSON.parse(await fs.readFile(path.join(rootPath, relativePath), "utf8"));
      } catch {
        return null;
      }
    },
    async readText(rootPath, relativePath) {
      return fs.readFile(path.join(rootPath, relativePath), "utf8");
    },
    async writeText(rootPath, relativePath, content) {
      const absolute = path.join(rootPath, relativePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content, "utf8");
    },
    async writeJson(rootPath, relativePath, value) {
      const absolute = path.join(rootPath, relativePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, JSON.stringify(value, null, 2), "utf8");
    },
    async listDirectory(rootPath, relativePath) {
      const dirPath = relativePath ? path.join(rootPath, relativePath) : rootPath;
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" as const : "file" as const
      }));
    }
  };
}

async function createFixtureRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-core-context-"));
  await createRoot(rootPath);
  return rootPath;
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

describe("context generation", () => {
  it("writes context files and inferred types", async () => {
    const rootPath = await createFixtureRoot();
    await writeJson(
      path.join(
        rootPath,
        "https__app.example.com",
        "origins",
        "https__api.example.com",
        "http",
        "GET",
        "users__q-abc__b-def",
        "response.meta.json"
      ),
      {
        status: 200,
        statusText: "OK",
        mimeType: "application/json",
        resourceType: "XHR",
        url: "https://api.example.com/users",
        method: "GET",
        capturedAt: "2026-04-03T00:00:00.000Z"
      }
    );
    await fs.writeFile(
      path.join(
        rootPath,
        "https__app.example.com",
        "origins",
        "https__api.example.com",
        "http",
        "GET",
        "users__q-abc__b-def",
        "response.body"
      ),
      JSON.stringify({ users: [{ id: 1 }] }),
      "utf8"
    );

    const markdown = await generateContext(rootPath, createFsGateway(), "cursor");

    expect(markdown).toContain("WraithWalker Fixture Context");
    expect(await fs.readFile(path.join(rootPath, "CLAUDE.md"), "utf8")).toContain("GET");
    expect(await fs.readFile(path.join(rootPath, ".cursorrules"), "utf8")).toContain("WraithWalker");
    expect(await fs.readFile(path.join(rootPath, ".wraithwalker", "types", "index.d.ts"), "utf8")).toContain("export *");
  });

  it("uses default context files and describes static-only or empty origins", async () => {
    const rootPath = await createFixtureRoot();

    await writeJson(
      path.join(rootPath, ".wraithwalker", "simple", "https__app.example.com", "RESOURCE_MANIFEST.json"),
      {
        schemaVersion: 1,
        topOrigin: "https://app.example.com",
        topOriginKey: "https__app.example.com",
        generatedAt: "2026-04-03T00:00:00.000Z",
        resourcesByPathname: {
          "/app.js": [{
            requestUrl: "https://cdn.example.com/app.js",
            requestOrigin: "https://cdn.example.com",
            pathname: "/app.js",
            search: "",
            bodyPath: "cdn.example.com/app.js",
            requestPath: ".wraithwalker/simple/https__app.example.com/cdn.example.com/app.js.__request.json",
            metaPath: ".wraithwalker/simple/https__app.example.com/cdn.example.com/app.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-03T00:00:00.000Z"
          }]
        }
      }
    );
    await fs.mkdir(path.join(rootPath, ".wraithwalker", "simple", "http__localhost__4173"), { recursive: true });

    const markdown = await generateContext(rootPath, createFsGateway());

    expect(markdown).toContain("### Static Assets");
    expect(markdown).toContain("Script: 1");
    expect(markdown).toContain("No captured fixtures found for this origin.");
    expect(markdown).not.toContain("## Suggested Agent Tasks");
    expect(await fs.readFile(path.join(rootPath, "CLAUDE.md"), "utf8")).toContain("Static Assets");
    await expect(fs.access(path.join(rootPath, ".cursorrules"))).rejects.toThrow();
    await expect(fs.access(path.join(rootPath, ".wraithwalker", "types", "index.d.ts"))).rejects.toThrow();
  });
});
