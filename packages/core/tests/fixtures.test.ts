import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  readFixtureBody,
  readOriginInfo,
  readSiteConfigs,
  type SiteConfigLike,
  type StaticResourceManifest
} from "../src/fixtures.mts";
import { createRoot } from "../src/root.mts";

async function createFixtureRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-core-fixtures-"));
  await createRoot(rootPath);
  return rootPath;
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

describe("fixture readers", () => {
  it("reads origin info with a simple-mode manifest", async () => {
    const rootPath = await createFixtureRoot();
    const manifest: StaticResourceManifest = {
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
    };

    await writeJson(
      path.join(rootPath, ".wraithwalker", "simple", "https__app.example.com", "RESOURCE_MANIFEST.json"),
      manifest
    );

    const info = await readOriginInfo(rootPath, {
      origin: "https://app.example.com",
      mode: "simple"
    });

    expect(info.origin).toBe("https://app.example.com");
    expect(info.manifest?.resourcesByPathname["/app.js"]).toHaveLength(1);
  });

  it("reads simple-mode API endpoints without a manifest and falls back to fixture names", async () => {
    const rootPath = await createFixtureRoot();
    await writeJson(
      path.join(
        rootPath,
        ".wraithwalker",
        "simple",
        "https__app.example.com",
        "origins",
        "https__api.example.com",
        "http",
        "GET",
        "users__q-abc__b-def",
        "response.meta.json"
      ),
      {
        status: 204,
        statusText: "No Content",
        mimeType: "application/json",
        resourceType: "XHR",
        method: "GET",
        capturedAt: "2026-04-03T00:00:00.000Z"
      }
    );

    const info = await readOriginInfo(rootPath, {
      origin: "https://app.example.com",
      mode: "simple"
    });

    expect(info.manifestPath).toBeNull();
    expect(info.apiEndpoints).toEqual([
      expect.objectContaining({
        method: "GET",
        pathname: "users",
        status: 204,
        fixtureDir: ".wraithwalker/simple/https__app.example.com/origins/https__api.example.com/http/GET/users__q-abc__b-def"
      })
    ]);
  });

  it("reads API endpoint metadata from advanced-mode fixtures", async () => {
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

    const config: SiteConfigLike = { origin: "https://app.example.com", mode: "advanced" };
    const info = await readOriginInfo(rootPath, config);

    expect(info.apiEndpoints).toHaveLength(1);
    expect(info.apiEndpoints[0].pathname).toBe("/users");
  });

  it("reads fixture bodies and returns null for missing ones", async () => {
    const rootPath = await createFixtureRoot();
    const fixturePath = path.join(rootPath, "cdn.example.com", "assets", "app.js");
    await fs.mkdir(path.dirname(fixturePath), { recursive: true });
    await fs.writeFile(fixturePath, "console.log('hello');", "utf8");

    expect(await readFixtureBody(rootPath, "cdn.example.com/assets/app.js")).toBe("console.log('hello');");
    expect(await readFixtureBody(rootPath, "missing.js")).toBeNull();
  });

  it("discovers site configs from simple and advanced fixture trees", async () => {
    const rootPath = await createFixtureRoot();
    await fs.mkdir(path.join(rootPath, ".wraithwalker", "simple", "http__localhost__4173"), { recursive: true });
    await fs.mkdir(path.join(rootPath, "https__api.example.com__8443", "origins"), { recursive: true });

    const configs = await readSiteConfigs(rootPath);
    const origins = configs.map((config) => config.origin).sort();

    expect(origins).toContain("http://localhost:4173");
    expect(origins).toContain("https://api.example.com:8443");
  });

  it("returns no site configs when the root path does not exist", async () => {
    const missingRoot = path.join(os.tmpdir(), `wraithwalker-core-fixtures-missing-${Date.now()}`);
    await expect(readSiteConfigs(missingRoot)).resolves.toEqual([]);
  });
});
