import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  readFixtureBody,
  readOriginInfo,
  readSiteConfigs,
  type SiteConfigLike,
  type StaticResourceManifest
} from "../src/fixtures.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

describe("fixture readers", () => {
  it("reads origin info with a simple-mode manifest", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-fixtures-"
    });
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

    await root.writeManifest({
      mode: "simple",
      topOrigin: "https://app.example.com",
      manifest
    });

    const info = await readOriginInfo(root.rootPath, {
      origin: "https://app.example.com",
      mode: "simple"
    });

    expect(info.origin).toBe("https://app.example.com");
    expect(info.manifest?.resourcesByPathname["/app.js"]).toHaveLength(1);
  });

  it("reads simple-mode API endpoints without a manifest and falls back to fixture names", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-fixtures-"
    });
    await root.writeApiFixture({
      mode: "simple",
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta: {
        status: 204,
        statusText: "No Content",
        mimeType: "application/json",
        resourceType: "XHR",
        method: "GET",
        capturedAt: "2026-04-03T00:00:00.000Z"
      }
    });

    const info = await readOriginInfo(root.rootPath, {
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
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-fixtures-"
    });
    await root.writeApiFixture({
      mode: "advanced",
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
      }
    });

    const config: SiteConfigLike = { origin: "https://app.example.com", mode: "advanced" };
    const info = await readOriginInfo(root.rootPath, config);

    expect(info.apiEndpoints).toHaveLength(1);
    expect(info.apiEndpoints[0].pathname).toBe("/users");
  });

  it("reads fixture bodies and returns null for missing ones", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-fixtures-"
    });
    await root.writeText("cdn.example.com/assets/app.js", "console.log('hello');");

    expect(await readFixtureBody(root.rootPath, "cdn.example.com/assets/app.js")).toBe("console.log('hello');");
    expect(await readFixtureBody(root.rootPath, "missing.js")).toBeNull();
  });

  it("discovers site configs from simple and advanced fixture trees", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-fixtures-"
    });
    await root.ensureOrigin({ mode: "simple", topOrigin: "http://localhost:4173" });
    await root.ensureOrigin({ mode: "advanced", topOrigin: "https://api.example.com:8443" });

    const configs = await readSiteConfigs(root.rootPath);
    const origins = configs.map((config) => config.origin).sort();

    expect(origins).toContain("http://localhost:4173");
    expect(origins).toContain("https://api.example.com:8443");
  });

  it("returns no site configs when the root path does not exist", async () => {
    const missingRoot = path.join(os.tmpdir(), `wraithwalker-core-fixtures-missing-${Date.now()}`);
    await expect(readSiteConfigs(missingRoot)).resolves.toEqual([]);
  });
});
