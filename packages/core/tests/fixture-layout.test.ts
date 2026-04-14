import { describe, expect, it } from "vitest";

import {
  appendHashToFileName,
  buildRequestPayload,
  buildResponseMeta,
  CAPTURE_ASSETS_DIR,
  CAPTURE_HTTP_DIR,
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
  MANIFESTS_DIR,
  normalizeSiteInput,
  originToKey,
  originToPermissionPattern,
  replayResponseHeaders,
  sanitizeSegment,
  sanitizeResponseHeaders,
  sha256Hex,
  shortHash,
  splitPathSegments,
  splitSimpleModePath,
  STATIC_RESOURCE_MANIFEST_FILE,
  upsertStaticResourceManifest
} from "../src/fixture-layout.mts";

describe("fixture layout", () => {
  it("exports the expected canonical capture constants", () => {
    expect(CAPTURE_ASSETS_DIR).toBe(".wraithwalker/captures/assets");
    expect(CAPTURE_HTTP_DIR).toBe(".wraithwalker/captures/http");
    expect(MANIFESTS_DIR).toBe(".wraithwalker/manifests");
    expect(STATIC_RESOURCE_MANIFEST_FILE).toBe("RESOURCE_MANIFEST.json");
    expect(FIXTURE_FILE_NAMES).toEqual({
      API_REQUEST: "request.json",
      API_META: "response.meta.json"
    });
  });

  it("normalizes origins and permission patterns", () => {
    expect(normalizeSiteInput("app.example.com")).toBe(
      "https://app.example.com"
    );
    expect(
      normalizeSiteInput(" https://app.example.com/path?draft=1#section ")
    ).toBe("https://app.example.com");
    expect(originToPermissionPattern("https://app.example.com")).toBe(
      "https://app.example.com/*"
    );
    expect(originToKey("https://api.example.com:8443")).toBe(
      "https__api.example.com__8443"
    );
    expect(sanitizeSegment(" /// ")).toBe("root");
    expect(() => normalizeSiteInput("   ")).toThrow("Origin is required.");
    expect(() => normalizeSiteInput("file:///tmp/test")).toThrow(
      "Only http and https origins are supported."
    );
  });

  it("splits and hashes path fragments predictably", async () => {
    expect(splitPathSegments("/assets/Hello%20World/app.js")).toEqual([
      "assets",
      "Hello-World",
      "app.js"
    ]);
    expect(splitSimpleModePath("/assets/")).toEqual(["assets", "index"]);
    expect(splitSimpleModePath("/assets/app.js")).toEqual(["assets", "app.js"]);
    expect(getRequestHostKey("http://cdn.example.com:80/app.js")).toBe(
      "cdn.example.com"
    );
    expect(getRequestHostKey("https://cdn.example.com/app.js")).toBe(
      "cdn.example.com"
    );
    expect(getRequestHostKey("https://cdn.example.com:443/app.js")).toBe(
      "cdn.example.com"
    );
    expect(getRequestHostKey("https://cdn.example.com:4443/app.js")).toBe(
      "cdn.example.com__4443"
    );
    expect(getFileNameParts("archive.tar.gz")).toEqual({
      stem: "archive.tar",
      extension: "gz"
    });
    expect(getFileNameParts("LICENSE")).toEqual({
      stem: "LICENSE",
      extension: ""
    });
    expect(appendHashToFileName("app.js", "__q-abc")).toBe("app__q-abc.js");
    expect(appendHashToFileName("app", "__q-abc")).toBe("app__q-abc");
    expect(await sha256Hex("abc")).toHaveLength(64);
    expect(await sha256Hex(new Uint8Array([1, 2, 3]))).toHaveLength(64);
    expect(await shortHash(new Uint8Array([1, 2, 3]).buffer, 8)).toHaveLength(
      8
    );
    expect(await shortHash("abc")).toHaveLength(12);
  });

  it("infers asset-like behavior and mime/extension fallbacks", () => {
    expect(
      isAssetLikeRequest({
        method: "GET",
        url: "https://cdn.example.com/app.js",
        mimeType: "application/javascript"
      })
    ).toBe(true);
    expect(
      isAssetLikeRequest({
        method: "GET",
        url: "https://api.example.com/users",
        resourceType: "Fetch",
        mimeType: "application/json"
      })
    ).toBe(false);
    expect(
      isAssetLikeRequest({
        method: "GET",
        url: "https://cdn.example.com/theme",
        resourceType: "Stylesheet"
      })
    ).toBe(true);
    expect(
      isAssetLikeRequest({
        method: "POST",
        url: "https://cdn.example.com/app.js",
        mimeType: "application/javascript"
      })
    ).toBe(false);

    expect(deriveExtensionFromMime("application/problem+json")).toBe("json");
    expect(deriveExtensionFromMime("application/soap+xml")).toBe("xml");
    expect(deriveExtensionFromMime("image/svg+xml")).toBe("svg");
    expect(deriveExtensionFromMime("audio/ogg")).toBe("ogg");
    expect(deriveExtensionFromMime("text/markdown")).toBe("markdown");
    expect(deriveExtensionFromMime("application/")).toBe("body");
    expect(deriveExtensionFromMime("")).toBe("body");
    expect(deriveExtensionFromMime("application/octet-stream")).toBe("body");
    expect(deriveMimeTypeFromPathname("/assets/app.css")).toBe("text/css");
    expect(deriveMimeTypeFromPathname("/assets/unknown.bin")).toBe(
      "application/octet-stream"
    );
  });

  it("creates canonical descriptors for assets and API fixtures", async () => {
    const assetWithQuery = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/app.js?v=1",
      resourceType: "Script"
    });
    const assetWithoutQuery = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/logo",
      resourceType: "Image",
      mimeType: "image/png"
    });
    const assetRootPath = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/",
      resourceType: "Script"
    });
    const visibleGet = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/chunk.js?v=2"
    });
    const untypedTrailingSlash = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/"
    });
    const getApi = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://api.example.com/agents",
      mimeType: "application/json"
    });
    const postApi = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/graphql",
      postData: '{"query":"{viewer{id}}"}'
    });
    const postApiRoot = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/",
      postData: "{}"
    });

    expect(assetWithQuery.bodyPath).toMatch(
      /^\.wraithwalker\/captures\/assets\/https__app\.example\.com\/cdn\.example\.com\/static\/app\.js\.__q-/
    );
    expect(getStaticResourceManifestPath(assetWithQuery)).toBe(
      ".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json"
    );
    expect(assetWithoutQuery.bodyPath).toBe(
      ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/static/logo.__body"
    );
    expect(assetRootPath.bodyPath).toBe(
      ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/index.__body"
    );

    expect(visibleGet.bodyPath).toMatch(
      /^\.wraithwalker\/captures\/assets\/https__app\.example\.com\/cdn\.example\.com\/assets\/chunk\.js\.__q-[a-z0-9]+\.__body$/
    );
    expect(visibleGet.projectionPath).toBe("cdn.example.com/assets/chunk.js");
    expect(visibleGet.requestPath).toMatch(
      /^\.wraithwalker\/captures\/assets\/https__app\.example\.com\/cdn\.example\.com\/assets\/chunk\.js\.__q-[a-z0-9]+\.__request\.json$/
    );
    expect(visibleGet.metadataOptional).toBe(false);
    expect(untypedTrailingSlash.storageMode).toBe("asset");
    expect(untypedTrailingSlash.bodyPath).toBe(
      ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/assets/index.__body"
    );
    expect(untypedTrailingSlash.projectionPath).toBe(
      "cdn.example.com/assets/index"
    );
    expect(getApi.storageMode).toBe("api");
    expect(getApi.bodyPath).toMatch(
      /^\.wraithwalker\/captures\/http\/https__app\.example\.com\/origins\/https__api\.example\.com\/http\/GET\/agents__q-/
    );

    expect(postApi.storageMode).toBe("api");
    expect(postApi.bodyPath).toMatch(
      /^\.wraithwalker\/captures\/http\/https__app\.example\.com\/origins\/https__api\.example\.com\/http\/POST\/graphql__q-/
    );
    expect(postApi.bodyPath.endsWith("/response.body")).toBe(true);
    expect(postApiRoot.bodyPath).toMatch(
      /^\.wraithwalker\/captures\/http\/https__app\.example\.com\/origins\/https__api\.example\.com\/http\/POST\/root__q-/
    );
    expect(getStaticResourceManifestPath(postApi)).toBeNull();
  });

  it("builds stored request/response metadata and manifest entries", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/app.js?v=1"
    });

    const request = buildRequestPayload(
      {
        topOrigin: "https://app.example.com",
        url: "https://api.example.com/graphql",
        method: "POST",
        requestHeaders: [{ name: "Content-Type", value: "application/json" }],
        requestBody: '{"query":"{viewer{id}}"}',
        requestBodyEncoding: "utf8",
        descriptor: { bodyHash: "body123", queryHash: "query456" }
      },
      "2026-04-06T00:00:00.000Z"
    );
    const requestWithoutDescriptor = buildRequestPayload(
      {
        topOrigin: "https://app.example.com",
        url: "https://api.example.com/health",
        method: "GET",
        requestHeaders: [],
        requestBody: "",
        requestBodyEncoding: "utf8",
        descriptor: null
      },
      "2026-04-06T00:00:00.000Z"
    );
    const response = buildResponseMeta(
      {
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
      },
      "utf8",
      "2026-04-06T00:00:00.000Z"
    );

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
    const advancedManifestEntry = createStaticResourceManifestEntry(
      advancedDescriptor as any,
      {
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
      }
    );
    const customAdvancedManifestEntry = createStaticResourceManifestEntry(
      {
        ...advancedDescriptor,
        bodyPath: "assets/static/app.js",
        requestPath: "assets/static/app.js.__request.json",
        metaPath: "assets/static/app.js.__response.json"
      } as any,
      {
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
      }
    );
    const hiddenOnlyManifestEntry = createStaticResourceManifestEntry(
      {
        ...advancedDescriptor,
        projectionPath: null
      } as any,
      {
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
      }
    );
    const updatedManifest = upsertStaticResourceManifest(
      manifest,
      manifestEntry
    );

    expect(manifestEntry.pathname).toBe("/static/app.js");
    expect(manifestEntry.bodyPath).toMatch(
      /^\.wraithwalker\/captures\/assets\/https__app\.example\.com\/cdn\.example\.com\/static\/app\.js\.__q-[a-z0-9]+\.__body$/
    );
    expect(manifestEntry.projectionPath).toBe("cdn.example.com/static/app.js");
    expect(advancedManifestEntry.bodyPath).toBe(
      ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/static/app.js.__body"
    );
    expect(customAdvancedManifestEntry.bodyPath).toBe("assets/static/app.js");
    expect(hiddenOnlyManifestEntry).not.toHaveProperty("projectionPath");
    expect(
      getStaticResourceManifestPath({
        assetLike: true,
        topOriginKey: "https__app.example.com"
      })
    ).toBe(
      ".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json"
    );
    expect(updatedManifest.resourcesByPathname["/static/app.js"]).toEqual([
      manifestEntry
    ]);
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
