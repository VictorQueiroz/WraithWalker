import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import type {
  JsFileAnalysis,
  JsSearchResult,
  JsSymbolReadResult
} from "../src/js-intelligence.mts";
import { startServer } from "../src/server.mts";
import {
  createWraithwalkerFixtureRoot,
  type WraithwalkerFixtureRoot
} from "../../../test-support/wraithwalker-fixture-root.mts";

// Dogfood note: this fixture exercises the expected agent workflow against the
// MCP surface itself: search semantic facts, narrow by kind/path, then read the
// enclosing snippet instead of dumping raw bundled JavaScript.

const requireFromTest = createRequire(import.meta.url);

interface CapturedScriptAsset {
  requestUrl: string;
  requestOrigin: string;
  pathname: string;
  search: string;
  bodyPath: string;
  projectionPath: string;
  requestPath: string;
  metaPath: string;
  mimeType: string;
  resourceType: string;
  capturedAt: string;
}

interface FixtureReadPageShape {
  path: string;
  sizeBytes: number;
  startByte: number;
  bytesReturned: number;
  maxBytes: number;
  truncated: boolean;
  nextCursor: string | null;
  text: string;
}

interface DogfoodToolMetric {
  label: string;
  tool: string;
  durationMs: number;
}

interface DogfoodBudget {
  label: string;
  maxDurationMs: number;
}

function readTextContent(result: unknown): string {
  if (
    !result ||
    typeof result !== "object" ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    throw new Error("Expected a CallTool content result.");
  }

  const entry = result.content.find(
    (item): item is { type: string; text?: string } =>
      Boolean(item) &&
      typeof item === "object" &&
      "type" in item &&
      typeof item.type === "string"
  );
  if (!entry?.text) {
    throw new Error("Expected text content.");
  }

  return entry.text;
}

function readJsonContent<T>(result: unknown): T {
  return JSON.parse(readTextContent(result)) as T;
}

async function callMeasuredJsonTool<T>(
  client: Client,
  metrics: DogfoodToolMetric[],
  {
    label,
    name,
    arguments: args
  }: {
    label: string;
    name: string;
    arguments: Record<string, unknown>;
  }
): Promise<T> {
  const start = performance.now();
  try {
    return readJsonContent<T>(
      await client.callTool({
        name,
        arguments: args
      })
    );
  } finally {
    metrics.push({
      label,
      tool: name,
      durationMs: performance.now() - start
    });
  }
}

function formatDurationMs(value: number): string {
  return `${Math.round(value)}ms`;
}

function formatMiB(value: number): string {
  return `${(value / (1024 * 1024)).toFixed(1)}MiB`;
}

function assertDogfoodBudgets({
  metrics,
  budgets,
  heapDeltaBytes,
  heapBudgetBytes,
  bundleSizeBytes
}: {
  metrics: DogfoodToolMetric[];
  budgets: DogfoodBudget[];
  heapDeltaBytes: number;
  heapBudgetBytes: number;
  bundleSizeBytes: number;
}): void {
  const failures: string[] = [];

  for (const budget of budgets) {
    const metric = metrics.find(
      (candidate) => candidate.label === budget.label
    );
    if (!metric) {
      failures.push(`${budget.label}: missing timing`);
      continue;
    }
    if (metric.durationMs > budget.maxDurationMs) {
      failures.push(
        `${budget.label}: ${formatDurationMs(metric.durationMs)} > ${formatDurationMs(
          budget.maxDurationMs
        )}`
      );
    }
  }

  const positiveHeapDeltaBytes = Math.max(0, heapDeltaBytes);
  if (positiveHeapDeltaBytes > heapBudgetBytes) {
    failures.push(
      `heap delta: ${formatMiB(positiveHeapDeltaBytes)} > ${formatMiB(
        heapBudgetBytes
      )}`
    );
  }

  if (failures.length === 0) {
    return;
  }

  const timings = [...metrics]
    .sort((a, b) => b.durationMs - a.durationMs)
    .map(
      (metric) =>
        `  ${metric.label} (${metric.tool}): ${formatDurationMs(
          metric.durationMs
        )}`
    )
    .join("\n");

  throw new Error(
    [
      "JS Intelligence dogfood performance budget exceeded.",
      `Bundle size: ${formatMiB(bundleSizeBytes)}`,
      `Heap delta: ${formatMiB(heapDeltaBytes)}`,
      "Failures:",
      ...failures.map((failure) => `  ${failure}`),
      "Timings:",
      timings
    ].join("\n")
  );
}

async function connectClient(rootPath: string) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "wraithwalker-js-intel-dogfood-client",
    version: "1.0.0"
  });

  const serverPromise = startServer(rootPath, { transport: serverTransport });
  await client.connect(clientTransport);
  const server = await serverPromise;

  return { client, server };
}

function makeScriptAsset({
  topOriginKey,
  projectionPath,
  requestUrl,
  capturedAt = "2026-04-25T00:00:00.000Z"
}: {
  topOriginKey: string;
  projectionPath: string;
  requestUrl: string;
  capturedAt?: string;
}): CapturedScriptAsset {
  const url = new URL(requestUrl);

  return {
    requestUrl,
    requestOrigin: url.origin,
    pathname: url.pathname,
    search: url.search,
    bodyPath: `.wraithwalker/captures/assets/${topOriginKey}/${projectionPath}.__body`,
    projectionPath,
    requestPath: `.wraithwalker/captures/assets/${topOriginKey}/${projectionPath}.__request.json`,
    metaPath: `.wraithwalker/captures/assets/${topOriginKey}/${projectionPath}.__response.json`,
    mimeType: "application/javascript",
    resourceType: "Script",
    capturedAt
  };
}

async function writeCapturedScript(
  root: WraithwalkerFixtureRoot,
  asset: CapturedScriptAsset,
  source: string,
  topOrigin = "https://shop.example.test"
): Promise<void> {
  await root.writeText(asset.bodyPath, source);
  await root.writeText(asset.projectionPath, source);
  await root.writeJson(asset.requestPath, {
    topOrigin,
    url: asset.requestUrl,
    method: "GET",
    headers: [],
    body: "",
    bodyEncoding: "utf8",
    bodyHash: `body-${asset.pathname}`,
    queryHash: "q-empty",
    capturedAt: asset.capturedAt
  });
  await root.writeJson(asset.metaPath, {
    status: 200,
    statusText: "OK",
    headers: [{ name: "Content-Type", value: asset.mimeType }],
    mimeType: asset.mimeType,
    resourceType: asset.resourceType,
    url: asset.requestUrl,
    method: "GET",
    capturedAt: asset.capturedAt,
    bodyEncoding: "utf8",
    bodySuggestedExtension: "js"
  });
}

async function readInstalledScript(packageSubpath: string): Promise<string> {
  return fs.readFile(requireFromTest.resolve(packageSubpath), "utf8");
}

async function createDogfoodFixtureRoot() {
  const root = await createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-js-intel-dogfood-",
    rootId: "root-js-intel-dogfood"
  });
  const topOrigin = "https://shop.example.test";
  const topOriginKey = root.originKey(topOrigin);

  const ordersChunk = makeScriptAsset({
    topOriginKey,
    projectionPath: "cdn.shop.example.test/assets/routes/orders.7f31.js",
    requestUrl: "https://cdn.shop.example.test/assets/routes/orders.7f31.js"
  });
  const dashboardChunk = makeScriptAsset({
    topOriginKey,
    projectionPath: "cdn.shop.example.test/assets/routes/dashboard.a19f.js",
    requestUrl: "https://cdn.shop.example.test/assets/routes/dashboard.a19f.js"
  });
  const vendorChunk = makeScriptAsset({
    topOriginKey,
    projectionPath: "cdn.shop.example.test/assets/vendor.noisy.js",
    requestUrl: "https://cdn.shop.example.test/assets/vendor.noisy.js"
  });

  await root.writeManifest({
    topOrigin,
    manifest: {
      schemaVersion: 2,
      topOrigin,
      topOriginKey,
      generatedAt: "2026-04-25T00:00:00.000Z",
      resourcesByPathname: {
        [ordersChunk.pathname]: [ordersChunk],
        [dashboardChunk.pathname]: [dashboardChunk],
        [vendorChunk.pathname]: [vendorChunk]
      }
    }
  });

  const ordersSource = `import{h as hydrate,t as track}from"../runtime.44d9.js";
const refreshSelector=".order-panel [data-testid=refresh]";
const rowSelector="[data-role=order-row]";
export function mountOrdersPage(root=document.querySelector("#orders-root")){
  const token=sessionStorage.getItem("csrf-token")||"";
  localStorage.setItem("ww:last-route","orders");
  function loadOrders(source="initial"){
    track("orders:load:start",{source,selector:refreshSelector});
    return fetch("/api/orders?include=lineItems",{headers:{"x-csrf":token}})
      .then((response)=>response.json())
      .then((payload)=>{
        const rows=document.querySelectorAll(rowSelector);
        chrome.runtime.sendMessage({type:"orders:loaded",count:payload.items.length});
        window.postMessage({type:"orders-ready",count:rows.length},"*");
        track("orders:load:done",{endpoint:"/api/orders?include=lineItems"});
        return payload;
      });
  }
  root?.querySelector(refreshSelector)?.addEventListener("click",()=>loadOrders("refresh"));
  return hydrate(root,{route:"orders",loadOrders});
}
${"//#"} sourceMappingURL=orders.7f31.js.map
`;
  const dashboardSource = `export const dashboardEndpoints={
  orders:"/api/orders/summary.json",
  inventory:"/api/inventory?format=json"
};
export function preloadDashboard(){
  return Promise.all([
    fetch(dashboardEndpoints.orders),
    fetch(dashboardEndpoints.inventory)
  ]);
}
${"//#"} sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==
`;
  const vendorSource = `const vendorTrackers=[
  "track:analytics:init",
  "track:analytics:queue",
  "track:analytics:flush",
  "track:ads:impression",
  "track:ads:conversion",
  "track:rum:paint"
];
export function bootVendorAnalytics(){
  vendorTrackers.forEach((event)=>globalThis.__analytics?.track(event));
  return vendorTrackers.map((event)=>event.toUpperCase()).join("|");
}
`;

  await writeCapturedScript(root, ordersChunk, ordersSource);
  await writeCapturedScript(root, dashboardChunk, dashboardSource);
  await writeCapturedScript(root, vendorChunk, vendorSource);

  return {
    root,
    paths: {
      orders: ordersChunk.projectionPath,
      dashboard: dashboardChunk.projectionPath,
      vendor: vendorChunk.projectionPath
    }
  };
}

async function createOpenSourceMinifiedFixtureRoot() {
  const root = await createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-js-intel-oss-minified-",
    rootId: "root-js-intel-oss-minified"
  });
  const topOrigin = "https://oss.example.test";
  const topOriginKey = root.originKey(topOrigin);

  const dayjsChunk = makeScriptAsset({
    topOriginKey,
    projectionPath: "cdn.oss.example.test/vendor/dayjs.min.js",
    requestUrl: "https://cdn.oss.example.test/vendor/dayjs.min.js"
  });
  const dompurifyChunk = makeScriptAsset({
    topOriginKey,
    projectionPath: "cdn.oss.example.test/vendor/purify.min.js",
    requestUrl: "https://cdn.oss.example.test/vendor/purify.min.js"
  });
  const reactIsChunk = makeScriptAsset({
    topOriginKey,
    projectionPath: "cdn.oss.example.test/vendor/react-is.production.min.js",
    requestUrl: "https://cdn.oss.example.test/vendor/react-is.production.min.js"
  });

  await root.writeManifest({
    topOrigin,
    manifest: {
      schemaVersion: 2,
      topOrigin,
      topOriginKey,
      generatedAt: "2026-04-25T00:00:00.000Z",
      resourcesByPathname: {
        [dayjsChunk.pathname]: [dayjsChunk],
        [dompurifyChunk.pathname]: [dompurifyChunk],
        [reactIsChunk.pathname]: [reactIsChunk]
      }
    }
  });

  await writeCapturedScript(
    root,
    dayjsChunk,
    await readInstalledScript("dayjs/dayjs.min.js"),
    topOrigin
  );
  await writeCapturedScript(
    root,
    dompurifyChunk,
    await readInstalledScript("dompurify/dist/purify.min.js"),
    topOrigin
  );
  await writeCapturedScript(
    root,
    reactIsChunk,
    await readInstalledScript("react-is/umd/react-is.production.min.js"),
    topOrigin
  );

  return {
    root,
    paths: {
      dayjs: dayjsChunk.projectionPath,
      dompurify: dompurifyChunk.projectionPath,
      reactIs: reactIsChunk.projectionPath
    }
  };
}

async function createHugeTextScanFixtureRoot() {
  const root = await createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-js-intel-huge-",
    rootId: "root-js-intel-huge"
  });
  const topOrigin = "https://huge.example.test";
  const topOriginKey = root.originKey(topOrigin);
  const hugeChunk = makeScriptAsset({
    topOriginKey,
    projectionPath: "cdn.huge.example.test/assets/app.huge.min.js",
    requestUrl: "https://cdn.huge.example.test/assets/app.huge.min.js"
  });

  await root.writeManifest({
    topOrigin,
    manifest: {
      schemaVersion: 2,
      topOrigin,
      topOriginKey,
      generatedAt: "2026-04-25T00:00:00.000Z",
      resourcesByPathname: {
        [hugeChunk.pathname]: [hugeChunk]
      }
    }
  });

  const boundaryPadding = "x".repeat(64 * 1024 - 24);
  const hugePadding = "y".repeat(6 * 1024 * 1024);
  const hugeSource = [
    "(()=>{",
    `/*${boundaryPadding}*/`,
    'fetch("/api/huge-boundary");',
    'document.querySelector(".huge-panel [data-testid=save]");',
    `/*${hugePadding}*/`,
    'chrome.runtime.sendMessage({type:"huge-ready"});',
    'window.postMessage("huge-finished","*");',
    'localStorage.setItem("huge-key","1");',
    "})();",
    "//# sourceMappingURL=app.huge.min.js.map"
  ].join("");
  await writeCapturedScript(root, hugeChunk, hugeSource, topOrigin);

  const apiFixture = await root.writeApiFixture({
    topOrigin,
    requestOrigin: "https://api.huge.example.test",
    method: "GET",
    fixtureName: "large-config__q-abc__b-def",
    meta: {
      status: 200,
      statusText: "OK",
      mimeType: "application/json",
      resourceType: "Fetch",
      url: "https://api.huge.example.test/large-config",
      method: "GET",
      capturedAt: "2026-04-25T00:00:00.000Z"
    },
    body: JSON.stringify({
      marker: "HUGE_API_START",
      payload: "z".repeat(96 * 1024),
      tail: "HUGE_API_TAIL"
    })
  });
  await root.writeText("cdn.huge.example.test/assets/small.js", "export{};\n");
  await fs.writeFile(
    root.resolve("cdn.huge.example.test/assets/font.woff2"),
    Buffer.from([0, 1, 2, 3])
  );

  return {
    root,
    topOrigin,
    apiFixture,
    paths: {
      huge: hugeChunk.projectionPath
    },
    hugeSource
  };
}

async function createRealWorldLargeBundleFixtureRoot() {
  const root = await createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-js-intel-real-bundle-",
    rootId: "root-js-intel-real-bundle"
  });
  const topOrigin = "https://real-bundles.example.test";
  const topOriginKey = root.originKey(topOrigin);
  const typescriptChunk = makeScriptAsset({
    topOriginKey,
    projectionPath: "cdn.real-bundles.example.test/vendor/typescript.js",
    requestUrl: "https://cdn.real-bundles.example.test/vendor/typescript.js"
  });

  await root.writeManifest({
    topOrigin,
    manifest: {
      schemaVersion: 2,
      topOrigin,
      topOriginKey,
      generatedAt: "2026-04-25T00:00:00.000Z",
      resourcesByPathname: {
        [typescriptChunk.pathname]: [typescriptChunk]
      }
    }
  });

  const typescriptSource = await readInstalledScript(
    "typescript/lib/typescript.js"
  );
  await writeCapturedScript(root, typescriptChunk, typescriptSource, topOrigin);

  return {
    root,
    topOrigin,
    paths: {
      typescript: typescriptChunk.projectionPath
    },
    typescriptSource
  };
}

describe("js intelligence MCP dogfood", () => {
  it("navigates realistic captured chunks through MCP semantic tools", async () => {
    const { root, paths } = await createDogfoodFixtureRoot();
    const { client, server } = await connectClient(root.rootPath);

    try {
      const analysis = readJsonContent<JsFileAnalysis>(
        await client.callTool({
          name: "analyze-js-file",
          arguments: { path: paths.orders }
        })
      );

      expect(analysis.parse).toEqual({
        ok: true,
        recovered: false,
        errors: []
      });
      expect(analysis.sourceMap).toEqual({
        url: "orders.7f31.js.map",
        kind: "external",
        line: 22
      });
      expect(analysis.summary.endpointStrings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: "/api/orders?include=lineItems"
          })
        ])
      );
      expect(analysis.summary.selectorStrings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: "#orders-root" }),
          expect.objectContaining({
            value: ".order-panel [data-testid=refresh]"
          }),
          expect.objectContaining({ value: "[data-role=order-row]" })
        ])
      );
      expect(analysis.summary.notableCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: "fetch",
            firstArgument: "/api/orders?include=lineItems"
          }),
          expect.objectContaining({ value: "window.postMessage" }),
          expect.objectContaining({ value: "chrome.runtime.sendMessage" }),
          expect.objectContaining({ value: "sessionStorage.getItem" }),
          expect.objectContaining({ value: "localStorage.setItem" })
        ])
      );
      expect(JSON.stringify(analysis)).not.toContain('"program"');

      const endpointSearch = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "lineItems",
            kind: "endpoint",
            limit: 5
          }
        })
      );
      expect(endpointSearch.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: paths.orders,
            kind: "endpoint",
            value: "/api/orders?include=lineItems",
            enclosingSymbol: "loadOrders"
          })
        ])
      );

      const selectorSearch = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "data-testid",
            kind: "selector",
            limit: 5
          }
        })
      );
      expect(selectorSearch.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: paths.orders,
            kind: "selector",
            value: ".order-panel [data-testid=refresh]"
          })
        ])
      );

      const callSearch = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "postMessage",
            kind: "call",
            limit: 5
          }
        })
      );
      expect(callSearch.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: paths.orders,
            kind: "call",
            value: "window.postMessage"
          })
        ])
      );

      const identifierSearch = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "mountOrdersPage",
            kind: "identifier",
            limit: 5
          }
        })
      );
      expect(identifierSearch.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: paths.orders,
            kind: "identifier",
            value: "mountOrdersPage"
          })
        ])
      );

      const stringSearch = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "track:analytics",
            kind: "string",
            limit: 5
          }
        })
      );
      expect(stringSearch.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: paths.vendor,
            kind: "string",
            value: "track:analytics:init"
          })
        ])
      );

      const noisyFirstPage = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "track",
            limit: 3
          }
        })
      );
      expect(noisyFirstPage.items).toHaveLength(3);
      expect(noisyFirstPage.nextCursor).not.toBeNull();

      const noisySecondPage = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "track",
            cursor: noisyFirstPage.nextCursor
          }
        })
      );
      expect(noisySecondPage.items.length).toBeGreaterThan(0);

      const narrowedCalls = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "track",
            kind: "call",
            pathContains: "routes/orders",
            limit: 10
          }
        })
      );
      expect(narrowedCalls.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: paths.orders,
            kind: "call",
            value: "track"
          })
        ])
      );
      expect(
        narrowedCalls.items.every((item) => item.path === paths.orders)
      ).toBe(true);

      const readResult = readJsonContent<JsSymbolReadResult>(
        await client.callTool({
          name: "read-js-symbol",
          arguments: {
            path: paths.orders,
            nodeId: endpointSearch.items[0]?.nodeId
          }
        })
      );
      expect(readResult).toEqual(
        expect.objectContaining({
          path: paths.orders,
          symbol: "loadOrders",
          nodeKind: "FunctionDeclaration",
          enclosingSymbol: "loadOrders",
          truncated: false
        })
      );
      expect(readResult.text).toContain("function loadOrders");
      expect(readResult.text).toContain(
        'fetch("/api/orders?include=lineItems"'
      );
      expect(readResult.text).not.toContain("bootVendorAnalytics");
      expect(JSON.stringify(readResult)).not.toContain('"program"');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("parses actual open-source minified browser builds as captured chunks", async () => {
    const { root, paths } = await createOpenSourceMinifiedFixtureRoot();
    const { client, server } = await connectClient(root.rootPath);

    try {
      const dayjsAnalysis = readJsonContent<JsFileAnalysis>(
        await client.callTool({
          name: "analyze-js-file",
          arguments: { path: paths.dayjs }
        })
      );
      expect(dayjsAnalysis.parse).toEqual({
        ok: true,
        recovered: false,
        errors: []
      });
      expect(dayjsAnalysis.size).toBeGreaterThan(1_000);
      expect(JSON.stringify(dayjsAnalysis)).not.toContain('"program"');

      const dompurifyAnalysis = readJsonContent<JsFileAnalysis>(
        await client.callTool({
          name: "analyze-js-file",
          arguments: { path: paths.dompurify }
        })
      );
      expect(dompurifyAnalysis.parse.ok).toBe(true);
      expect(dompurifyAnalysis.size).toBeGreaterThan(10_000);

      const reactIsAnalysis = readJsonContent<JsFileAnalysis>(
        await client.callTool({
          name: "analyze-js-file",
          arguments: { path: paths.reactIs }
        })
      );
      expect(reactIsAnalysis.parse.ok).toBe(true);

      const invalidDate = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "Invalid Date",
            kind: "string",
            pathContains: "dayjs",
            limit: 5
          }
        })
      );
      expect(invalidDate.items).toEqual([
        expect.objectContaining({
          path: paths.dayjs,
          kind: "string",
          value: "Invalid Date"
        })
      ]);

      const dayjsProperty = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "isDayjs",
            kind: "property",
            pathContains: "dayjs",
            limit: 5
          }
        })
      );
      expect(dayjsProperty.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: paths.dayjs,
            kind: "property",
            value: "isDayjs"
          })
        ])
      );

      const dompurifyProperty = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "DOMPurify",
            kind: "property",
            pathContains: "purify",
            limit: 5
          }
        })
      );
      expect(dompurifyProperty.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: paths.dompurify,
            kind: "property",
            value: "DOMPurify"
          })
        ])
      );

      const reactFragment = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "react.fragment",
            kind: "string",
            pathContains: "react-is",
            limit: 5
          }
        })
      );
      expect(reactFragment.items).toEqual([
        expect.objectContaining({
          path: paths.reactIs,
          kind: "string",
          value: "react.fragment"
        })
      ]);

      const readResult = readJsonContent<JsSymbolReadResult>(
        await client.callTool({
          name: "read-js-symbol",
          arguments: {
            path: paths.dayjs,
            nodeId: dayjsProperty.items[0]?.nodeId
          }
        })
      );
      expect(readResult).toEqual(
        expect.objectContaining({
          path: paths.dayjs,
          truncated: false
        })
      );
      expect(readResult.text).toContain("isDayjs");
      expect(JSON.stringify(readResult)).not.toContain('"program"');
    } finally {
      await client.close();
      await server.close();
    }
  }, 15_000);

  it("degrades huge captured JavaScript to text-scan mode through MCP", async () => {
    const { root, topOrigin, paths, apiFixture, hugeSource } =
      await createHugeTextScanFixtureRoot();
    const { client, server } = await connectClient(root.rootPath);

    try {
      const files = readJsonContent<{
        items: Array<{ path: string; bodySize: number | null }>;
      }>(
        await client.callTool({
          name: "list-files",
          arguments: {
            origin: topOrigin,
            pathnameContains: "app.huge"
          }
        })
      );
      expect(files.items).toEqual([
        expect.objectContaining({
          path: paths.huge,
          bodySize: Buffer.byteLength(hugeSource, "utf8")
        })
      ]);

      const fileSearch = readJsonContent<{
        items: Array<{ path: string; matchKind: string; matchCount: number }>;
      }>(
        await client.callTool({
          name: "search-files",
          arguments: {
            query: "/api/huge-boundary",
            pathContains: "app.huge"
          }
        })
      );
      expect(fileSearch.items).toEqual([
        expect.objectContaining({
          path: paths.huge,
          matchKind: "body",
          matchCount: 1
        })
      ]);

      const analysis = readJsonContent<JsFileAnalysis>(
        await client.callTool({
          name: "analyze-js-file",
          arguments: { path: paths.huge }
        })
      );
      expect(analysis).toEqual(
        expect.objectContaining({
          path: paths.huge,
          analysisMode: "text-scan",
          size: Buffer.byteLength(hugeSource, "utf8"),
          sourceMap: {
            url: "app.huge.min.js.map",
            kind: "external",
            line: 1
          }
        })
      );
      expect(analysis.parse).toEqual({
        ok: false,
        recovered: false,
        skipped: true,
        reason: "file-too-large",
        errors: []
      });
      expect(JSON.stringify(analysis)).not.toContain('"program"');

      const endpointSearch = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "huge-boundary",
            kind: "endpoint",
            pathContains: "app.huge"
          }
        })
      );
      expect(endpointSearch.items).toEqual([
        expect.objectContaining({
          path: paths.huge,
          kind: "endpoint",
          value: "/api/huge-boundary"
        })
      ]);

      const selectorSearch = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "data-testid",
            kind: "selector",
            pathContains: "app.huge"
          }
        })
      );
      expect(selectorSearch.items).toEqual([
        expect.objectContaining({
          path: paths.huge,
          kind: "selector",
          value: ".huge-panel [data-testid=save]"
        })
      ]);

      const callSearch = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "sendMessage",
            kind: "call",
            pathContains: "app.huge"
          }
        })
      );
      expect(callSearch.items).toEqual([
        expect.objectContaining({
          path: paths.huge,
          kind: "call",
          value: "chrome.runtime.sendMessage"
        })
      ]);

      const unsupportedSearch = readJsonContent<JsSearchResult>(
        await client.callTool({
          name: "search-js",
          arguments: {
            query: "huge",
            kind: "identifier",
            pathContains: "app.huge"
          }
        })
      );
      expect(unsupportedSearch.items).toEqual([]);
      expect(unsupportedSearch.skipped).toEqual([
        expect.objectContaining({
          path: paths.huge,
          reason: expect.stringContaining("Text-scan mode does not support")
        })
      ]);

      const snippet = readJsonContent<JsSymbolReadResult>(
        await client.callTool({
          name: "read-js-symbol",
          arguments: {
            path: paths.huge,
            nodeId: endpointSearch.items[0]?.nodeId
          }
        })
      );
      expect(snippet).toEqual(
        expect.objectContaining({
          path: paths.huge,
          nodeKind: "StringLiteral",
          startLine: 1,
          endLine: 1,
          truncated: true
        })
      );
      expect(snippet.text).toContain("/api/huge-boundary");
      expect(Buffer.byteLength(snippet.text, "utf8")).toBeLessThanOrEqual(
        32_000
      );

      const firstPage = readJsonContent<FixtureReadPageShape>(
        await client.callTool({
          name: "read-file",
          arguments: { path: paths.huge }
        })
      );
      expect(firstPage).toEqual(
        expect.objectContaining({
          path: paths.huge,
          bytesReturned: 32_768,
          maxBytes: 32_768,
          truncated: true,
          nextCursor: expect.any(String)
        })
      );

      const lineSnippet = readJsonContent<{
        path: string;
        startLine: number;
        truncated: boolean;
        text: string;
      }>(
        await client.callTool({
          name: "read-file-snippet",
          arguments: {
            path: paths.huge,
            startLine: 1,
            lineCount: 1,
            maxBytes: 1024
          }
        })
      );
      expect(lineSnippet).toEqual(
        expect.objectContaining({
          path: paths.huge,
          startLine: 1,
          truncated: true
        })
      );
      expect(Buffer.byteLength(lineSnippet.text, "utf8")).toBeLessThanOrEqual(
        1024
      );

      const apiResponse = readJsonContent<{
        body: FixtureReadPageShape | null;
      }>(
        await client.callTool({
          name: "read-api-response",
          arguments: { fixtureDir: apiFixture.fixtureDir }
        })
      );
      expect(apiResponse.body).toEqual(
        expect.objectContaining({
          path: apiFixture.bodyPath,
          bytesReturned: 32_768,
          truncated: true,
          nextCursor: expect.any(String)
        })
      );
    } finally {
      await client.close();
      await server.close();
    }
  }, 20_000);

  it("dogfoods a real-world huge npm bundle without full AST parsing", async () => {
    const { root, topOrigin, paths, typescriptSource } =
      await createRealWorldLargeBundleFixtureRoot();
    const { client, server } = await connectClient(root.rootPath);
    const metrics: DogfoodToolMetric[] = [];
    const bundleSizeBytes = Buffer.byteLength(typescriptSource, "utf8");
    const heapBeforeBytes = process.memoryUsage().heapUsed;

    try {
      const files = readJsonContent<{
        items: Array<{ path: string; bodySize: number | null }>;
      }>(
        await client.callTool({
          name: "list-files",
          arguments: {
            origin: topOrigin,
            pathnameContains: "typescript"
          }
        })
      );
      expect(files.items).toEqual([
        expect.objectContaining({
          path: paths.typescript,
          bodySize: bundleSizeBytes
        })
      ]);

      const analysis = await callMeasuredJsonTool<JsFileAnalysis>(
        client,
        metrics,
        {
          label: "analyze TypeScript bundle",
          name: "analyze-js-file",
          arguments: { path: paths.typescript }
        }
      );
      expect(analysis).toEqual(
        expect.objectContaining({
          path: paths.typescript,
          analysisMode: "text-scan",
          size: bundleSizeBytes
        })
      );
      expect(analysis.parse).toEqual({
        ok: false,
        recovered: false,
        skipped: true,
        reason: "file-too-large",
        errors: []
      });
      expect(JSON.stringify(analysis)).not.toContain('"program"');
      expect(JSON.stringify(analysis)).not.toContain("function createProgram");

      const deepFileSearch = await callMeasuredJsonTool<{
        items: Array<{
          path: string;
          matchKind: string;
          matchCount: number;
          excerpt: string;
        }>;
      }>(client, metrics, {
        label: "search-files createSourceFile",
        name: "search-files",
        arguments: {
          query: "createSourceFile",
          pathContains: "typescript"
        }
      });
      expect(deepFileSearch.items).toEqual([
        expect.objectContaining({
          path: paths.typescript,
          matchKind: "body",
          matchCount: expect.any(Number),
          excerpt: expect.stringContaining("createSourceFile")
        })
      ]);
      expect(deepFileSearch.items[0]?.matchCount).toBeGreaterThan(0);

      const stringSearch = await callMeasuredJsonTool<JsSearchResult>(
        client,
        metrics,
        {
          label: "search-js cached string",
          name: "search-js",
          arguments: {
            query: "use strict",
            kind: "string",
            pathContains: "typescript",
            limit: 5
          }
        }
      );
      expect(stringSearch.items).toEqual([
        expect.objectContaining({
          path: paths.typescript,
          kind: "string",
          value: "use strict"
        })
      ]);

      const unsupportedSearch = await callMeasuredJsonTool<JsSearchResult>(
        client,
        metrics,
        {
          label: "search-js unsupported identifier",
          name: "search-js",
          arguments: {
            query: "createSourceFile",
            kind: "identifier",
            pathContains: "typescript"
          }
        }
      );
      expect(unsupportedSearch.items).toEqual([]);
      expect(unsupportedSearch.skipped).toEqual([
        expect.objectContaining({
          path: paths.typescript,
          reason: expect.stringContaining("Text-scan mode does not support")
        })
      ]);

      const snippet = await callMeasuredJsonTool<JsSymbolReadResult>(
        client,
        metrics,
        {
          label: "read-js-symbol text-scan",
          name: "read-js-symbol",
          arguments: {
            path: paths.typescript,
            nodeId: stringSearch.items[0]?.nodeId
          }
        }
      );
      expect(snippet).toEqual(
        expect.objectContaining({
          path: paths.typescript,
          nodeKind: "StringLiteral",
          truncated: true
        })
      );
      expect(snippet.text).toContain("use strict");
      expect(Buffer.byteLength(snippet.text, "utf8")).toBeLessThanOrEqual(
        32_000
      );
      expect(snippet.text).not.toContain("function createProgram");

      const firstPage = await callMeasuredJsonTool<FixtureReadPageShape>(
        client,
        metrics,
        {
          label: "read-file first page",
          name: "read-file",
          arguments: { path: paths.typescript }
        }
      );
      expect(firstPage).toEqual(
        expect.objectContaining({
          path: paths.typescript,
          sizeBytes: bundleSizeBytes,
          bytesReturned: 32_768,
          maxBytes: 32_768,
          truncated: true,
          nextCursor: expect.any(String)
        })
      );
      expect(Buffer.byteLength(firstPage.text, "utf8")).toBeLessThanOrEqual(
        32_768
      );

      assertDogfoodBudgets({
        metrics,
        budgets: [
          { label: "analyze TypeScript bundle", maxDurationMs: 8_000 },
          { label: "search-files createSourceFile", maxDurationMs: 8_000 },
          { label: "search-js cached string", maxDurationMs: 2_000 },
          { label: "search-js unsupported identifier", maxDurationMs: 2_000 },
          { label: "read-js-symbol text-scan", maxDurationMs: 2_000 },
          { label: "read-file first page", maxDurationMs: 1_000 }
        ],
        heapDeltaBytes: process.memoryUsage().heapUsed - heapBeforeBytes,
        heapBudgetBytes: 512 * 1024 * 1024,
        bundleSizeBytes
      });
    } finally {
      await client.close();
      await server.close();
    }
  }, 15_000);
});
