import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import { listScenarios, readFixtureBody, readOriginInfo, readSiteConfigs, type SiteConfigLike, type StaticResourceManifest } from "../src/fixture-reader.mts";

async function createFixtureRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-mcp-"));
  await fs.mkdir(path.join(rootPath, ".wraithwalker"), { recursive: true });
  await fs.writeFile(
    path.join(rootPath, ".wraithwalker", "root.json"),
    JSON.stringify({ rootId: "root-mcp" }),
    "utf8"
  );
  return rootPath;
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

describe("fixture reader", () => {
  it("reads origin info with static asset manifest", async () => {
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

    const config: SiteConfigLike = { origin: "https://app.example.com", mode: "simple" };
    const info = await readOriginInfo(rootPath, config);

    expect(info.origin).toBe("https://app.example.com");
    expect(info.manifest).not.toBeNull();
    expect(info.manifest!.resourcesByPathname["/app.js"]).toHaveLength(1);
  });

  it("reads API endpoints from fixture directories", async () => {
    const rootPath = await createFixtureRoot();
    const meta = {
      status: 200,
      statusText: "OK",
      mimeType: "application/json",
      resourceType: "XHR",
      url: "https://api.example.com/users",
      method: "GET",
      capturedAt: "2026-04-03T00:00:00.000Z"
    };

    await writeJson(
      path.join(rootPath, "https__app.example.com", "origins", "https__api.example.com", "http", "GET", "users__q-abc__b-def", "response.meta.json"),
      meta
    );

    const config: SiteConfigLike = { origin: "https://app.example.com", mode: "advanced" };
    const info = await readOriginInfo(rootPath, config);

    expect(info.apiEndpoints).toHaveLength(1);
    expect(info.apiEndpoints[0].method).toBe("GET");
    expect(info.apiEndpoints[0].pathname).toBe("/users");
    expect(info.apiEndpoints[0].status).toBe(200);
  });

  it("reads fixture body content", async () => {
    const rootPath = await createFixtureRoot();
    const bodyPath = path.join(rootPath, "cdn.example.com", "assets", "app.js");
    await fs.mkdir(path.dirname(bodyPath), { recursive: true });
    await fs.writeFile(bodyPath, "console.log('hello');");

    const content = await readFixtureBody(rootPath, "cdn.example.com/assets/app.js");
    expect(content).toBe("console.log('hello');");
  });

  it("returns null for missing fixture files", async () => {
    const rootPath = await createFixtureRoot();
    const content = await readFixtureBody(rootPath, "nonexistent.js");
    expect(content).toBeNull();
  });

  it("lists saved scenarios", async () => {
    const rootPath = await createFixtureRoot();

    // No scenarios
    expect(await listScenarios(rootPath)).toEqual([]);

    // Create scenarios
    await fs.mkdir(path.join(rootPath, ".wraithwalker", "scenarios", "v1"), { recursive: true });
    await fs.mkdir(path.join(rootPath, ".wraithwalker", "scenarios", "v2"), { recursive: true });

    const scenarios = await listScenarios(rootPath);
    expect(scenarios.sort()).toEqual(["v1", "v2"]);
  });

  it("discovers site configs from the fixture directory structure", async () => {
    const rootPath = await createFixtureRoot();

    // Create simple mode origin
    await fs.mkdir(path.join(rootPath, ".wraithwalker", "simple", "https__app.example.com"), { recursive: true });

    // Create advanced mode origin
    await fs.mkdir(path.join(rootPath, "https__api.example.com", "origins"), { recursive: true });

    const configs = await readSiteConfigs(rootPath);
    expect(configs).toHaveLength(2);
    expect(configs.find((c) => c.mode === "simple")).toBeDefined();
    expect(configs.find((c) => c.mode === "advanced")).toBeDefined();
  });

  it("returns empty info for origin with no fixtures", async () => {
    const rootPath = await createFixtureRoot();
    const config: SiteConfigLike = { origin: "https://empty.example.com", mode: "advanced" };
    const info = await readOriginInfo(rootPath, config);

    expect(info.manifest).toBeNull();
    expect(info.apiEndpoints).toHaveLength(0);
    expect(info.manifestPath).toBeNull();
  });
});
