import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  analyzeJsFile,
  readJsSymbol,
  searchJs,
  suggestJsSeeds,
  traceJsPipeline
} from "../src/js-intelligence.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

const LONG_ENDPOINT = `/api/agent-grade/${"deep-segment-".repeat(140)}final-response.json`;

async function createJsFixtureRoot() {
  const root = await createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-js-intel-",
    rootId: "root-js-intel"
  });
  const topOrigin = "https://app.example.com";
  const topOriginKey = root.originKey(topOrigin);
  const appAsset = {
    requestUrl: "https://cdn.example.com/assets/app.js",
    requestOrigin: "https://cdn.example.com",
    pathname: "/assets/app.js",
    search: "",
    bodyPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/app.js.__body`,
    projectionPath: "cdn.example.com/assets/app.js",
    requestPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/app.js.__request.json`,
    metaPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/app.js.__response.json`,
    mimeType: "application/javascript",
    resourceType: "Script",
    capturedAt: "2026-04-20T00:00:00.000Z"
  };
  const tsxAsset = {
    requestUrl: "https://cdn.example.com/assets/widget.tsx",
    requestOrigin: "https://cdn.example.com",
    pathname: "/assets/widget.tsx",
    search: "",
    bodyPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/widget.tsx.__body`,
    projectionPath: "cdn.example.com/assets/widget.tsx",
    requestPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/widget.tsx.__request.json`,
    metaPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/widget.tsx.__response.json`,
    mimeType: "application/typescript",
    resourceType: "Script",
    capturedAt: "2026-04-20T00:00:00.000Z"
  };
  const cssAsset = {
    requestUrl: "https://cdn.example.com/assets/app.css",
    requestOrigin: "https://cdn.example.com",
    pathname: "/assets/app.css",
    search: "",
    bodyPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/app.css.__body`,
    projectionPath: "cdn.example.com/assets/app.css",
    requestPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/app.css.__request.json`,
    metaPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/app.css.__response.json`,
    mimeType: "text/css",
    resourceType: "Stylesheet",
    capturedAt: "2026-04-20T00:00:00.000Z"
  };
  const settingsAsset = {
    requestUrl: "https://cdn.example.com/assets/settings.js",
    requestOrigin: "https://cdn.example.com",
    pathname: "/assets/settings.js",
    search: "",
    bodyPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/settings.js.__body`,
    projectionPath: "cdn.example.com/assets/settings.js",
    requestPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/settings.js.__request.json`,
    metaPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/settings.js.__response.json`,
    mimeType: "application/javascript",
    resourceType: "Script",
    capturedAt: "2026-04-20T00:00:00.000Z"
  };
  const productionBundleAsset = {
    requestUrl: "https://cdn.example.com/assets/production-bundle.js",
    requestOrigin: "https://cdn.example.com",
    pathname: "/assets/production-bundle.js",
    search: "",
    bodyPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/production-bundle.js.__body`,
    projectionPath: "cdn.example.com/assets/production-bundle.js",
    requestPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/production-bundle.js.__request.json`,
    metaPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/production-bundle.js.__response.json`,
    mimeType: "application/javascript",
    resourceType: "Script",
    capturedAt: "2026-04-20T00:00:00.000Z"
  };
  const longEndpointAsset = {
    requestUrl: "https://cdn.example.com/assets/long-endpoint.js",
    requestOrigin: "https://cdn.example.com",
    pathname: "/assets/long-endpoint.js",
    search: "",
    bodyPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/long-endpoint.js.__body`,
    projectionPath: "cdn.example.com/assets/long-endpoint.js",
    requestPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/long-endpoint.js.__request.json`,
    metaPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/long-endpoint.js.__response.json`,
    mimeType: "application/javascript",
    resourceType: "Script",
    capturedAt: "2026-04-20T00:00:00.000Z"
  };

  await root.writeManifest({
    topOrigin,
    manifest: {
      schemaVersion: 1,
      topOrigin,
      topOriginKey,
      generatedAt: "2026-04-20T00:00:00.000Z",
      resourcesByPathname: {
        "/assets/app.js": [appAsset],
        "/assets/widget.tsx": [tsxAsset],
        "/assets/app.css": [cssAsset],
        "/assets/settings.js": [settingsAsset],
        "/assets/production-bundle.js": [productionBundleAsset],
        "/assets/long-endpoint.js": [longEndpointAsset]
      }
    }
  });

  const appSource = `import { client } from "./client";

export function loadOrders(root = document.querySelector("#orders-list")) {
  const selector = ".orders-panel [data-testid=refresh]";
  return fetch("/api/orders?include=items")
    .then((response) => response.json())
    .then((data) => {
      chrome.runtime.sendMessage({ type: "orders.loaded", selector });
      window.postMessage("orders-ready", "*");
      return data;
    });
}

${"//#"} sourceMappingURL=app.js.map
`;
  const tsxSource = `export interface WidgetProps {
  label: string;
}

export const OrderButton = ({ label }: WidgetProps) => (
  <button data-testid="order-button">{label}</button>
);
`;
  const settingsSource = `export async function saveSettings(form=document.querySelector("#settings-form")){
  document.querySelector('[data-testid="settings-save"]')?.setAttribute("aria-busy","true");
  return fetch("/api/settings/profile",{method:"POST",body:new FormData(form)})
    .then((response)=>response.json());
}
export function mountSettingsRoute(root){
  root.querySelector('[data-testid="settings-save"]')?.addEventListener("click",()=>saveSettings());
}
`;
  const productionBundleSource = `(() => {
${"const keepWarm=0;\n".repeat(3_000)}
const bundledModals=[
  {name:"WarmupModal",icon:{fillOpacity:".28",d:"M10.299 3.702c-.744.814-8.033 13.526-8.256 14.439-.223.913.446 2.32 1.339 2.764"}},
  {name:"MatchSuccessModal",visibleSelector:"[data-testid=save]",mount(root){return root.querySelector(".modal-root [data-testid=save]")}},
  {name:"LaterModal",icon:{fillOpacity:".56"}}
];
})();
`;
  const longEndpointSource = `export function loadLongEndpoint(){
  return fetch("${LONG_ENDPOINT}").then((response)=>response.json());
}
`;

  await root.writeText(appAsset.bodyPath, appSource);
  await root.writeText(appAsset.projectionPath, appSource);
  await root.writeText(tsxAsset.bodyPath, tsxSource);
  await root.writeText(tsxAsset.projectionPath, tsxSource);
  await root.writeText(settingsAsset.bodyPath, settingsSource);
  await root.writeText(settingsAsset.projectionPath, settingsSource);
  await root.writeText(productionBundleAsset.bodyPath, productionBundleSource);
  await root.writeText(
    productionBundleAsset.projectionPath,
    productionBundleSource
  );
  await root.writeText(longEndpointAsset.bodyPath, longEndpointSource);
  await root.writeText(longEndpointAsset.projectionPath, longEndpointSource);
  await root.writeText(cssAsset.bodyPath, ".orders-panel { color: red; }");
  await root.writeText(
    cssAsset.projectionPath,
    ".orders-panel { color: red; }"
  );
  await root.writeText("broken.js", "function {");
  await fs.mkdir(path.dirname(root.resolve("binary.js")), { recursive: true });
  await fs.writeFile(
    root.resolve("binary.js"),
    Buffer.from([0xff, 0xfe, 0xfd])
  );
  await root.writeApiFixture({
    topOrigin,
    requestOrigin: "https://api.example.com",
    method: "POST",
    fixtureName: "settings-profile__q-none__b-form",
    meta: {
      status: 200,
      statusText: "OK",
      headers: [{ name: "Content-Type", value: "application/json" }],
      mimeType: "application/json",
      resourceType: "Fetch",
      url: "https://api.example.com/api/settings/profile",
      method: "POST",
      capturedAt: "2026-04-20T00:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "json"
    },
    body: '{"ok":true}'
  });

  return root;
}

async function createHugePipelineFixtureRoot() {
  const root = await createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-js-pipeline-huge-",
    rootId: "root-js-pipeline-huge"
  });
  const topOrigin = "https://app.example.com";
  const topOriginKey = root.originKey(topOrigin);
  const hugeAsset = {
    requestUrl: "https://cdn.example.com/assets/huge-settings.js",
    requestOrigin: "https://cdn.example.com",
    pathname: "/assets/huge-settings.js",
    search: "",
    bodyPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/huge-settings.js.__body`,
    projectionPath: "cdn.example.com/assets/huge-settings.js",
    requestPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/huge-settings.js.__request.json`,
    metaPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/huge-settings.js.__response.json`,
    mimeType: "application/javascript",
    resourceType: "Script",
    capturedAt: "2026-04-20T00:00:00.000Z"
  };

  await root.writeManifest({
    topOrigin,
    manifest: {
      schemaVersion: 1,
      topOrigin,
      topOriginKey,
      generatedAt: "2026-04-20T00:00:00.000Z",
      resourcesByPathname: {
        "/assets/huge-settings.js": [hugeAsset]
      }
    }
  });
  const hugeSource = [
    "(()=>{",
    'const endpoint="/api/settings/mega";',
    'document.querySelector("[data-testid=mega-save]");',
    "fetch(endpoint);",
    `/*${"x".repeat(6 * 1024 * 1024)}*/`,
    "})();",
    "//# sourceMappingURL=huge-settings.js.map"
  ].join("");
  await root.writeText(hugeAsset.bodyPath, hugeSource);
  await root.writeText(hugeAsset.projectionPath, hugeSource);
  await root.writeApiFixture({
    topOrigin,
    requestOrigin: "https://api.example.com",
    method: "GET",
    fixtureName: "settings-mega__q-none__b-none",
    meta: {
      status: 200,
      statusText: "OK",
      headers: [{ name: "Content-Type", value: "application/json" }],
      mimeType: "application/json",
      resourceType: "Fetch",
      url: "https://api.example.com/api/settings/mega",
      method: "GET",
      capturedAt: "2026-04-20T00:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "json"
    },
    body: '{"ok":true}'
  });

  return root;
}

async function createSeedBudgetFixtureRoot() {
  const root = await createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-js-seed-budget-",
    rootId: "root-js-seed-budget"
  });
  const topOrigin = "https://app.example.com";
  const topOriginKey = root.originKey(topOrigin);
  const asset = {
    requestUrl: "https://cdn.example.com/assets/seed-budget.js",
    requestOrigin: "https://cdn.example.com",
    pathname: "/assets/seed-budget.js",
    search: "",
    bodyPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/seed-budget.js.__body`,
    projectionPath: "cdn.example.com/assets/seed-budget.js",
    requestPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/seed-budget.js.__request.json`,
    metaPath: `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/seed-budget.js.__response.json`,
    mimeType: "application/javascript",
    resourceType: "Script",
    capturedAt: "2026-04-20T00:00:00.000Z"
  };

  await root.writeManifest({
    topOrigin,
    manifest: {
      schemaVersion: 1,
      topOrigin,
      topOriginKey,
      generatedAt: "2026-04-20T00:00:00.000Z",
      resourcesByPathname: {
        "/assets/seed-budget.js": [asset]
      }
    }
  });

  const source = [
    '(()=>{const endpoint="/api/seed-budget";',
    'document.querySelector("[data-testid=seed-budget]");',
    "fetch(endpoint);",
    `/*${"x".repeat(2 * 1024 * 1024)}*/`,
    "})();"
  ].join("");
  await root.writeText(asset.bodyPath, source);
  await root.writeText(asset.projectionPath, source);

  return root;
}

async function createApiLinkEdgeFixtureRoot() {
  const root = await createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-js-api-link-edge-",
    rootId: "root-js-api-link-edge"
  });
  const topOriginA = "https://app-a.example.com";
  const topOriginB = "https://app-b.example.com";
  const topOriginKeyA = root.originKey(topOriginA);
  const topOriginKeyB = root.originKey(topOriginB);
  const apiLinkAssetA = {
    requestUrl: "https://cdn-a.example.com/assets/api-link-a.js",
    requestOrigin: "https://cdn-a.example.com",
    pathname: "/assets/api-link-a.js",
    search: "",
    bodyPath: `.wraithwalker/captures/assets/${topOriginKeyA}/cdn-a.example.com/assets/api-link-a.js.__body`,
    projectionPath: "cdn-a.example.com/assets/api-link-a.js",
    requestPath: `.wraithwalker/captures/assets/${topOriginKeyA}/cdn-a.example.com/assets/api-link-a.js.__request.json`,
    metaPath: `.wraithwalker/captures/assets/${topOriginKeyA}/cdn-a.example.com/assets/api-link-a.js.__response.json`,
    mimeType: "application/javascript",
    resourceType: "Script",
    capturedAt: "2026-04-20T00:00:00.000Z"
  };
  const apiLinkAssetB = {
    requestUrl: "https://cdn-b.example.com/assets/api-link-b.js",
    requestOrigin: "https://cdn-b.example.com",
    pathname: "/assets/api-link-b.js",
    search: "",
    bodyPath: `.wraithwalker/captures/assets/${topOriginKeyB}/cdn-b.example.com/assets/api-link-b.js.__body`,
    projectionPath: "cdn-b.example.com/assets/api-link-b.js",
    requestPath: `.wraithwalker/captures/assets/${topOriginKeyB}/cdn-b.example.com/assets/api-link-b.js.__request.json`,
    metaPath: `.wraithwalker/captures/assets/${topOriginKeyB}/cdn-b.example.com/assets/api-link-b.js.__response.json`,
    mimeType: "application/javascript",
    resourceType: "Script",
    capturedAt: "2026-04-20T00:00:00.000Z"
  };
  const invalidEndpointAsset = {
    requestUrl: "https://cdn-a.example.com/assets/invalid-endpoint.js",
    requestOrigin: "https://cdn-a.example.com",
    pathname: "/assets/invalid-endpoint.js",
    search: "",
    bodyPath: `.wraithwalker/captures/assets/${topOriginKeyA}/cdn-a.example.com/assets/invalid-endpoint.js.__body`,
    projectionPath: "cdn-a.example.com/assets/invalid-endpoint.js",
    requestPath: `.wraithwalker/captures/assets/${topOriginKeyA}/cdn-a.example.com/assets/invalid-endpoint.js.__request.json`,
    metaPath: `.wraithwalker/captures/assets/${topOriginKeyA}/cdn-a.example.com/assets/invalid-endpoint.js.__response.json`,
    mimeType: "application/javascript",
    resourceType: "Script",
    capturedAt: "2026-04-20T00:00:00.000Z"
  };

  await root.writeManifest({
    topOrigin: topOriginA,
    manifest: {
      schemaVersion: 1,
      topOrigin: topOriginA,
      topOriginKey: topOriginKeyA,
      generatedAt: "2026-04-20T00:00:00.000Z",
      resourcesByPathname: {
        "/assets/api-link-a.js": [apiLinkAssetA],
        "/assets/invalid-endpoint.js": [invalidEndpointAsset]
      }
    }
  });
  await root.writeManifest({
    topOrigin: topOriginB,
    manifest: {
      schemaVersion: 1,
      topOrigin: topOriginB,
      topOriginKey: topOriginKeyB,
      generatedAt: "2026-04-20T00:00:00.000Z",
      resourcesByPathname: {
        "/assets/api-link-b.js": [apiLinkAssetB]
      }
    }
  });

  const sourceA = `export function loadSharedApi(){
  fetch("https://api-a.example.com/api/shared");
  fetch("/api/shared");
}
`;
  const sourceB = `export function loadSharedApiForOtherOrigin(){
  fetch("/api/shared");
}
`;
  const invalidSource = `export function loadMalformedEndpoint(){
  return fetch("http://[bad");
}
`;
  await root.writeText(apiLinkAssetA.bodyPath, sourceA);
  await root.writeText(apiLinkAssetA.projectionPath, sourceA);
  await root.writeText(apiLinkAssetB.bodyPath, sourceB);
  await root.writeText(apiLinkAssetB.projectionPath, sourceB);
  await root.writeText(invalidEndpointAsset.bodyPath, invalidSource);
  await root.writeText(invalidEndpointAsset.projectionPath, invalidSource);

  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    await root.writeApiFixture({
      topOrigin: topOriginA,
      requestOrigin: "https://api-a.example.com",
      method,
      fixtureName: `shared-${method.toLowerCase()}__q-none__b-none`,
      meta: {
        status: method === "POST" ? 201 : 200,
        statusText: "OK",
        headers: [{ name: "Content-Type", value: "application/json" }],
        mimeType: "application/json",
        resourceType: "Fetch",
        url: "https://api-a.example.com/api/shared",
        method,
        capturedAt: "2026-04-20T00:00:00.000Z",
        bodyEncoding: "utf8",
        bodySuggestedExtension: "json"
      },
      body: `{"marker":"EDGE_API_BODY_MARKER_${method}"}`
    });
  }
  const otherOriginFixture = await root.writeApiFixture({
    topOrigin: topOriginB,
    requestOrigin: "https://api-b.example.com",
    method: "PUT",
    fixtureName: "shared-put__q-none__b-none",
    meta: {
      status: 202,
      statusText: "Accepted",
      headers: [{ name: "Content-Type", value: "application/json" }],
      mimeType: "application/json",
      resourceType: "Fetch",
      url: "https://api-b.example.com/api/shared",
      method: "PUT",
      capturedAt: "2026-04-20T00:00:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "json"
    },
    body: '{"marker":"EDGE_API_BODY_MARKER_OTHER"}'
  });

  return {
    root,
    topOriginA,
    topOriginB,
    otherOriginFixture
  };
}

describe("js intelligence", () => {
  it("analyzes captured JavaScript summaries without returning raw ASTs", async () => {
    const root = await createJsFixtureRoot();

    const analysis = await analyzeJsFile(
      root.rootPath,
      "cdn.example.com/assets/app.js"
    );

    expect(analysis.parse).toEqual({
      ok: true,
      recovered: false,
      errors: []
    });
    expect(analysis.sourceMap).toEqual({
      url: "app.js.map",
      kind: "external",
      line: 14
    });
    expect(analysis.summary.imports).toEqual([
      {
        source: "./client",
        specifiers: ["client"],
        loc: { line: 1, column: 1 }
      }
    ]);
    expect(analysis.summary.exports).toEqual([
      expect.objectContaining({ value: "loadOrders" })
    ]);
    expect(analysis.summary.topLevelSymbols).toEqual([
      expect.objectContaining({
        value: "loadOrders",
        kind: "function",
        lineRange: { start: 3, end: 12 }
      })
    ]);
    expect(analysis.summary.endpointStrings).toEqual([
      expect.objectContaining({ value: "/api/orders?include=items" })
    ]);
    expect(analysis.summary.selectorStrings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "#orders-list" }),
        expect.objectContaining({
          value: ".orders-panel [data-testid=refresh]"
        })
      ])
    );
    expect(analysis.summary.notableCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "fetch",
          firstArgument: "/api/orders?include=items"
        }),
        expect.objectContaining({ value: "chrome.runtime.sendMessage" }),
        expect.objectContaining({ value: "window.postMessage" })
      ])
    );
    expect(JSON.stringify(analysis)).not.toContain('"program"');
  });

  it("parses JSX and TypeScript syntax", async () => {
    const root = await createJsFixtureRoot();

    const analysis = await analyzeJsFile(
      root.rootPath,
      "cdn.example.com/assets/widget.tsx"
    );

    expect(analysis.parse.ok).toBe(true);
    expect(analysis.summary.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "WidgetProps" }),
        expect.objectContaining({ value: "OrderButton" })
      ])
    );
    expect(analysis.summary.topLevelSymbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "WidgetProps", kind: "interface" }),
        expect.objectContaining({ value: "OrderButton", kind: "variable" })
      ])
    );
  });

  it("reports parse failures, non-JS files, and binary fixtures cleanly", async () => {
    const root = await createJsFixtureRoot();

    const parseFailure = await analyzeJsFile(root.rootPath, "broken.js");
    expect(parseFailure.parse.ok).toBe(false);
    expect(parseFailure.parse.errors[0]?.message).toContain("Unexpected token");

    await expect(
      analyzeJsFile(root.rootPath, "cdn.example.com/assets/app.css")
    ).rejects.toThrow("not a JavaScript-like captured file");

    await expect(analyzeJsFile(root.rootPath, "binary.js")).rejects.toThrow(
      "not a UTF-8 text JavaScript file"
    );
  });

  it("searches parsed facts with pagination and kind filters", async () => {
    const root = await createJsFixtureRoot();

    const endpoints = await searchJs(root.rootPath, {
      query: "orders",
      kind: "endpoint",
      limit: 1
    });
    expect(endpoints.items).toEqual([
      expect.objectContaining({
        path: "cdn.example.com/assets/app.js",
        kind: "endpoint",
        value: "/api/orders?include=items",
        enclosingSymbol: "loadOrders"
      })
    ]);
    expect(endpoints.totalMatched).toBe(1);
    expect(endpoints.nextCursor).toBeNull();
    expect(endpoints.matchedOrigins).toEqual(["https://app.example.com"]);

    const calls = await searchJs(root.rootPath, {
      query: "message",
      kind: "call",
      limit: 1
    });
    expect(calls.items).toEqual([
      expect.objectContaining({
        kind: "call",
        value: "chrome.runtime.sendMessage"
      })
    ]);
    expect(calls.nextCursor).not.toBeNull();

    const nextCalls = await searchJs(root.rootPath, {
      query: "message",
      kind: "call",
      cursor: calls.nextCursor ?? undefined
    });
    expect(nextCalls.items).toEqual([
      expect.objectContaining({
        kind: "call",
        value: "window.postMessage"
      })
    ]);
  });

  it("bounds oversized public JS values while keeping node follow-ups usable", async () => {
    const root = await createJsFixtureRoot();

    const analysis = await analyzeJsFile(
      root.rootPath,
      "cdn.example.com/assets/long-endpoint.js"
    );
    const endpointSummary = analysis.summary.endpointStrings[0];
    expect(endpointSummary).toEqual(
      expect.objectContaining({
        valueTruncated: true,
        valueBytes: Buffer.byteLength(LONG_ENDPOINT, "utf8")
      })
    );
    expect(endpointSummary?.value.length).toBeLessThan(LONG_ENDPOINT.length);
    expect(JSON.stringify(analysis)).not.toContain(LONG_ENDPOINT);

    const searchResult = await searchJs(root.rootPath, {
      query: "agent-grade",
      kind: "endpoint",
      pathContains: "long-endpoint"
    });
    expect(searchResult.items[0]).toEqual(
      expect.objectContaining({
        kind: "endpoint",
        valueTruncated: true,
        valueBytes: Buffer.byteLength(LONG_ENDPOINT, "utf8"),
        valueHash: expect.any(String)
      })
    );
    expect(searchResult.items[0]?.value).toBe(
      searchResult.items[0]?.valuePreview
    );
    expect(JSON.stringify(searchResult)).not.toContain(LONG_ENDPOINT);

    const trace = await traceJsPipeline(root.rootPath, {
      seed: "/api/agent-grade",
      kind: "endpoint",
      pathContains: "long-endpoint"
    });
    expect(trace.items[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "endpoint",
          valueTruncated: true
        })
      ])
    );
    expect(JSON.stringify(trace)).not.toContain(LONG_ENDPOINT);
    expect(Buffer.byteLength(JSON.stringify(trace), "utf8")).toBeLessThan(
      64 * 1024
    );

    const nodeResult = await readJsSymbol(root.rootPath, {
      path: "cdn.example.com/assets/long-endpoint.js",
      nodeId: searchResult.items[0]?.nodeId
    });
    expect(nodeResult.text).toContain(LONG_ENDPOINT);
  });

  it("suggests ranked JS seeds with filters, pagination, and text-scan support", async () => {
    const root = await createJsFixtureRoot();

    const firstPage = await suggestJsSeeds(root.rootPath, {
      pathContains: "settings",
      limit: 2
    });
    expect(firstPage.items.length).toBe(2);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(firstPage.items[0]?.score ?? 0).toBeGreaterThanOrEqual(
      firstPage.items[1]?.score ?? 0
    );
    expect(firstPage.items.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["endpoint", "selector"])
    );
    expect(firstPage.items[0]).toEqual(
      expect.objectContaining({
        valuePreview: expect.any(String),
        valueBytes: expect.any(Number),
        valueTruncated: expect.any(Boolean),
        valueHash: expect.any(String),
        analysisMode: "ast",
        reasons: expect.any(Array)
      })
    );

    const secondPage = await suggestJsSeeds(root.rootPath, {
      pathContains: "settings",
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined
    });
    expect(secondPage.items.length).toBeGreaterThan(0);
    expect(secondPage.items[0]?.nodeId).not.toBe(firstPage.items[0]?.nodeId);

    const selectorOnly = await suggestJsSeeds(root.rootPath, {
      pathContains: "settings",
      kinds: ["selector"],
      limit: 10
    });
    expect(selectorOnly.items.every((item) => item.kind === "selector")).toBe(
      true
    );

    const hugeRoot = await createHugePipelineFixtureRoot();
    const hugeSeeds = await suggestJsSeeds(hugeRoot.rootPath, {
      pathContains: "huge-settings",
      kinds: ["endpoint", "selector", "call", "string"],
      limit: 5
    });
    expect(hugeSeeds.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "endpoint",
          analysisMode: "text-scan",
          value: "/api/settings/mega"
        }),
        expect.objectContaining({
          kind: "selector",
          analysisMode: "text-scan",
          value: "[data-testid=mega-save]"
        })
      ])
    );
  }, 15_000);

  it("surfaces captured API response links in endpoint seed suggestions", async () => {
    const root = await createJsFixtureRoot();

    const endpointSeeds = await suggestJsSeeds(root.rootPath, {
      kinds: ["endpoint"],
      limit: 20
    });
    const linkedSeed = endpointSeeds.items.find(
      (item) => item.value === "/api/settings/profile"
    );
    const unlinkedSeed = endpointSeeds.items.find(
      (item) => item.value === "/api/orders?include=items"
    );

    expect(linkedSeed).toEqual(
      expect.objectContaining({
        apiResponseLink: expect.objectContaining({
          matchStatus: "matched",
          fixtureDir: expect.any(String),
          bodyPath: expect.any(String),
          method: "POST",
          status: 200,
          pathname: "/api/settings/profile"
        }),
        reasons: expect.arrayContaining(["captured-api-response"])
      })
    );
    expect(unlinkedSeed).toEqual(
      expect.objectContaining({
        apiResponseLink: expect.objectContaining({
          matchStatus: "no-match",
          pathname: "/api/orders",
          reason: "no-captured-api-response-match"
        }),
        reasons: expect.arrayContaining(["no-captured-api-response"])
      })
    );
    expect(endpointSeeds.items.indexOf(linkedSeed!)).toBeLessThan(
      endpointSeeds.items.indexOf(unlinkedSeed!)
    );
    expect(JSON.stringify(endpointSeeds)).not.toContain('{"ok":true}');
  });

  it("handles API response link origin scoping, absolute URLs, and bounded matches", async () => {
    const { root, topOriginA, otherOriginFixture } =
      await createApiLinkEdgeFixtureRoot();

    const seeds = await suggestJsSeeds(root.rootPath, {
      kinds: ["endpoint"],
      pathContains: "api-link-a",
      limit: 20
    });
    const absoluteSeed = seeds.items.find(
      (item) => item.value === "https://api-a.example.com/api/shared"
    );
    const relativeSeed = seeds.items.find(
      (item) => item.value === "/api/shared"
    );

    expect(absoluteSeed).toEqual(
      expect.objectContaining({
        origin: topOriginA,
        apiResponseLink: expect.objectContaining({
          matchStatus: "matched",
          method: "DELETE",
          pathname: "/api/shared"
        })
      })
    );
    expect(relativeSeed).toEqual(
      expect.objectContaining({
        origin: topOriginA,
        apiResponseLink: expect.objectContaining({
          matchStatus: "matched",
          pathname: "/api/shared"
        })
      })
    );
    expect(JSON.stringify(seeds)).not.toContain("EDGE_API_BODY_MARKER");

    const trace = await traceJsPipeline(root.rootPath, {
      seed: "api/shared",
      kind: "endpoint",
      pathContains: "api-link-a",
      limit: 5
    });
    const linkedTrace = trace.items.find(
      (item) =>
        item.path === "cdn-a.example.com/assets/api-link-a.js" &&
        item.apiResponseLinks.length === 3
    );

    expect(linkedTrace?.apiResponseLinks.map((link) => link.method)).toEqual([
      "DELETE",
      "GET",
      "PATCH"
    ]);
    expect(JSON.stringify(linkedTrace?.apiResponseLinks)).not.toContain(
      otherOriginFixture.fixtureDir
    );
    expect(JSON.stringify(trace)).not.toContain("EDGE_API_BODY_MARKER");
  });

  it("returns compact no-match metadata for endpoint-like values that cannot be normalized", async () => {
    const { root } = await createApiLinkEdgeFixtureRoot();

    const seeds = await suggestJsSeeds(root.rootPath, {
      kinds: ["endpoint"],
      pathContains: "invalid-endpoint",
      limit: 5
    });
    const malformedSeed = seeds.items.find(
      (item) => item.value === "http://[bad"
    );

    expect(malformedSeed).toEqual(
      expect.objectContaining({
        apiResponseLink: expect.objectContaining({
          matchStatus: "no-match",
          reason: "no-captured-api-response-match"
        })
      })
    );
    expect(malformedSeed?.apiResponseLink?.pathname).toBeUndefined();

    const trace = await traceJsPipeline(root.rootPath, {
      seed: "http://[bad",
      kind: "endpoint",
      pathContains: "invalid-endpoint"
    });
    expect(trace.items[0]).toEqual(
      expect.objectContaining({
        confidence: "medium",
        apiResponseLinks: [
          expect.objectContaining({
            matchStatus: "no-match",
            reason: "no-captured-api-response-match"
          })
        ],
        warnings: expect.arrayContaining([
          expect.stringContaining("No captured API response metadata")
        ])
      })
    );
    expect(trace.items[0]?.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "api-response"
        })
      ])
    );
  });

  it("uses fast text-scan seed discovery for large bundles", async () => {
    const root = await createSeedBudgetFixtureRoot();

    const seeds = await suggestJsSeeds(root.rootPath, {
      pathContains: "seed-budget",
      kinds: ["endpoint", "selector", "call", "string"],
      limit: 10
    });
    const endpointSeed = seeds.items.find(
      (item) => item.kind === "endpoint" && item.value === "/api/seed-budget"
    );

    expect(endpointSeed).toEqual(
      expect.objectContaining({
        path: "cdn.example.com/assets/seed-budget.js",
        analysisMode: "text-scan",
        nodeKind: "StringLiteral",
        value: "/api/seed-budget"
      })
    );
    expect(endpointSeed?.nodeId).toMatch(/^js-text:/);

    const snippet = await readJsSymbol(root.rootPath, {
      path: "cdn.example.com/assets/seed-budget.js",
      nodeId: endpointSeed?.nodeId
    });
    expect(snippet).toEqual(
      expect.objectContaining({
        nodeKind: "StringLiteral",
        truncated: true
      })
    );
    expect(snippet.text).toContain("/api/seed-budget");
    expect(Buffer.byteLength(snippet.text, "utf8")).toBeLessThanOrEqual(8_192);

    const trace = await traceJsPipeline(root.rootPath, {
      seed: "/api/seed-budget",
      kind: "endpoint",
      pathContains: "seed-budget"
    });
    expect(trace.items[0]).toEqual(
      expect.objectContaining({
        analysisMode: "text-scan",
        confidence: "low",
        apiResponseLinks: [
          expect.objectContaining({
            matchStatus: "no-match",
            pathname: "/api/seed-budget",
            reason: "no-captured-api-response-match"
          })
        ],
        warnings: expect.arrayContaining([
          expect.stringContaining("No captured API response metadata")
        ])
      })
    );

    const fullAnalysis = await analyzeJsFile(
      root.rootPath,
      "cdn.example.com/assets/seed-budget.js"
    );
    expect(fullAnalysis.analysisMode).toBe("text-scan");
    expect(fullAnalysis.parse).toEqual(
      expect.objectContaining({
        skipped: true,
        reason: "file-too-large"
      })
    );
  }, 15_000);

  it("reads symbol and node snippets from parsed JavaScript", async () => {
    const root = await createJsFixtureRoot();

    const symbolResult = await readJsSymbol(root.rootPath, {
      path: "cdn.example.com/assets/app.js",
      symbol: "loadOrders"
    });
    expect(symbolResult).toEqual(
      expect.objectContaining({
        symbol: "loadOrders",
        nodeKind: "FunctionDeclaration",
        startLine: 3,
        endLine: 12
      })
    );
    expect(symbolResult.text).toContain('fetch("/api/orders?include=items")');

    const searchResult = await searchJs(root.rootPath, {
      query: "orders.loaded",
      kind: "string"
    });
    const nodeResult = await readJsSymbol(root.rootPath, {
      path: "cdn.example.com/assets/app.js",
      nodeId: searchResult.items[0]?.nodeId
    });
    expect(nodeResult.text).toContain("chrome.runtime.sendMessage");
  });

  it("reports read-js-symbol failure modes clearly", async () => {
    const root = await createJsFixtureRoot();

    await expect(
      readJsSymbol(root.rootPath, {
        path: "cdn.example.com/assets/app.js",
        nodeId: "not-a-node-id"
      })
    ).rejects.toThrow("Invalid JavaScript node id: not-a-node-id");

    await expect(
      readJsSymbol(root.rootPath, {
        path: "cdn.example.com/assets/app.js",
        nodeId: "js:999999-1000000:Identifier"
      })
    ).rejects.toThrow(
      "JavaScript node not found in cdn.example.com/assets/app.js"
    );

    await expect(
      readJsSymbol(root.rootPath, {
        path: "cdn.example.com/assets/app.js",
        symbol: "missingSymbol"
      })
    ).rejects.toThrow(
      "JavaScript symbol not found in cdn.example.com/assets/app.js"
    );

    await expect(
      readJsSymbol(root.rootPath, {
        path: "broken.js",
        symbol: "broken"
      })
    ).rejects.toThrow("JavaScript fixture could not be parsed");
  });

  it("filters selector noise from production bundle literals", async () => {
    const root = await createJsFixtureRoot();

    const analysis = await analyzeJsFile(
      root.rootPath,
      "cdn.example.com/assets/production-bundle.js"
    );
    const selectors = analysis.summary.selectorStrings.map(
      (entry) => entry.value
    );
    expect(selectors).toEqual(
      expect.arrayContaining([
        "[data-testid=save]",
        ".modal-root [data-testid=save]"
      ])
    );
    expect(selectors).not.toContain(".28");
    expect(selectors).not.toContain(".56");
    expect(selectors.some((selector) => selector.startsWith("M10.299"))).toBe(
      false
    );

    const numericNoise = await searchJs(root.rootPath, {
      query: ".28",
      kind: "selector",
      pathContains: "production-bundle"
    });
    expect(numericNoise.items).toEqual([]);

    const svgNoise = await searchJs(root.rootPath, {
      query: "M10.299",
      kind: "selector",
      pathContains: "production-bundle"
    });
    expect(svgNoise.items).toEqual([]);

    const realSelectors = await searchJs(root.rootPath, {
      query: "data-testid",
      kind: "selector",
      pathContains: "production-bundle"
    });
    expect(realSelectors.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "[data-testid=save]" }),
        expect.objectContaining({
          value: ".modal-root [data-testid=save]"
        })
      ])
    );
  });

  it("reads local snippets from production bundle declaration chains", async () => {
    const root = await createJsFixtureRoot();

    const matchName = await searchJs(root.rootPath, {
      query: "MatchSuccessModal",
      kind: "string",
      pathContains: "production-bundle"
    });
    const nodeResult = await readJsSymbol(root.rootPath, {
      path: "cdn.example.com/assets/production-bundle.js",
      nodeId: matchName.items[0]?.nodeId
    });

    expect(nodeResult).toEqual(
      expect.objectContaining({
        nodeKind: "ObjectProperty",
        truncated: false
      })
    );
    expect(nodeResult.text).toBe('name:"MatchSuccessModal"');
    expect(nodeResult.text).not.toContain("WarmupModal");
    expect(nodeResult.text).not.toContain("LaterModal");
    expect(Buffer.byteLength(nodeResult.text, "utf8")).toBeLessThan(128);
  });

  it("traces selector, endpoint, and node id seeds to compact pipeline evidence", async () => {
    const root = await createJsFixtureRoot();

    const selectorTrace = await traceJsPipeline(root.rootPath, {
      seed: "settings-save",
      kind: "selector",
      pathContains: "settings"
    });
    expect(selectorTrace.matchedOrigins).toEqual(["https://app.example.com"]);
    expect(selectorTrace.items[0]).toEqual(
      expect.objectContaining({
        confidence: "high",
        path: "cdn.example.com/assets/settings.js",
        analysisMode: "ast",
        apiResponseLinks: [
          expect.objectContaining({
            matchStatus: "matched",
            method: "POST",
            status: 200,
            pathname: "/api/settings/profile"
          })
        ]
      })
    );
    expect(selectorTrace.items[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "entrypoint",
          label: "mountSettingsRoute event listener"
        }),
        expect.objectContaining({
          kind: "handler",
          value: "saveSettings"
        }),
        expect.objectContaining({
          kind: "endpoint",
          value: "/api/settings/profile"
        }),
        expect.objectContaining({
          kind: "api-response",
          method: "POST",
          pathname: "/api/settings/profile"
        })
      ])
    );
    expect(JSON.stringify(selectorTrace)).not.toContain('"program"');
    expect(JSON.stringify(selectorTrace)).not.toContain('"ok":true');

    const endpointTrace = await traceJsPipeline(root.rootPath, {
      seed: "/api/settings/profile",
      kind: "endpoint",
      pathContains: "settings"
    });
    expect(endpointTrace.items[0]?.summary).toContain(
      "captured POST /api/settings/profile"
    );

    const noMatchTrace = await traceJsPipeline(root.rootPath, {
      seed: "/api/orders",
      kind: "endpoint",
      pathContains: "app"
    });
    expect(noMatchTrace.items[0]).toEqual(
      expect.objectContaining({
        apiResponseLinks: [
          expect.objectContaining({
            matchStatus: "no-match",
            pathname: "/api/orders",
            reason: "no-captured-api-response-match"
          })
        ],
        warnings: expect.arrayContaining([
          expect.stringContaining("No captured API response metadata")
        ])
      })
    );
    expect(noMatchTrace.items[0]?.steps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "api-response"
        })
      ])
    );

    const nodeIdTrace = await traceJsPipeline(root.rootPath, {
      seed: endpointTrace.items[0]?.seed.nodeId ?? "",
      kind: "nodeId",
      pathContains: "settings"
    });
    expect(nodeIdTrace.items[0]).toEqual(
      expect.objectContaining({
        confidence: "high",
        path: "cdn.example.com/assets/settings.js"
      })
    );
  });

  it("degrades pipeline tracing for oversized text-scanned JavaScript", async () => {
    const root = await createHugePipelineFixtureRoot();

    const trace = await traceJsPipeline(root.rootPath, {
      seed: "/api/settings/mega",
      kind: "endpoint",
      pathContains: "huge-settings"
    });

    expect(trace.items).toEqual([
      expect.objectContaining({
        confidence: "medium",
        analysisMode: "text-scan",
        path: "cdn.example.com/assets/huge-settings.js",
        apiResponseLinks: [
          expect.objectContaining({
            matchStatus: "matched",
            pathname: "/api/settings/mega"
          })
        ],
        warnings: [expect.stringContaining("text-scan mode")]
      })
    ]);
    expect(trace.items[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "endpoint",
          value: "/api/settings/mega"
        }),
        expect.objectContaining({
          kind: "api-response",
          pathname: "/api/settings/mega"
        })
      ])
    );

    const endpointSearch = await searchJs(root.rootPath, {
      query: "/api/settings/mega",
      kind: "endpoint",
      pathContains: "huge-settings"
    });
    const symbolRead = await readJsSymbol(root.rootPath, {
      path: "cdn.example.com/assets/huge-settings.js",
      nodeId: endpointSearch.items[0]?.nodeId
    });
    expect(symbolRead.text).toContain("/api/settings/mega");
    expect(Buffer.byteLength(symbolRead.text, "utf8")).toBeLessThanOrEqual(
      8_192
    );

    const skipped = await traceJsPipeline(root.rootPath, {
      seed: "bootHuge",
      kind: "symbol",
      pathContains: "huge-settings"
    });
    expect(skipped.items).toEqual([]);
    expect(skipped.skipped).toEqual([
      expect.objectContaining({
        path: "cdn.example.com/assets/huge-settings.js",
        reason: expect.stringContaining("does not support symbol")
      })
    ]);
  }, 15_000);
});
