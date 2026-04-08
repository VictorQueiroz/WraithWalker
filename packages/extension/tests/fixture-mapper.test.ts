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
      /^\.wraithwalker\/captures\/assets\/https__app\.example\.com\/cdn\.example\.com\/static\/app\.bundle\.js\.__q-/
    );
    expect(descriptor.requestPath).toMatch(/__request\.json$/);
    expect(descriptor.metaPath).toMatch(/__response\.json$/);
  });

  it("uses Chromium-style mirrored host paths for visible asset projection", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/chunk-a.js?v=123"
    });

    expect(descriptor.storageMode).toBe("asset");
    expect(descriptor.bodyPath).toMatch(
      /^\.wraithwalker\/captures\/assets\/https__app\.example\.com\/cdn\.example\.com\/assets\/chunk-a\.js\.__q-[a-z0-9]+\.__body$/
    );
    expect(descriptor.projectionPath).toBe("cdn.example.com/assets/chunk-a.js");
    expect(descriptor.requestPath).toMatch(
      /^\.wraithwalker\/captures\/assets\/https__app\.example\.com\/cdn\.example\.com\/assets\/chunk-a\.js\.__q-[a-z0-9]+\.__request\.json$/
    );
    expect(descriptor.metaPath).toMatch(
      /^\.wraithwalker\/captures\/assets\/https__app\.example\.com\/cdn\.example\.com\/assets\/chunk-a\.js\.__q-[a-z0-9]+\.__response\.json$/
    );
    expect(descriptor.manifestPath).toBe(".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json");
    expect(descriptor.metadataOptional).toBe(false);
  });

  it("keeps the visible asset path stable while making simple-mode sidecars query-aware", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/a.js?prop1=&prop2=B"
    });

    expect(descriptor.bodyPath).toMatch(
      /^\.wraithwalker\/captures\/assets\/https__app\.example\.com\/cdn\.example\.com\/assets\/a\.js\.__q-[a-z0-9]+\.__body$/
    );
    expect(descriptor.projectionPath).toBe("cdn.example.com/assets/a.js");
    expect(descriptor.requestPath).toMatch(
      /^\.wraithwalker\/captures\/assets\/https__app\.example\.com\/cdn\.example\.com\/assets\/a\.js\.__q-[a-z0-9]+\.__request\.json$/
    );
    expect(descriptor.metaPath).toMatch(
      /^\.wraithwalker\/captures\/assets\/https__app\.example\.com\/cdn\.example\.com\/assets\/a\.js\.__q-[a-z0-9]+\.__response\.json$/
    );
  });

  it("appends non-default ports to projected host keys", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "http://localhost:4173/assets/app.js"
    });

    expect(descriptor.bodyPath).toBe(
      ".wraithwalker/captures/assets/https__app.example.com/localhost__4173/assets/app.js.__body"
    );
    expect(descriptor.projectionPath).toBe("localhost__4173/assets/app.js");
  });

  it("keeps the original filename when an asset-like request has no query string", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/app.bundle.js",
      resourceType: "Script"
    });

    expect(descriptor.bodyPath.endsWith("/app.bundle.js.__body")).toBe(true);
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
    expect(descriptor.bodyPath.endsWith("/index.__body")).toBe(true);
  });

  it("uses index for projected paths ending in a slash", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/"
    });

    expect(descriptor.bodyPath).toBe(
      ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/index.__body"
    );
    expect(descriptor.projectionPath).toBe("cdn.example.com/assets/index");
  });

  it("routes typed GET json requests through API storage", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://api.example.com/agents",
      mimeType: "application/json"
    });

    expect(descriptor.storageMode).toBe("api");
    expect(descriptor.bodyPath).toMatch(
      /^\.wraithwalker\/captures\/http\/https__app\.example\.com\/origins\/https__api\.example\.com\/http\/GET\/agents__q-/
    );
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
      /^\.wraithwalker\/captures\/http\/https__app\.example\.com\/origins\/https__api\.example\.com\/http\/POST\/graphql__q-/
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

  it("routes GET stylesheet requests through the canonical asset tree", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/style.css",
      resourceType: "Stylesheet"
    });

    expect(descriptor.storageMode).toBe("asset");
    expect(descriptor.bodyPath).toBe(
      ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/static/style.css.__body"
    );
    expect(descriptor.projectionPath).toBe("cdn.example.com/static/style.css");
    expect(descriptor.metadataOptional).toBe(false);
  });

  it("routes POST requests through the shared API pipeline", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/graphql",
      postData: '{"query":"{viewer{id}}"}'
    }) as ApiFixtureDescriptor;

    expect(descriptor.storageMode).toBe("api");
    expect(descriptor.directory).toMatch(
      /^\.wraithwalker\/captures\/http\/https__app\.example\.com\/origins\/https__api\.example\.com\/http\/POST\//
    );
    expect(descriptor.bodyPath).toMatch(/response\.body$/);
    expect(descriptor.manifestPath).toBeNull();
  });

  it("routes non-GET requests through the API pipeline", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "PUT",
      url: "https://cdn.example.com/upload/image.png"
    }) as ApiFixtureDescriptor;

    expect(descriptor.storageMode).toBe("api");
    expect(descriptor.directory).toMatch(
      /^\.wraithwalker\/captures\/http\/https__app\.example\.com\/origins\/https__cdn\.example\.com\/http\/PUT\//
    );
    expect(descriptor.bodyPath).toMatch(/response\.body$/);
    expect(descriptor.manifestPath).toBeNull();
  });

  it("API requests have no manifest path", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/graphql",
      postData: '{"query":"{viewer{id}}"}'
    }) as ApiFixtureDescriptor;

    expect(descriptor.storageMode).toBe("api");
    expect(descriptor.directory).toMatch(
      /^\.wraithwalker\/captures\/http\/https__app\.example\.com\/origins\/https__api\.example\.com\/http\/POST\//
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
