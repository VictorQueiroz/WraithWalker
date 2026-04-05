import { describe, expect, it } from "vitest";

import {
  listScenarios,
  readApiFixture,
  readFixtureBody,
  readOriginInfo,
  readSiteConfigs,
  resolveFixturePath,
  type SiteConfigLike,
  type StaticResourceManifest
} from "../src/fixture-reader.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

describe("fixture reader", () => {
  it("reads origin info with static asset manifest", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-"
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

    const config: SiteConfigLike = { origin: "https://app.example.com", mode: "simple" };
    const info = await readOriginInfo(root.rootPath, config);

    expect(info.origin).toBe("https://app.example.com");
    expect(info.manifest).not.toBeNull();
    expect(info.manifest!.resourcesByPathname["/app.js"]).toHaveLength(1);
  });

  it("reads API endpoints from fixture directories", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-"
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
    expect(info.apiEndpoints[0].method).toBe("GET");
    expect(info.apiEndpoints[0].pathname).toBe("/users");
    expect(info.apiEndpoints[0].status).toBe(200);
  });

  it("reads fixture body content", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-"
    });
    await root.writeText("cdn.example.com/assets/app.js", "console.log('hello');");

    const content = await readFixtureBody(root.rootPath, "cdn.example.com/assets/app.js");
    expect(content).toBe("console.log('hello');");
  });

  it("returns null for missing fixture files", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-"
    });
    const content = await readFixtureBody(root.rootPath, "nonexistent.js");
    expect(content).toBeNull();
    expect(resolveFixturePath(root.rootPath, "../package.json")).toBeNull();
  });

  it("reads an API fixture by its fixture directory", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-"
    });
    const fixture = await root.writeApiFixture({
      mode: "advanced",
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      method: "PUT",
      fixtureName: "profile__q-abc__b-def",
      meta: {
        status: 202,
        statusText: "Accepted",
        mimeType: "application/json",
        resourceType: "Fetch",
        url: "https://api.example.com/profile",
        method: "PUT",
        capturedAt: "2026-04-03T00:00:00.000Z"
      },
      body: "{\"queued\":true}"
    });

    expect(await readApiFixture(root.rootPath, fixture.fixtureDir)).toEqual(expect.objectContaining({
      fixtureDir: fixture.fixtureDir,
      body: "{\"queued\":true}",
      meta: expect.objectContaining({
        status: 202,
        method: "PUT"
      })
    }));
  });

  it("lists saved scenarios", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-"
    });

    expect(await listScenarios(root.rootPath)).toEqual([]);

    await root.ensureScenario("v1");
    await root.ensureScenario("v2");

    const scenarios = await listScenarios(root.rootPath);
    expect(scenarios.sort()).toEqual(["v1", "v2"]);
  });

  it("discovers site configs from the fixture directory structure", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-"
    });

    await root.ensureOrigin({ mode: "simple", topOrigin: "https://app.example.com" });
    await root.ensureOrigin({ mode: "advanced", topOrigin: "https://api.example.com" });

    const configs = await readSiteConfigs(root.rootPath);
    expect(configs).toHaveLength(2);
    expect(configs.find((c) => c.mode === "simple")).toBeDefined();
    expect(configs.find((c) => c.mode === "advanced")).toBeDefined();
  });

  it("discovers origins with non-standard ports", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-"
    });

    await root.ensureOrigin({ mode: "simple", topOrigin: "http://localhost:4173" });
    await root.ensureOrigin({ mode: "advanced", topOrigin: "https://api.example.com:8443" });

    const configs = await readSiteConfigs(root.rootPath);
    const origins = configs.map((c) => c.origin).sort();
    expect(origins).toContain("http://localhost:4173");
    expect(origins).toContain("https://api.example.com:8443");
  });

  it("returns empty info for origin with no fixtures", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-"
    });
    const config: SiteConfigLike = { origin: "https://empty.example.com", mode: "advanced" };
    const info = await readOriginInfo(root.rootPath, config);

    expect(info.manifest).toBeNull();
    expect(info.apiEndpoints).toHaveLength(0);
    expect(info.manifestPath).toBeNull();
  });
});
