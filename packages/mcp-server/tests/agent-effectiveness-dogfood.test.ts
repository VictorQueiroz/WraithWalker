import { promises as fs } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { StaticResourceManifest } from "@wraithwalker/core/fixtures";
import { describe, expect, it } from "vitest";

import type {
  JsFileAnalysis,
  JsPipelineTraceResult,
  JsSeedSuggestionResult,
  JsSearchResult,
  JsSymbolReadResult
} from "../src/js-intelligence.mts";
import { startServer } from "../src/server.mts";
import {
  assertAgentDogfoodBudgets,
  compactJsonByteLength,
  createAgentDogfoodRecorder,
  maybeEmitAgentDogfoodReport
} from "./agent-dogfood-benchmark.mts";
import {
  createWraithwalkerFixtureRoot,
  type WraithwalkerFixtureRoot
} from "../../../test-support/wraithwalker-fixture-root.mts";

// Agent effectiveness dogfood note: this suite intentionally does not call an
// LLM. It models the MCP workflow an agent should follow: discover, semantic
// search, read the smallest useful snippet/page, then inspect API bodies.

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

async function connectClient(rootPath: string) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "wraithwalker-agent-effectiveness-dogfood-client",
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
  capturedAt = "2026-04-28T00:00:00.000Z"
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
  topOrigin: string
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

async function createAgentBenchmarkRoot() {
  const root = await createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-agent-effectiveness-",
    rootId: "root-agent-effectiveness"
  });
  const topOrigin = "https://agent.example.test";
  const topOriginKey = root.originKey(topOrigin);

  const settingsChunk = makeScriptAsset({
    topOriginKey,
    projectionPath: "cdn.agent.example.test/assets/routes/settings.abc123.js",
    requestUrl:
      "https://cdn.agent.example.test/assets/routes/settings.abc123.js"
  });
  const billingChunk = makeScriptAsset({
    topOriginKey,
    projectionPath: "cdn.agent.example.test/assets/routes/billing.19f8.js",
    requestUrl: "https://cdn.agent.example.test/assets/routes/billing.19f8.js"
  });
  const hugeChunk = makeScriptAsset({
    topOriginKey,
    projectionPath: "cdn.agent.example.test/assets/chunks/mega-settings.js",
    requestUrl: "https://cdn.agent.example.test/assets/chunks/mega-settings.js"
  });

  const manifest: StaticResourceManifest = {
    schemaVersion: 2,
    topOrigin,
    topOriginKey,
    generatedAt: "2026-04-28T00:00:00.000Z",
    resourcesByPathname: {
      [settingsChunk.pathname]: [settingsChunk],
      [billingChunk.pathname]: [billingChunk],
      [hugeChunk.pathname]: [hugeChunk]
    }
  };
  await root.writeManifest({ topOrigin, manifest });

  const settingsSource = `import{renderRoute}from"../runtime.js";
export async function saveSettings(form=document.querySelector("#settings-form")){
  document.querySelector('[data-testid="settings-save"]')?.setAttribute("aria-busy","true");
  window.postMessage({type:"settings:saved"},"*");
  return fetch("/api/settings/profile",{method:"POST",body:new FormData(form)})
    .then((response)=>response.json());
}
export function mountSettingsRoute(root){
  root.querySelector('[data-testid="settings-save"]')?.addEventListener("click",()=>saveSettings());
  return renderRoute(root,{route:"settings"});
}
`;
  const billingSource = `export function mountBillingRoute(){
  return fetch("/api/billing/summary").then((response)=>response.json());
}
`;
  const hugeSource = [
    "(()=>{",
    'const megaEndpoint="/api/settings/mega";',
    'document.querySelector(".mega-settings [data-agent=save]");',
    "fetch(megaEndpoint);",
    `/*${"x".repeat(6 * 1024 * 1024)}*/`,
    'localStorage.setItem("agent:mega","seen");',
    'window.postMessage("mega-settings-ready","*");',
    "})();",
    "//# sourceMappingURL=mega-settings.js.map"
  ].join("");

  await writeCapturedScript(root, settingsChunk, settingsSource, topOrigin);
  await writeCapturedScript(root, billingChunk, billingSource, topOrigin);
  await writeCapturedScript(root, hugeChunk, hugeSource, topOrigin);
  await fs.writeFile(
    root.resolve("cdn.agent.example.test/assets/font.woff2"),
    Buffer.from([0, 1, 2, 3])
  );

  const settingsApiBody = JSON.stringify({
    marker: "AGENT_SETTINGS_API_START",
    profile: {
      id: "profile-1",
      mode: "agent-dogfood"
    },
    payload: "z".repeat(96 * 1024),
    tail: "AGENT_SETTINGS_API_TAIL"
  });
  const settingsApiFixture = await root.writeApiFixture({
    topOrigin,
    requestOrigin: "https://api.agent.example.test",
    method: "POST",
    fixtureName: "settings-profile__q-none__b-form",
    meta: {
      status: 200,
      statusText: "OK",
      mimeType: "application/json",
      resourceType: "Fetch",
      url: "https://api.agent.example.test/api/settings/profile",
      method: "POST",
      capturedAt: "2026-04-28T00:00:00.000Z"
    },
    body: settingsApiBody
  });

  return {
    root,
    topOrigin,
    paths: {
      settings: settingsChunk.projectionPath,
      billing: billingChunk.projectionPath,
      huge: hugeChunk.projectionPath
    },
    sizes: {
      huge: Buffer.byteLength(hugeSource, "utf8"),
      settingsApiBody: Buffer.byteLength(settingsApiBody, "utf8")
    },
    settingsApiFixture
  };
}

describe("agent effectiveness MCP dogfood", () => {
  it("solves capture-navigation tasks with bounded context and few tool calls", async () => {
    const { root, topOrigin, paths, sizes, settingsApiFixture } =
      await createAgentBenchmarkRoot();
    const { client, server } = await connectClient(root.rootPath);
    const recorder = createAgentDogfoodRecorder({
      name: "Agent effectiveness",
      client
    });

    try {
      const sites = await recorder.callJsonTool<Array<{ origin: string }>>({
        task: "discover",
        label: "list-sites",
        name: "list-sites",
        arguments: {}
      });
      expect(sites).toEqual([
        expect.objectContaining({
          origin: topOrigin
        })
      ]);

      const settingsFiles = await recorder.callJsonTool<{
        items: Array<{ path: string; bodySize: number | null }>;
      }>({
        task: "discover",
        label: "find settings route chunk",
        name: "list-files",
        arguments: {
          origin: topOrigin,
          pathnameContains: "settings"
        }
      });
      expect(settingsFiles.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: paths.settings
          })
        ])
      );

      const routeSeeds = await recorder.callJsonTool<JsSeedSuggestionResult>({
        task: "seed-discovery",
        label: "suggest route seeds",
        name: "suggest-js-seeds",
        arguments: {
          origin: topOrigin,
          pathContains: "settings",
          kinds: ["endpoint", "selector", "call", "string"],
          limit: 20
        }
      });
      const endpointSeed = routeSeeds.items.find(
        (item) =>
          item.kind === "endpoint" && item.value === "/api/settings/profile"
      );
      const selectorSeed = routeSeeds.items.find(
        (item) =>
          item.kind === "selector" &&
          item.value === '[data-testid="settings-save"]'
      );
      const callSeed = routeSeeds.items.find((item) => item.kind === "call");
      recorder.observe({
        kind: "seed-discovery",
        label: "route actionable seeds",
        passed: Boolean(endpointSeed && selectorSeed && callSeed),
        details: {
          totalMatched: routeSeeds.totalMatched,
          endpoint: Boolean(endpointSeed),
          selector: Boolean(selectorSeed),
          call: Boolean(callSeed)
        }
      });
      expect(endpointSeed).toEqual(
        expect.objectContaining({
          path: paths.settings,
          kind: "endpoint",
          value: "/api/settings/profile",
          apiResponseLink: expect.objectContaining({
            matchStatus: "matched",
            fixtureDir: settingsApiFixture.fixtureDir,
            bodyPath: settingsApiFixture.bodyPath
          })
        })
      );
      expect(selectorSeed).toEqual(
        expect.objectContaining({
          path: paths.settings,
          kind: "selector",
          value: '[data-testid="settings-save"]'
        })
      );
      expect(callSeed).toEqual(
        expect.objectContaining({
          path: paths.settings,
          kind: "call"
        })
      );
      if (!endpointSeed || !selectorSeed) {
        throw new Error("Expected route seed discovery to find core seeds.");
      }

      const endpointSearch = await recorder.callJsonTool<JsSearchResult>({
        task: "route-endpoint",
        label: "semantic endpoint search",
        name: "search-js",
        arguments: {
          query: endpointSeed.value,
          kind: "endpoint",
          pathContains: "settings",
          limit: 5
        }
      });
      expect(endpointSearch.items).toEqual([
        expect.objectContaining({
          path: paths.settings,
          value: "/api/settings/profile",
          enclosingSymbol: "saveSettings"
        })
      ]);

      const routeSnippet = await recorder.callJsonTool<JsSymbolReadResult>({
        task: "route-endpoint",
        label: "read endpoint function",
        name: "read-js-symbol",
        arguments: {
          path: paths.settings,
          nodeId: endpointSearch.items[0]?.nodeId
        }
      });
      expect(routeSnippet).toEqual(
        expect.objectContaining({
          path: paths.settings,
          symbol: "saveSettings",
          nodeKind: "FunctionDeclaration",
          truncated: false
        })
      );
      expect(routeSnippet.text).toContain("async function saveSettings");
      expect(routeSnippet.text).toContain("/api/settings/profile");
      recorder.observe({
        kind: "symbol-read-usefulness",
        label: "route endpoint snippet",
        passed:
          routeSnippet.symbol === "saveSettings" &&
          !routeSnippet.truncated &&
          routeSnippet.text.includes("/api/settings/profile"),
        details: {
          bytes: Buffer.byteLength(routeSnippet.text, "utf8"),
          truncated: routeSnippet.truncated
        }
      });

      const selectorSearch = await recorder.callJsonTool<JsSearchResult>({
        task: "route-selector",
        label: "semantic selector search",
        name: "search-js",
        arguments: {
          query: selectorSeed.value,
          kind: "selector",
          pathContains: "settings",
          limit: 5
        }
      });
      expect(selectorSearch.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: paths.settings,
            value: '[data-testid="settings-save"]',
            enclosingSymbol: "saveSettings"
          })
        ])
      );

      const routeTrace = await recorder.callJsonTool<JsPipelineTraceResult>({
        task: "pipeline",
        label: "trace discovered endpoint",
        name: "trace-js-pipeline",
        arguments: {
          seed: endpointSeed.value,
          kind: "endpoint",
          origin: topOrigin,
          pathContains: "settings",
          limit: 5
        }
      });
      const highConfidenceTrace = routeTrace.items.find(
        (item) =>
          item.confidence === "high" &&
          item.path === paths.settings &&
          item.steps.some(
            (step) =>
              step.kind === "api-response" &&
              step.fixtureDir === settingsApiFixture.fixtureDir
          )
      );
      recorder.observe({
        kind: "trace-usefulness",
        label: "endpoint to captured response",
        passed: Boolean(highConfidenceTrace),
        details: {
          totalMatched: routeTrace.totalMatched,
          compactBytes: compactJsonByteLength(routeTrace)
        }
      });
      expect(highConfidenceTrace).toEqual(
        expect.objectContaining({
          confidence: "high",
          path: paths.settings,
          apiResponseLinks: [
            expect.objectContaining({
              matchStatus: "matched",
              fixtureDir: settingsApiFixture.fixtureDir,
              bodyPath: settingsApiFixture.bodyPath
            })
          ]
        })
      );
      const linkedApiResponse = highConfidenceTrace?.apiResponseLinks.find(
        (link) => link.matchStatus === "matched"
      );
      expect(linkedApiResponse).toEqual(
        expect.objectContaining({
          fixtureDir: settingsApiFixture.fixtureDir,
          bodyPath: settingsApiFixture.bodyPath
        })
      );

      const endpoints = await recorder.callJsonTool<{
        items: Array<{
          method: string;
          pathname: string;
          fixtureDir: string;
          bodyPath: string;
        }>;
      }>({
        task: "api-response",
        label: "list captured API routes",
        name: "list-api-routes",
        arguments: { origin: topOrigin }
      });
      const settingsEndpoint = endpoints.items.find(
        (endpoint) => endpoint.pathname === "/api/settings/profile"
      );
      expect(settingsEndpoint).toEqual(
        expect.objectContaining({
          method: "POST",
          fixtureDir: settingsApiFixture.fixtureDir
        })
      );

      const apiResponse = await recorder.callJsonTool<{
        fixtureDir: string;
        body: FixtureReadPageShape | null;
      }>({
        task: "api-response",
        label: "read bounded API body",
        name: "read-api-response",
        arguments: { fixtureDir: linkedApiResponse?.fixtureDir }
      });
      expect(apiResponse).toEqual(
        expect.objectContaining({
          fixtureDir: settingsApiFixture.fixtureDir,
          body: expect.objectContaining({
            path: settingsApiFixture.bodyPath,
            sizeBytes: sizes.settingsApiBody,
            bytesReturned: 32_768,
            truncated: true,
            nextCursor: expect.any(String)
          })
        })
      );
      expect(apiResponse.body?.text).toContain("AGENT_SETTINGS_API_START");
      expect(apiResponse.body?.text).not.toContain("AGENT_SETTINGS_API_TAIL");

      const hugeFiles = await recorder.callJsonTool<{
        items: Array<{ path: string; bodySize: number | null }>;
      }>({
        task: "huge-js",
        label: "find huge chunk",
        name: "list-files",
        arguments: {
          origin: topOrigin,
          pathnameContains: "mega-settings"
        }
      });
      expect(hugeFiles.items).toEqual([
        expect.objectContaining({
          path: paths.huge,
          bodySize: sizes.huge
        })
      ]);

      const hugeAnalysis = await recorder.callJsonTool<JsFileAnalysis>({
        task: "huge-js",
        label: "analyze huge chunk",
        name: "analyze-js-file",
        arguments: { path: paths.huge }
      });
      expect(hugeAnalysis).toEqual(
        expect.objectContaining({
          path: paths.huge,
          analysisMode: "text-scan",
          size: sizes.huge,
          sourceMap: expect.objectContaining({
            url: "mega-settings.js.map"
          })
        })
      );
      expect(hugeAnalysis.parse).toEqual({
        ok: false,
        recovered: false,
        skipped: true,
        reason: "file-too-large",
        errors: []
      });

      const hugeSeeds = await recorder.callJsonTool<JsSeedSuggestionResult>({
        task: "seed-discovery",
        label: "suggest huge seeds",
        name: "suggest-js-seeds",
        arguments: {
          origin: topOrigin,
          pathContains: "mega-settings",
          kinds: ["endpoint", "selector", "call", "string"],
          limit: 20
        }
      });
      const hugeEndpointSeed = hugeSeeds.items.find(
        (item) =>
          item.kind === "endpoint" && item.value === "/api/settings/mega"
      );
      recorder.observe({
        kind: "seed-discovery",
        label: "huge text-scan seeds",
        passed: Boolean(
          hugeEndpointSeed &&
          hugeSeeds.items.some((item) => item.analysisMode === "text-scan")
        ),
        details: {
          totalMatched: hugeSeeds.totalMatched,
          textScanItems: hugeSeeds.items.filter(
            (item) => item.analysisMode === "text-scan"
          ).length
        }
      });
      expect(hugeEndpointSeed).toEqual(
        expect.objectContaining({
          path: paths.huge,
          kind: "endpoint",
          analysisMode: "text-scan"
        })
      );
      if (!hugeEndpointSeed) {
        throw new Error(
          "Expected huge text-scan seed discovery to find endpoint."
        );
      }

      const hugeEndpointSearch = await recorder.callJsonTool<JsSearchResult>({
        task: "huge-js",
        label: "semantic huge endpoint search",
        name: "search-js",
        arguments: {
          query: hugeEndpointSeed.value,
          kind: "endpoint",
          pathContains: "mega-settings",
          limit: 5
        }
      });
      expect(hugeEndpointSearch.items).toEqual([
        expect.objectContaining({
          path: paths.huge,
          value: "/api/settings/mega"
        })
      ]);

      const hugeSnippet = await recorder.callJsonTool<JsSymbolReadResult>({
        task: "huge-js",
        label: "read huge text-scan snippet",
        name: "read-js-symbol",
        arguments: {
          path: paths.huge,
          nodeId: hugeEndpointSearch.items[0]?.nodeId
        }
      });
      expect(hugeSnippet).toEqual(
        expect.objectContaining({
          path: paths.huge,
          nodeKind: "StringLiteral",
          truncated: true
        })
      );
      expect(hugeSnippet.text).toContain("/api/settings/mega");
      expect(Buffer.byteLength(hugeSnippet.text, "utf8")).toBeLessThanOrEqual(
        32_000
      );
      recorder.observe({
        kind: "symbol-read-usefulness",
        label: "huge text-scan snippet",
        passed:
          hugeSnippet.truncated &&
          hugeSnippet.text.includes("/api/settings/mega") &&
          Buffer.byteLength(hugeSnippet.text, "utf8") <= 32_000,
        details: {
          bytes: Buffer.byteLength(hugeSnippet.text, "utf8"),
          truncated: hugeSnippet.truncated
        }
      });

      const hugePage = await recorder.callJsonTool<FixtureReadPageShape>({
        task: "huge-js",
        label: "bounded huge read",
        name: "read-file",
        arguments: { path: paths.huge }
      });
      expect(hugePage).toEqual(
        expect.objectContaining({
          path: paths.huge,
          sizeBytes: sizes.huge,
          bytesReturned: 32_768,
          maxBytes: 32_768,
          truncated: true,
          nextCursor: expect.any(String)
        })
      );
      expect(hugePage.text).not.toContain("mega-settings-ready");
      recorder.observe({
        kind: "huge-bundle-safety",
        label: "huge text-scan and bounded read",
        passed:
          hugeAnalysis.analysisMode === "text-scan" &&
          hugeAnalysis.parse.skipped === true &&
          hugePage.truncated &&
          hugePage.bytesReturned === 32_768,
        details: {
          sizeBytes: sizes.huge,
          pageBytes: hugePage.bytesReturned
        }
      });

      const report = recorder.buildReport();
      assertAgentDogfoodBudgets(report, {
        maxToolCalls: 18,
        maxReturnedBytes: 320 * 1024,
        maxElapsedMs: 10_000,
        maxTruncatedCalls: 4,
        minQuality: {
          "seed-discovery": 2,
          "trace-usefulness": 1,
          "symbol-read-usefulness": 2,
          "huge-bundle-safety": 1
        }
      });
      await maybeEmitAgentDogfoodReport(report);
    } finally {
      await client.close();
      await server.close();
    }
  }, 10_000);

  it("traces JavaScript pipelines through MCP using compact evidence", async () => {
    const { root, topOrigin, paths, settingsApiFixture } =
      await createAgentBenchmarkRoot();
    const { client, server } = await connectClient(root.rootPath);
    const recorder = createAgentDogfoodRecorder({
      name: "Agent pipeline trace",
      client
    });

    try {
      const selectorTrace = await recorder.callJsonTool<JsPipelineTraceResult>({
        task: "pipeline",
        label: "trace selector pipeline",
        name: "trace-js-pipeline",
        arguments: {
          seed: "settings-save",
          kind: "selector",
          origin: topOrigin,
          pathContains: "settings",
          limit: 5
        }
      });
      expect(selectorTrace.items[0]).toEqual(
        expect.objectContaining({
          confidence: "high",
          path: paths.settings,
          analysisMode: "ast",
          apiResponseLinks: [
            expect.objectContaining({
              matchStatus: "matched",
              fixtureDir: settingsApiFixture.fixtureDir,
              bodyPath: settingsApiFixture.bodyPath,
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
            fixtureDir: settingsApiFixture.fixtureDir,
            bodyPath: settingsApiFixture.bodyPath
          })
        ])
      );

      const endpointTrace = await recorder.callJsonTool<JsPipelineTraceResult>({
        task: "pipeline",
        label: "trace endpoint pipeline",
        name: "trace-js-pipeline",
        arguments: {
          seed: "/api/settings/profile",
          kind: "endpoint",
          origin: topOrigin,
          pathContains: "settings",
          limit: 5
        }
      });
      expect(endpointTrace.items[0]).toEqual(
        expect.objectContaining({
          confidence: "high",
          path: paths.settings
        })
      );
      expect(endpointTrace.items[0]?.summary).toContain(
        "captured POST /api/settings/profile"
      );

      const hugeTrace = await recorder.callJsonTool<JsPipelineTraceResult>({
        task: "pipeline",
        label: "trace huge endpoint pipeline",
        name: "trace-js-pipeline",
        arguments: {
          seed: "/api/settings/mega",
          kind: "endpoint",
          origin: topOrigin,
          pathContains: "mega-settings",
          limit: 5
        }
      });
      expect(hugeTrace.items).toEqual([
        expect.objectContaining({
          confidence: "low",
          path: paths.huge,
          analysisMode: "text-scan",
          apiResponseLinks: [
            expect.objectContaining({
              matchStatus: "no-match",
              pathname: "/api/settings/mega",
              reason: "no-captured-api-response-match"
            })
          ],
          warnings: expect.arrayContaining([
            expect.stringContaining("text-scan mode"),
            expect.stringContaining("No captured API response metadata")
          ])
        })
      ]);
      expect(hugeTrace.items[0]?.steps).toEqual([
        expect.objectContaining({
          kind: "endpoint",
          value: "/api/settings/mega"
        })
      ]);

      const serialized = JSON.stringify([
        selectorTrace,
        endpointTrace,
        hugeTrace
      ]);
      expect(serialized).not.toContain('"program"');
      expect(serialized).not.toContain("AGENT_SETTINGS_API_START");
      expect(Buffer.byteLength(serialized, "utf8")).toBeLessThan(32 * 1024);
    } finally {
      await client.close();
      await server.close();
    }
  }, 10_000);
});
