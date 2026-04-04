import { describe, expect, it } from "vitest";

import { createFixtureDescriptor, sanitizeResponseHeaders } from "../src/lib/fixture-mapper.js";
import { normalizeSiteInput, originToPermissionPattern } from "../src/lib/path-utils.js";
import type { ApiFixtureDescriptor } from "../src/lib/types.js";

describe("fixture mapper", () => {
  it("coerces a plain hostname to an https origin", () => {
    expect(normalizeSiteInput("app.example.com")).toBe("https://app.example.com");
    expect(originToPermissionPattern("https://app.example.com")).toBe("https://app.example.com/*");
  });

  it("mirrors asset-like GET requests into assets paths", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/app.bundle.js?v=123",
      resourceType: "Script"
    });

    expect(descriptor.storageMode).toBe("asset");
    expect(descriptor.bodyPath).toMatch(
      /^https__app\.example\.com\/origins\/https__cdn\.example\.com\/assets\/static\/app\.bundle__q-/
    );
    expect(descriptor.requestPath).toMatch(/__request\.json$/);
    expect(descriptor.metaPath).toMatch(/__response\.json$/);
  });

  it("uses Chromium-style mirrored host paths in simple mode", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/chunk-a.js?v=123",
      siteMode: "simple"
    });

    expect(descriptor.siteMode).toBe("simple");
    expect(descriptor.storageMode).toBe("asset");
    expect(descriptor.bodyPath).toBe("cdn.example.com/assets/chunk-a.js");
    expect(descriptor.requestPath).toBe(
      ".wraithwalker/simple/https__app.example.com/cdn.example.com/assets/chunk-a.js.__request.json"
    );
    expect(descriptor.metaPath).toBe(
      ".wraithwalker/simple/https__app.example.com/cdn.example.com/assets/chunk-a.js.__response.json"
    );
    expect(descriptor.manifestPath).toBe(".wraithwalker/simple/https__app.example.com/RESOURCE_MANIFEST.json");
    expect(descriptor.metadataOptional).toBe(true);
  });

  it("appends non-default ports to simple-mode host keys", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "http://localhost:4173/assets/app.js",
      siteMode: "simple"
    });

    expect(descriptor.bodyPath).toBe("localhost__4173/assets/app.js");
  });

  it("keeps the original filename when an asset-like request has no query string", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/app.bundle.js",
      resourceType: "Script"
    });

    expect(descriptor.bodyPath.endsWith("/app.bundle.js")).toBe(true);
    expect(descriptor.bodyPath.includes("__q-")).toBe(false);
  });

  it("falls back to index for asset-like requests without a filename", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/",
      resourceType: "Script"
    });

    expect(descriptor.slug).toBe("index");
    expect(descriptor.bodyPath.endsWith("/assets/index")).toBe(true);
  });

  it("uses index for simple-mode paths ending in a slash", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/",
      siteMode: "simple"
    });

    expect(descriptor.bodyPath).toBe("cdn.example.com/assets/index");
  });

  it("hashes query and request body for API requests", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/graphql?draft=true",
      postData: '{"query":"{viewer{id}}"}'
    }) as ApiFixtureDescriptor;

    expect(descriptor.storageMode).toBe("api");
    expect(descriptor.directory).toMatch(
      /^https__app\.example\.com\/origins\/https__api\.example\.com\/http\/POST\/graphql__q-/
    );
    expect(descriptor.directory).toMatch(/__b-/);
    expect(descriptor.bodyPath.endsWith("/response.body")).toBe(true);
  });

  it("uses the root slug fallback for API requests with no pathname", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com?draft=true",
      postData: '{"query":"{viewer{id}}"}'
    }) as ApiFixtureDescriptor;

    expect(descriptor.slug).toBe("root");
    expect(descriptor.directory).toMatch(/\/root__q-/);
  });

  it("routes simple-mode non-GET asset-like requests through the hidden metadata tree", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/style.css",
      resourceType: "Stylesheet",
      siteMode: "simple"
    });

    expect(descriptor.siteMode).toBe("simple");
    expect(descriptor.storageMode).toBe("asset");
    expect(descriptor.bodyPath).toBe("cdn.example.com/static/style.css");
    expect(descriptor.metadataOptional).toBe(true);
  });

  it("routes simple-mode POST requests through the shared API pipeline with metadata prefix", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/graphql",
      postData: '{"query":"{viewer{id}}"}',
      siteMode: "simple"
    }) as ApiFixtureDescriptor;

    expect(descriptor.siteMode).toBe("simple");
    expect(descriptor.storageMode).toBe("api");
    expect(descriptor.directory).toMatch(
      /^\.wraithwalker\/simple\/https__app\.example\.com\/origins\/https__api\.example\.com\/http\/POST\//
    );
    expect(descriptor.bodyPath).toMatch(/response\.body$/);
    expect(descriptor.manifestPath).toBeNull();
  });

  it("routes simple-mode non-GET requests through the API pipeline with metadata prefix", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "PUT",
      url: "https://cdn.example.com/upload/image.png",
      siteMode: "simple"
    }) as ApiFixtureDescriptor;

    expect(descriptor.siteMode).toBe("simple");
    expect(descriptor.storageMode).toBe("api");
    expect(descriptor.directory).toMatch(
      /^\.wraithwalker\/simple\/https__app\.example\.com\/origins\/https__cdn\.example\.com\/http\/PUT\//
    );
    expect(descriptor.bodyPath).toMatch(/response\.body$/);
    expect(descriptor.manifestPath).toBeNull();
  });

  it("uses advanced-mode paths for non-GET requests without metadata prefix", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "PUT",
      url: "https://cdn.example.com/upload/image.png",
      siteMode: "advanced"
    }) as ApiFixtureDescriptor;

    expect(descriptor.siteMode).toBe("advanced");
    expect(descriptor.storageMode).toBe("api");
    expect(descriptor.directory).toMatch(
      /^https__app\.example\.com\/origins\/https__cdn\.example\.com\/http\/PUT\//
    );
    expect(descriptor.manifestPath).toBeNull();
  });

  it("advanced-mode API requests have no manifest path", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/graphql",
      postData: '{"query":"{viewer{id}}"}',
      siteMode: "advanced"
    }) as ApiFixtureDescriptor;

    expect(descriptor.siteMode).toBe("advanced");
    expect(descriptor.storageMode).toBe("api");
    expect(descriptor.directory).toMatch(
      /^https__app\.example\.com\/origins\/https__api\.example\.com\/http\/POST\//
    );
    expect(descriptor.manifestPath).toBeNull();
  });

  it("deduplicates headers except for set-cookie", () => {
    const headers = sanitizeResponseHeaders([
      { name: "Content-Type", value: "application/json" },
      { name: "content-type", value: "text/plain" },
      { name: "Set-Cookie", value: "a=b" },
      { name: "set-cookie", value: "c=d" }
    ]);

    expect(headers).toEqual([
      { name: "Content-Type", value: "application/json" },
      { name: "Set-Cookie", value: "a=b" },
      { name: "set-cookie", value: "c=d" }
    ]);
  });
});
