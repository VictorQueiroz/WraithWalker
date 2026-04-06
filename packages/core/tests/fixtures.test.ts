import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  listAssets,
  readApiFixture,
  readFixtureBody,
  readFixtureSnippet,
  readOriginInfo,
  readSiteConfigs,
  resolveFixturePath,
  searchFixtureContent,
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
    expect(resolveFixturePath(root.rootPath, "cdn.example.com/assets/app.js")).toBe(root.resolve("cdn.example.com/assets/app.js"));
    expect(resolveFixturePath(root.rootPath, "../package.json")).toBeNull();
    expect(await readFixtureBody(root.rootPath, "../package.json")).toBeNull();
  });

  it("reads API fixtures by their listed directory", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-fixtures-"
    });
    const fixture = await root.writeApiFixture({
      mode: "advanced",
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      method: "POST",
      fixtureName: "orders__q-abc__b-def",
      meta: {
        status: 201,
        statusText: "Created",
        mimeType: "application/json",
        resourceType: "Fetch",
        url: "https://api.example.com/orders",
        method: "POST",
        capturedAt: "2026-04-03T00:00:00.000Z"
      },
      body: "{\"created\":true}"
    });

    expect(await readApiFixture(root.rootPath, fixture.fixtureDir)).toEqual({
      fixtureDir: fixture.fixtureDir,
      metaPath: fixture.metaPath,
      bodyPath: fixture.bodyPath,
      meta: expect.objectContaining({
        status: 201,
        method: "POST",
        url: "https://api.example.com/orders"
      }),
      body: "{\"created\":true}"
    });
    expect(await readApiFixture(root.rootPath, "../escape")).toBeNull();
  });

  it("lists static assets with filters and cursor pagination for simple and advanced roots", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-fixtures-"
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
          "/assets/app.css": [{
            requestUrl: "https://cdn.example.com/assets/app.css",
            requestOrigin: "https://cdn.example.com",
            pathname: "/assets/app.css",
            search: "",
            bodyPath: "cdn.example.com/assets/app.css",
            requestPath: ".wraithwalker/simple/https__app.example.com/cdn.example.com/app.css.__request.json",
            metaPath: ".wraithwalker/simple/https__app.example.com/cdn.example.com/app.css.__response.json",
            mimeType: "text/css",
            resourceType: "Stylesheet",
            capturedAt: "2026-04-05T00:00:00.000Z"
          }],
          "/assets/app.js": [{
            requestUrl: "https://cdn.example.com/assets/app.js",
            requestOrigin: "https://cdn.example.com",
            pathname: "/assets/app.js",
            search: "",
            bodyPath: "cdn.example.com/assets/app.js",
            requestPath: ".wraithwalker/simple/https__app.example.com/cdn.example.com/app.js.__request.json",
            metaPath: ".wraithwalker/simple/https__app.example.com/cdn.example.com/app.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-05T00:00:00.000Z"
          }],
          "/images/logo.svg": [{
            requestUrl: "https://images.example.com/logo.svg",
            requestOrigin: "https://images.example.com",
            pathname: "/images/logo.svg",
            search: "",
            bodyPath: "images.example.com/logo.svg",
            requestPath: ".wraithwalker/simple/https__app.example.com/images.example.com/logo.svg.__request.json",
            metaPath: ".wraithwalker/simple/https__app.example.com/images.example.com/logo.svg.__response.json",
            mimeType: "image/svg+xml",
            resourceType: "Image",
            capturedAt: "2026-04-05T00:00:00.000Z"
          }]
        }
      }
    });

    await root.writeManifest({
      mode: "advanced",
      topOrigin: "https://admin.example.com",
      manifest: {
        schemaVersion: 1,
        topOrigin: "https://admin.example.com",
        topOriginKey: "https__admin.example.com",
        generatedAt: "2026-04-05T00:00:00.000Z",
        resourcesByPathname: {
          "/panel.js": [{
            requestUrl: "https://cdn.example.com/panel.js",
            requestOrigin: "https://cdn.example.com",
            pathname: "/panel.js",
            search: "",
            bodyPath: "cdn.example.com/panel.js",
            requestPath: "https__admin.example.com/panel.js.__request.json",
            metaPath: "https__admin.example.com/panel.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-05T00:00:00.000Z"
          }]
        }
      }
    });

    const firstPage = await listAssets(root.rootPath, {
      origin: "https://app.example.com",
      mode: "simple"
    }, {
      limit: 2
    });
    expect(firstPage.totalMatched).toBe(3);
    expect(firstPage.items.map((item) => item.pathname)).toEqual([
      "/assets/app.css",
      "/assets/app.js"
    ]);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listAssets(root.rootPath, {
      origin: "https://app.example.com",
      mode: "simple"
    }, {
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined
    });
    expect(secondPage.totalMatched).toBe(3);
    expect(secondPage.items.map((item) => item.pathname)).toEqual([
      "/images/logo.svg"
    ]);
    expect(secondPage.nextCursor).toBeNull();

    const filtered = await listAssets(root.rootPath, {
      origin: "https://app.example.com",
      mode: "simple"
    }, {
      resourceTypes: ["Script"],
      mimeTypes: ["application/javascript"],
      pathnameContains: "app",
      requestOrigin: "https://cdn.example.com"
    });
    expect(filtered.items).toEqual([
      expect.objectContaining({
        pathname: "/assets/app.js",
        requestOrigin: "https://cdn.example.com"
      })
    ]);

    const advanced = await listAssets(root.rootPath, {
      origin: "https://admin.example.com",
      mode: "advanced"
    });
    expect(advanced.items).toEqual([
      expect.objectContaining({
        pathname: "/panel.js",
        bodyPath: "cdn.example.com/panel.js"
      })
    ]);
  });

  it("searches content across assets, endpoint bodies, and generic files while skipping metadata and binary files", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-fixtures-"
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
          "/assets/app.js": [{
            requestUrl: "https://cdn.example.com/assets/app.js",
            requestOrigin: "https://cdn.example.com",
            pathname: "/assets/app.js",
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
    await root.writeText("cdn.example.com/assets/app.js", "renderDropdown({ animated: true });");

    await root.writeApiFixture({
      mode: "simple",
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      method: "GET",
      fixtureName: "menu__q-abc__b-def",
      meta: {
        status: 200,
        statusText: "OK",
        mimeType: "application/json",
        resourceType: "Fetch",
        url: "https://api.example.com/menu",
        method: "GET",
        capturedAt: "2026-04-05T00:00:00.000Z"
      },
      body: "{\"dropdownTheme\":\"dark\"}"
    });

    await root.writeText("notes/ui-guidelines.txt", "Dropdown guidance lives here.");
    await root.writeText(".wraithwalker/cli.json", "{\"note\":\"metadata only dropdown\"}");
    await fs.mkdir(path.dirname(root.resolve("bin/blob.bin")), { recursive: true });
    await fs.writeFile(root.resolve("bin/blob.bin"), Buffer.from([0, 1, 2, 3]));

    const matches = await searchFixtureContent(root.rootPath, {
      query: "dropdown"
    });
    expect(matches.items.map((item) => item.sourceKind)).toEqual(["endpoint", "asset", "file"]);
    expect(matches.items.map((item) => item.path)).toEqual([
      ".wraithwalker/simple/https__app.example.com/origins/https__api.example.com/http/GET/menu__q-abc__b-def/response.body",
      "cdn.example.com/assets/app.js",
      "notes/ui-guidelines.txt"
    ]);

    const firstSearchPage = await searchFixtureContent(root.rootPath, {
      query: "dropdown",
      limit: 1
    });
    expect(firstSearchPage.totalMatched).toBe(3);
    expect(firstSearchPage.items).toHaveLength(1);
    expect(firstSearchPage.nextCursor).not.toBeNull();

    const secondSearchPage = await searchFixtureContent(root.rootPath, {
      query: "dropdown",
      limit: 1,
      cursor: firstSearchPage.nextCursor ?? undefined
    });
    expect(secondSearchPage.items).toHaveLength(1);
    expect(secondSearchPage.items[0].path).toBe("cdn.example.com/assets/app.js");

    const assetOnly = await searchFixtureContent(root.rootPath, {
      query: "dropdown",
      resourceTypes: ["Script"],
      mimeTypes: ["application/javascript"]
    });
    expect(assetOnly.items).toEqual([
      expect.objectContaining({
        sourceKind: "asset",
        path: "cdn.example.com/assets/app.js",
        pathname: "/assets/app.js"
      })
    ]);

    const endpointOnly = await searchFixtureContent(root.rootPath, {
      query: "dropdown",
      origin: "https://app.example.com",
      resourceTypes: ["Fetch"]
    });
    expect(endpointOnly.items).toEqual([
      expect.objectContaining({
        sourceKind: "endpoint",
        pathname: "/menu"
      })
    ]);

    const fileOnly = await searchFixtureContent(root.rootPath, {
      query: "dropdown",
      pathContains: "notes"
    });
    expect(fileOnly.items).toEqual([
      expect.objectContaining({
        sourceKind: "file",
        path: "notes/ui-guidelines.txt"
      })
    ]);

    const metadataOnly = await searchFixtureContent(root.rootPath, {
      query: "metadata only"
    });
    expect(metadataOnly.items).toEqual([]);
  });

  it("reads bounded fixture snippets and rejects invalid, missing, and binary files", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-fixtures-"
    });
    const lines = Array.from({ length: 200 }, (_, index) => `line-${index + 1}`).join("\n");
    await root.writeText("cdn.example.com/assets/app.js", lines);
    await fs.mkdir(path.dirname(root.resolve("bin/blob.bin")), { recursive: true });
    await fs.writeFile(root.resolve("bin/blob.bin"), Buffer.from([0, 1, 2, 3]));

    const snippet = await readFixtureSnippet(root.rootPath, "cdn.example.com/assets/app.js", {
      startLine: 120,
      lineCount: 3
    });
    expect(snippet).toEqual({
      path: "cdn.example.com/assets/app.js",
      startLine: 120,
      endLine: 122,
      truncated: false,
      text: "line-120\nline-121\nline-122"
    });

    const truncated = await readFixtureSnippet(root.rootPath, "cdn.example.com/assets/app.js", {
      startLine: 1,
      lineCount: 10,
      maxBytes: 12
    });
    expect(truncated.truncated).toBe(true);
    expect(Buffer.byteLength(truncated.text, "utf8")).toBeLessThanOrEqual(12);

    await expect(readFixtureSnippet(root.rootPath, "../escape")).rejects.toThrow("Invalid fixture path");
    await expect(readFixtureSnippet(root.rootPath, "missing.txt")).rejects.toThrow("File not found");
    await expect(readFixtureSnippet(root.rootPath, "bin/blob.bin")).rejects.toThrow("Fixture is not a text file");
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
