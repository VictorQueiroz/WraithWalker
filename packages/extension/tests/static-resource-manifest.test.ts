import { describe, expect, it } from "vitest";

import { STATIC_RESOURCE_MANIFEST_FILE, STATIC_RESOURCE_MANIFEST_SCHEMA_VERSION } from "../src/lib/constants.js";
import { createFixtureDescriptor } from "../src/lib/fixture-mapper.js";
import {
  createStaticResourceManifest,
  createStaticResourceManifestEntry,
  getStaticResourceManifestPath,
  upsertStaticResourceManifest
} from "../src/lib/static-resource-manifest.js";
import type { AssetFixtureDescriptor } from "../src/lib/types.js";

async function createAssetDescriptor(
  payload: Parameters<typeof createFixtureDescriptor>[0]
): Promise<AssetFixtureDescriptor> {
  return await createFixtureDescriptor(payload) as AssetFixtureDescriptor;
}

describe("static resource manifest", () => {
  it("derives a manifest path for asset-like descriptors only", async () => {
    const assetDescriptor = await createAssetDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/app.js",
      resourceType: "Script"
    });
    const apiDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/graphql",
      postData: "{}"
    });

    expect(getStaticResourceManifestPath(assetDescriptor)).toBe(
      `.wraithwalker/manifests/https__app.example.com/${STATIC_RESOURCE_MANIFEST_FILE}`
    );
    expect(getStaticResourceManifestPath(apiDescriptor)).toBeNull();
  });

  it("uses the hidden metadata manifest path for simple-mode assets", async () => {
    const descriptor = await createAssetDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/app.js"
    });

    expect(getStaticResourceManifestPath(descriptor)).toBe(
      ".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json"
    );
  });

  it("creates manifest entries relative to the domain root and upserts by request url", async () => {
    const descriptor = await createAssetDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/app.js?v=1",
      resourceType: "Script"
    });

    const manifest = createStaticResourceManifest(descriptor);
    expect(manifest.schemaVersion).toBe(STATIC_RESOURCE_MANIFEST_SCHEMA_VERSION);

    const firstEntry = createStaticResourceManifestEntry(descriptor, {
      status: 200,
      statusText: "OK",
      headers: [],
      mimeType: "application/javascript",
      resourceType: "Script",
      url: descriptor.requestUrl,
      method: "GET",
      capturedAt: "2026-04-03T12:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "js"
    });

    expect(firstEntry.pathname).toBe("/static/app.js");
    expect(firstEntry.bodyPath).toMatch(
      /^\.wraithwalker\/captures\/assets\/https__app\.example\.com\/cdn\.example\.com\/static\/app\.js\.__q-/
    );

    const updatedManifest = upsertStaticResourceManifest(manifest, firstEntry);
    expect(updatedManifest.resourcesByPathname["/static/app.js"]).toEqual([firstEntry]);

    const replacementEntry = {
      ...firstEntry,
      capturedAt: "2026-04-03T12:05:00.000Z",
      bodyPath: firstEntry.bodyPath.replace("__q-", "__q-next-")
    };

    const replacementManifest = upsertStaticResourceManifest(updatedManifest, replacementEntry);
    expect(replacementManifest.resourcesByPathname["/static/app.js"]).toEqual([replacementEntry]);
    expect(replacementManifest.generatedAt).toBe("2026-04-03T12:05:00.000Z");
  });

  it("keeps visible simple-mode paths unchanged in manifest entries", async () => {
    const descriptor = await createAssetDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/static/app.js?v=1"
    });

    const entry = createStaticResourceManifestEntry(descriptor, {
      status: 200,
      statusText: "OK",
      headers: [],
      mimeType: "application/javascript",
      resourceType: "Script",
      url: descriptor.requestUrl,
      method: "GET",
      capturedAt: "2026-04-03T12:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "js"
    });

    expect(entry.bodyPath).toMatch(
      /^\.wraithwalker\/captures\/assets\/https__app\.example\.com\/cdn\.example\.com\/static\/app\.js\.__q-[a-z0-9]+\.__body$/
    );
    expect(entry.projectionPath).toBe("cdn.example.com/static/app.js");
    expect(entry.requestPath).toMatch(
      /^\.wraithwalker\/captures\/assets\/https__app\.example\.com\/cdn\.example\.com\/static\/app\.js\.__q-[a-z0-9]+\.__request\.json$/
    );
  });

  it("keeps multiple request urls under the same pathname", async () => {
    const descriptorA = await createAssetDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn-a.example.com/static/theme.css?v=1",
      resourceType: "Stylesheet"
    });
    const descriptorB = await createAssetDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn-b.example.com/static/theme.css?v=2",
      resourceType: "Stylesheet"
    });

    const manifest = createStaticResourceManifest(descriptorA);
    const entryA = createStaticResourceManifestEntry(descriptorA, {
      status: 200,
      statusText: "OK",
      headers: [],
      mimeType: "text/css",
      resourceType: "Stylesheet",
      url: descriptorA.requestUrl,
      method: "GET",
      capturedAt: "2026-04-03T12:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "css"
    });
    const entryB = createStaticResourceManifestEntry(descriptorB, {
      status: 200,
      statusText: "OK",
      headers: [],
      mimeType: "text/css",
      resourceType: "Stylesheet",
      url: descriptorB.requestUrl,
      method: "GET",
      capturedAt: "2026-04-03T12:01:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "css"
    });

    const updatedManifest = upsertStaticResourceManifest(
      upsertStaticResourceManifest(manifest, entryA),
      entryB
    );

    expect(updatedManifest.resourcesByPathname["/static/theme.css"]).toHaveLength(2);
    expect(updatedManifest.resourcesByPathname["/static/theme.css"][0].requestUrl).toBe(descriptorA.requestUrl);
    expect(updatedManifest.resourcesByPathname["/static/theme.css"][1].requestUrl).toBe(descriptorB.requestUrl);
  });
});
