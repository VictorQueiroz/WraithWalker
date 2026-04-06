import { describe, expect, it } from "vitest";

import {
  appendHashToFileName,
  buildRequestPayload,
  buildResponseMeta,
  createFixtureDescriptor,
  createStaticResourceManifest,
  createStaticResourceManifestEntry,
  deriveExtensionFromMime,
  deriveMimeTypeFromPathname,
  FIXTURE_FILE_NAMES,
  getFileNameParts,
  getRequestHostKey,
  getStaticResourceManifestPath,
  isAssetLikeRequest,
  normalizeSiteInput,
  originToKey,
  originToPermissionPattern,
  replayResponseHeaders,
  sanitizeSegment,
  sanitizeResponseHeaders,
  sha256Hex,
  shortHash,
  SIMPLE_MODE_METADATA_DIR,
  SIMPLE_MODE_METADATA_TREE,
  splitPathSegments,
  splitSimpleModePath,
  STATIC_RESOURCE_MANIFEST_FILE,
  upsertStaticResourceManifest
} from "../src/fixture-layout.mts";

describe("fixture layout", () => {
  it("exports the expected simple-mode constants", () => {
    expect(SIMPLE_MODE_METADATA_DIR).toBe(".wraithwalker");
    expect(SIMPLE_MODE_METADATA_TREE).toBe("simple");
    expect(STATIC_RESOURCE_MANIFEST_FILE).toBe("RESOURCE_MANIFEST.json");
    expect(FIXTURE_FILE_NAMES).toEqual({
      API_REQUEST: "request.json",
      API_META: "response.meta.json"
    });
  });

  it("normalizes origins and permission patterns", () => {
    expect(normalizeSiteInput("app.example.com")).toBe("https://app.example.com");
    expect(normalizeSiteInput(" https://app.example.com/path?draft=1#section ")).toBe("https://app.example.com");
    expect(originToPermissionPattern("https://app.example.com")).toBe("https://app.example.com/*");
    expect(originToKey("https://api.example.com:8443")).toBe("https__api.example.com__8443");
    expect(sanitizeSegment(" /// ")).toBe("root");
    expect(() => normalizeSiteInput("   ")).toThrow("Origin is required.");
    expect(() => normalizeSiteInput("file:///tmp/test")).toThrow("Only http and https origins are supported.");
  });

  it("splits and hashes path fragments predictably", async () => {
    expect(splitPathSegments("/assets/Hello%20World/app.js")).toEqual(["assets", "Hello-World", "app.js"]);
    expect(splitSimpleModePath("/assets/")).toEqual(["assets", "index"]);
    expect(splitSimpleModePath("/assets/app.js")).toEqual(["assets", "app.js"]);
    expect(getRequestHostKey("http://cdn.example.com:80/app.js")).toBe("cdn.example.com");
    expect(getRequestHostKey("https://cdn.example.com/app.js")).toBe("cdn.example.com");
    expect(getRequestHostKey("https://cdn.example.com:443/app.js")).toBe("cdn.example.com");
    expect(getRequestHostKey("https://cdn.example.com:4443/app.js")).toBe("cdn.example.com__4443");
    expect(getFileNameParts("archive.tar.gz")).toEqual({ stem: "archive.tar", extension: "gz" });
    expect(getFileNameParts("LICENSE")).toEqual({ stem: "LICENSE", extension: "" });
    expect(appendHashToFileName("app.js", "__q-abc")).toBe("app__q-abc.js");
    expect(appendHashToFileName("app", "__q-abc")).toBe("app__q-abc");
    expect(await sha256Hex("abc")).toHaveLength(64);
    expect(await sha256Hex(new Uint8Array([1, 2, 3]))).toHaveLength(64);
    expect(await shortHash(new Uint8Array([1, 2, 3]).buffer, 8)).toHaveLength(8);
    expect(await shortHash("abc")).toHaveLength(12);
  });

  it("infers asset-like behavior and mime/extension fallbacks", () => {
    expect(isAssetLikeRequest({
      method: "GET",
      url: "https://cdn.example.com/app.js",
      mimeType: "application/javascript"
    })).toBe(true);
    expect(isAssetLikeRequest({
      method: "GET",
      url: "https://api.example.com/users",
      resourceType: "Fetch",
      mimeType: "application/json"
    })).toBe(false);
    expect(isAssetLikeRequest({
      method: "GET",
      url: "https://cdn.example.com/theme",
      resourceType: "Stylesheet"
    })).toBe(true);
    expect(isAssetLikeRequest({
      method: "POST",
      url: "https://cdn.example.com/app.js",
      mimeType: "application/javascript"
    })).toBe(false);

    expect(deriveExtensionFromMime("application/problem+json")).toBe("json");
    expect(deriveExtensionFromMime("application/soap+xml")).toBe("xml");
    expect(deriveExtensionFromMime("image/svg+xml")).toBe("svg");
    expect(deriveExtensionFromMime("audio/ogg")).toBe("ogg");
    expect(deriveExtensionFromMime("text/markdown")).toBe("markdown");
    expect(deriveExtensionFromMime("application/")).toBe("body");
    expect(deriveExtensionFromMime("")).toBe("body");
    expect(deriveExtensionFromMime("application/octet-stream")).toBe("body");
    expect(deriveMimeTypeFromPathname("/assets/app.css")).toBe("text/css");
    expect(deriveMimeTypeFromPathname("/assets/unknown.bin")).toBe("application/octet-stream");
  });

  it("creates descriptors for advanced assets, simple GET fixtures, and simple API fixtures", async () => {
    const advancedAsset = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/app.js?v=1",
      resourceType: "Script"
    });
    const advancedAssetWithoutQuery = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/logo",
      resourceType: "Image",
      mimeType: "image/png"
    });
    const advancedAssetRootPath = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/",
      resourceType: "Script"
    });
    const simpleGet = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/chunk.js?v=2",
      siteMode: "simple"
    });
    const simpleApi = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/graphql",
      postData: '{"query":"{viewer{id}}"}',
      siteMode: "simple"
    });
    const simpleApiRoot = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/",
      postData: "{}",
      siteMode: "simple"
    });

    expect(advancedAsset.bodyPath).toMatch(
      /^https__app\.example\.com\/origins\/https__cdn\.example\.com\/assets\/static\/app__q-/
    );
    expect(getStaticResourceManifestPath(advancedAsset)).toBe("https__app.example.com/RESOURCE_MANIFEST.json");
    expect(advancedAssetWithoutQuery.bodyPath).toBe(
      "https__app.example.com/origins/https__cdn.example.com/assets/static/logo"
    );
    expect(advancedAssetRootPath.bodyPath).toBe(
      "https__app.example.com/origins/https__cdn.example.com/assets/index"
    );

    expect(simpleGet.bodyPath).toBe("cdn.example.com/assets/chunk.js");
    expect(simpleGet.requestPath).toBe(
      ".wraithwalker/simple/https__app.example.com/cdn.example.com/assets/chunk.js.__request.json"
    );
    expect(simpleGet.metadataOptional).toBe(true);

    expect(simpleApi.storageMode).toBe("api");
    expect(simpleApi.bodyPath).toMatch(
      /^\.wraithwalker\/simple\/https__app\.example\.com\/origins\/https__api\.example\.com\/http\/POST\/graphql__q-/
    );
    expect(simpleApi.bodyPath.endsWith("/response.body")).toBe(true);
    expect(simpleApiRoot.bodyPath).toMatch(
      /^\.wraithwalker\/simple\/https__app\.example\.com\/origins\/https__api\.example\.com\/http\/POST\/root__q-/
    );
    expect(getStaticResourceManifestPath(simpleApi)).toBeNull();
  });

  it("builds stored request/response metadata and manifest entries", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/app.js?v=1",
      siteMode: "simple"
    });

    const request = buildRequestPayload({
      topOrigin: "https://app.example.com",
      url: "https://api.example.com/graphql",
      method: "POST",
      requestHeaders: [{ name: "Content-Type", value: "application/json" }],
      requestBody: '{"query":"{viewer{id}}"}',
      requestBodyEncoding: "utf8",
      descriptor: { bodyHash: "body123", queryHash: "query456" }
    }, "2026-04-06T00:00:00.000Z");
    const requestWithoutDescriptor = buildRequestPayload({
      topOrigin: "https://app.example.com",
      url: "https://api.example.com/health",
      method: "GET",
      requestHeaders: [],
      requestBody: "",
      requestBodyEncoding: "utf8",
      descriptor: null
    }, "2026-04-06T00:00:00.000Z");
    const response = buildResponseMeta({
      responseStatus: 201,
      responseStatusText: "Created",
      responseHeaders: [
        { name: "Content-Type", value: "application/json" },
        { name: "content-type", value: "text/plain" }
      ],
      mimeType: "application/json",
      resourceType: "Fetch",
      url: "https://api.example.com/graphql",
      method: "POST"
    }, "utf8", "2026-04-06T00:00:00.000Z");

    expect(request).toEqual({
      topOrigin: "https://app.example.com",
      url: "https://api.example.com/graphql",
      method: "POST",
      headers: [{ name: "Content-Type", value: "application/json" }],
      body: '{"query":"{viewer{id}}"}',
      bodyEncoding: "utf8",
      bodyHash: "body123",
      queryHash: "query456",
      capturedAt: "2026-04-06T00:00:00.000Z"
    });
    expect(requestWithoutDescriptor.bodyHash).toBe("");
    expect(requestWithoutDescriptor.queryHash).toBe("");
    expect(response).toEqual({
      status: 201,
      statusText: "Created",
      headers: [{ name: "Content-Type", value: "application/json" }],
      mimeType: "application/json",
      resourceType: "Fetch",
      url: "https://api.example.com/graphql",
      method: "POST",
      capturedAt: "2026-04-06T00:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "json"
    });

    const manifest = createStaticResourceManifest(descriptor as any);
    const advancedDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/app.js",
      resourceType: "Script"
    });
    const manifestEntry = createStaticResourceManifestEntry(descriptor as any, {
      status: 200,
      statusText: "OK",
      headers: [],
      mimeType: "application/javascript",
      resourceType: "Script",
      url: descriptor.requestUrl,
      method: "GET",
      capturedAt: "2026-04-06T00:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "js"
    });
    const advancedManifestEntry = createStaticResourceManifestEntry(advancedDescriptor as any, {
      status: 200,
      statusText: "OK",
      headers: [],
      mimeType: "application/javascript",
      resourceType: "Script",
      url: advancedDescriptor.requestUrl,
      method: "GET",
      capturedAt: "2026-04-06T00:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "js"
    });
    const customAdvancedManifestEntry = createStaticResourceManifestEntry({
      ...advancedDescriptor,
      bodyPath: "assets/static/app.js",
      requestPath: "assets/static/app.js.__request.json",
      metaPath: "assets/static/app.js.__response.json"
    } as any, {
      status: 200,
      statusText: "OK",
      headers: [],
      mimeType: "application/javascript",
      resourceType: "Script",
      url: advancedDescriptor.requestUrl,
      method: "GET",
      capturedAt: "2026-04-06T00:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "js"
    });
    const updatedManifest = upsertStaticResourceManifest(manifest, manifestEntry);

    expect(manifestEntry.pathname).toBe("/static/app.js");
    expect(manifestEntry.bodyPath).toBe("cdn.example.com/static/app.js");
    expect(advancedManifestEntry.bodyPath).toBe("origins/https__cdn.example.com/assets/static/app.js");
    expect(customAdvancedManifestEntry.bodyPath).toBe("assets/static/app.js");
    expect(getStaticResourceManifestPath({
      assetLike: true,
      topOriginKey: "https__app.example.com"
    })).toBe("https__app.example.com/RESOURCE_MANIFEST.json");
    expect(updatedManifest.resourcesByPathname["/static/app.js"]).toEqual([manifestEntry]);
  });

  it("sanitizes stored headers separately from replay headers", () => {
    const headers = [
      { name: "Content-Type", value: "application/json" },
      { name: "content-type", value: "text/plain" },
      { name: "Content-Length", value: "88" },
      { name: "Connection", value: "keep-alive" },
      { name: "Set-Cookie", value: "a=b" },
      { name: "set-cookie", value: "c=d" }
    ];

    expect(sanitizeResponseHeaders(headers)).toEqual([
      { name: "Content-Type", value: "application/json" },
      { name: "Content-Length", value: "88" },
      { name: "Connection", value: "keep-alive" },
      { name: "Set-Cookie", value: "a=b" },
      { name: "set-cookie", value: "c=d" }
    ]);
    expect(replayResponseHeaders(headers)).toEqual([
      { name: "Content-Type", value: "application/json" },
      { name: "Set-Cookie", value: "a=b" },
      { name: "set-cookie", value: "c=d" }
    ]);
  });
});
