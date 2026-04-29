import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";

import type {
  JsFileAnalysis,
  JsPipelineTraceResult,
  JsSeedSuggestion,
  JsSeedSuggestionResult,
  JsSearchKind,
  JsSearchResult,
  JsSymbolReadResult
} from "../src/js-intelligence.mts";
import { startHttpServer } from "../src/server.mts";
import {
  assertAgentDogfoodBudgets,
  compactJsonByteLength,
  createAgentDogfoodRecorder,
  maybeEmitAgentDogfoodReport,
  type AgentDogfoodRecorder
} from "./agent-dogfood-benchmark.mts";

// Live dogfood note: this suite is intentionally opt-in because it exercises a
// private/local capture root. Once enabled, it behaves like an agent: after
// server startup all corpus discovery and inspection happens through MCP tools.

const liveRoot = process.env.WRAITHWALKER_LIVE_DOGFOOD_ROOT;
const denylistFile = process.env.WRAITHWALKER_LIVE_DOGFOOD_DENYLIST_FILE;
const describeLive = liveRoot ? describe : describe.skip;

const EXPECTED_TOOLS = [
  "analyze-js-file",
  "list-files",
  "list-sites",
  "read-file",
  "read-file-snippet",
  "read-js-symbol",
  "search-files",
  "search-js",
  "suggest-js-seeds",
  "trace-js-pipeline"
];

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../..");
const DENYLIST_SCAN_PATHS = [
  path.relative(REPO_ROOT, fileURLToPath(import.meta.url)),
  "docs/packages/mcp-server.mdx"
];
const MIN_LIVE_ORIGINS = 2;
const MIN_LIVE_SCRIPT_COUNT = 5;
const MIN_MEDIUM_SCRIPT_BYTES = 64 * 1024;
const JS_PARSE_BUDGET_BYTES = 256 * 1024;
const MAX_RETURNED_BYTES = 2 * 1024 * 1024;
const MAX_SINGLE_RESPONSE_BYTES = 512 * 1024;
const MAX_SINGLE_TOOL_DURATION_MS = 30_000;
const MAX_ELAPSED_MS = 120_000;
const MAX_HEAP_DELTA_BYTES = 512 * 1024 * 1024;

interface SiteSummary {
  origin: string;
  manifestPath: string | null;
  apiEndpoints: number;
  staticAssets: number;
}

interface FileListItem {
  origin: string;
  path: string;
  pathname: string;
  mimeType: string | null;
  resourceType: string | null;
  bodySize: number | null;
  displaySizeBytes: number | null;
  hasBody: boolean;
  canonicalPath: string | null;
}

interface FileListResult {
  matchedOrigins: string[];
  items: FileListItem[];
  totalMatched: number;
  nextCursor: string | null;
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

interface FileSnippetShape {
  path: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
  text: string;
}

interface SearchFilesResult {
  matchedOrigins: string[];
  items: Array<{
    path: string;
    matchKind: string;
    matchCount: number;
    excerpt: string;
  }>;
  totalMatched: number;
  nextCursor: string | null;
}

async function assertNoDenylistedTerms(): Promise<void> {
  if (!denylistFile) {
    return;
  }

  const denylistText = await fs.readFile(denylistFile, "utf8");
  const terms = denylistText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (terms.length === 0) {
    return;
  }

  const violations: Array<{ relativePath: string; count: number }> = [];
  for (const relativePath of DENYLIST_SCAN_PATHS) {
    const text = await fs.readFile(path.join(REPO_ROOT, relativePath), "utf8");
    const count = terms.reduce(
      (total, term) => total + (text.includes(term) ? 1 : 0),
      0
    );
    if (count > 0) {
      violations.push({ relativePath, count });
    }
  }

  if (violations.length === 0) {
    return;
  }

  throw new Error(
    [
      "Live dogfood denylist matched checked-in files.",
      ...violations.map(
        (violation) =>
          `  ${violation.relativePath}: ${violation.count} denied term(s)`
      )
    ].join("\n")
  );
}

async function collectScripts(
  recorder: AgentDogfoodRecorder,
  sites: SiteSummary[]
): Promise<FileListItem[]> {
  const scripts: FileListItem[] = [];

  for (const [siteIndex, site] of sites.entries()) {
    let pageIndex = 0;
    let cursor: string | undefined;
    do {
      const result = await recorder.callJsonTool<FileListResult>({
        task: "discover",
        label: `list script files origin ${siteIndex + 1} page ${
          pageIndex + 1
        }`,
        name: "list-files",
        arguments: {
          origin: site.origin,
          resourceTypes: ["Script"],
          limit: 200,
          ...(cursor ? { cursor } : {})
        }
      });
      scripts.push(
        ...result.items.map((item) => ({ ...item, origin: site.origin }))
      );
      cursor = result.nextCursor ?? undefined;
      pageIndex += 1;
    } while (cursor);
  }

  return scripts;
}

function readableSize(script: FileListItem): number {
  return script.displaySizeBytes ?? script.bodySize ?? 0;
}

function byReadableSizeDescending(
  left: FileListItem,
  right: FileListItem
): number {
  return readableSize(right) - readableSize(left);
}

function byReadableSizeAscending(
  left: FileListItem,
  right: FileListItem
): number {
  return (
    (readableSize(left) || Number.POSITIVE_INFINITY) -
    (readableSize(right) || Number.POSITIVE_INFINITY)
  );
}

function pathToken(script: Pick<FileListItem, "path">): string {
  return path.basename(script.path);
}

function selectRequiredScript<T extends FileListItem | undefined>(
  script: T,
  label: string
): Exclude<T, undefined> {
  if (!script) {
    throw new Error(`Live dogfood could not select ${label}.`);
  }
  return script as Exclude<T, undefined>;
}

function selectRequiredJsMatch(
  result: JsSearchResult,
  label: string
): JsSearchResult["items"][number] {
  const item = result.items[0];
  if (!item) {
    throw new Error(`Live dogfood could not select ${label}.`);
  }
  return item;
}

function isNumericDotSelector(value: string): boolean {
  return /^\.\d/.test(value.trim());
}

async function findSearchFilesMatch(
  recorder: AgentDogfoodRecorder,
  {
    label,
    pathContains,
    queries
  }: {
    label: string;
    pathContains?: string;
    queries: string[];
  }
): Promise<{ query: string; result: SearchFilesResult }> {
  for (const [queryIndex, query] of queries.entries()) {
    const result = await recorder.callJsonTool<SearchFilesResult>({
      task: "search-files",
      label: `${label} candidate ${queryIndex + 1}`,
      name: "search-files",
      arguments: {
        query,
        ...(pathContains ? { pathContains } : {}),
        limit: 5
      }
    });
    if (result.items.length > 0) {
      return { query, result };
    }
  }

  throw new Error(
    `Expected search-files to find at least one match for ${label}.`
  );
}

async function findOptionalJsSearchMatch(
  recorder: AgentDogfoodRecorder,
  {
    label,
    pathContains,
    queries,
    kind
  }: {
    label: string;
    pathContains?: string;
    queries: string[];
    kind?: JsSearchKind;
  }
): Promise<{ query: string; result: JsSearchResult } | null> {
  for (const [queryIndex, query] of queries.entries()) {
    const result = await recorder.callJsonTool<JsSearchResult>({
      task: "search-js",
      label: `${label} candidate ${queryIndex + 1}`,
      name: "search-js",
      arguments: {
        query,
        ...(kind ? { kind } : {}),
        ...(pathContains ? { pathContains } : {}),
        limit: 5
      }
    });
    if (result.items.length > 0) {
      return { query, result };
    }
  }

  return null;
}

async function findJsSearchMatch(
  recorder: AgentDogfoodRecorder,
  options: {
    label: string;
    pathContains?: string;
    queries: string[];
    kind?: JsSearchKind;
  }
): Promise<{ query: string; result: JsSearchResult }> {
  const result = await findOptionalJsSearchMatch(recorder, options);
  if (result) {
    return result;
  }

  throw new Error(
    `Expected search-js to find at least one ${options.label} match.`
  );
}

function selectSeed(
  seeds: JsSeedSuggestionResult,
  {
    kind,
    analysisMode
  }: {
    kind?: JsSeedSuggestion["kind"];
    analysisMode?: JsSeedSuggestion["analysisMode"];
  } = {}
): JsSeedSuggestion | null {
  return (
    seeds.items.find(
      (item) =>
        !item.valueTruncated &&
        Boolean(item.nodeId) &&
        (!kind || item.kind === kind) &&
        (!analysisMode || item.analysisMode === analysisMode)
    ) ?? null
  );
}

describeLive("live MCP agent dogfood benchmark", () => {
  it("navigates a real capture corpus through the HTTP MCP surface", async () => {
    const rootPath = liveRoot;
    if (!rootPath) {
      throw new Error("WRAITHWALKER_LIVE_DOGFOOD_ROOT is required.");
    }

    await assertNoDenylistedTerms();

    const heapBefore = process.memoryUsage().heapUsed;
    const server = await startHttpServer(rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const client = new Client({
      name: "wraithwalker-live-agent-dogfood-client",
      version: "1.0.0"
    });
    const recorder = createAgentDogfoodRecorder({
      name: "Live MCP agent",
      client,
      requestTimeoutMs: 90_000
    });

    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(server.url))
      );

      const toolNames = await recorder.measureJson({
        task: "discover",
        label: "list MCP tools",
        tool: "listTools",
        async run() {
          const { tools } = await client.listTools();
          return tools.map((tool) => tool.name).sort();
        }
      });
      expect(toolNames).toEqual(expect.arrayContaining(EXPECTED_TOOLS));

      const sites = await recorder.callJsonTool<SiteSummary[]>({
        task: "discover",
        label: "list captured sites",
        name: "list-sites",
        arguments: {}
      });
      expect(sites.length).toBeGreaterThanOrEqual(MIN_LIVE_ORIGINS);
      expect(sites.some((site) => site.staticAssets > 0)).toBe(true);

      const scripts = await collectScripts(recorder, sites);
      expect(scripts.length).toBeGreaterThanOrEqual(MIN_LIVE_SCRIPT_COUNT);

      const scriptsWithBodies = scripts.filter(
        (script) => script.hasBody && readableSize(script) > 0
      );
      expect(scriptsWithBodies.length).toBeGreaterThan(0);

      const hugeScript = selectRequiredScript(
        [...scriptsWithBodies]
          .filter((script) => readableSize(script) > JS_PARSE_BUDGET_BYTES)
          .sort(byReadableSizeDescending)[0],
        "an oversized script"
      );
      const mediumScript = selectRequiredScript(
        [...scriptsWithBodies]
          .filter(
            (script) =>
              readableSize(script) >= MIN_MEDIUM_SCRIPT_BYTES &&
              readableSize(script) <= JS_PARSE_BUDGET_BYTES
          )
          .sort(byReadableSizeDescending)[0],
        "a medium AST-mode script"
      );
      const smallScript = selectRequiredScript(
        [...scriptsWithBodies].sort(byReadableSizeAscending)[0],
        "a small readable script"
      );

      expect(readableSize(hugeScript)).toBeGreaterThan(JS_PARSE_BUDGET_BYTES);
      expect(readableSize(mediumScript)).toBeGreaterThanOrEqual(
        MIN_MEDIUM_SCRIPT_BYTES
      );
      expect(readableSize(mediumScript)).toBeLessThanOrEqual(
        JS_PARSE_BUDGET_BYTES
      );

      const hugeToken = pathToken(hugeScript);
      const mediumToken = pathToken(mediumScript);
      const smallToken = pathToken(smallScript);

      const hugeSeeds = await recorder.callJsonTool<JsSeedSuggestionResult>({
        task: "seed-discovery",
        label: "suggest huge bundle seeds",
        name: "suggest-js-seeds",
        arguments: {
          pathContains: hugeToken,
          kinds: ["endpoint", "selector", "call", "string"],
          limit: 30
        }
      });
      const mediumSeeds = await recorder.callJsonTool<JsSeedSuggestionResult>({
        task: "seed-discovery",
        label: "suggest medium bundle seeds",
        name: "suggest-js-seeds",
        arguments: {
          pathContains: mediumToken,
          kinds: ["endpoint", "selector", "call", "string"],
          limit: 30
        }
      });
      const smallSeeds = await recorder.callJsonTool<JsSeedSuggestionResult>({
        task: "seed-discovery",
        label: "suggest small bundle seeds",
        name: "suggest-js-seeds",
        arguments: {
          pathContains: smallToken,
          kinds: ["endpoint", "selector", "call", "string"],
          limit: 20
        }
      });
      const actionableSeed =
        selectSeed(mediumSeeds, { analysisMode: "ast" }) ??
        selectSeed(smallSeeds) ??
        selectSeed(hugeSeeds);
      const endpointSuggestion =
        selectSeed(hugeSeeds, { kind: "endpoint" }) ??
        selectSeed(mediumSeeds, { kind: "endpoint" }) ??
        selectSeed(smallSeeds, { kind: "endpoint" });
      recorder.observe({
        kind: "seed-discovery",
        label: "live narrowed seed suggestions",
        passed: Boolean(actionableSeed),
        details: {
          hugeItems: hugeSeeds.items.length,
          mediumItems: mediumSeeds.items.length,
          smallItems: smallSeeds.items.length,
          endpointSeeds: [
            ...hugeSeeds.items,
            ...mediumSeeds.items,
            ...smallSeeds.items
          ].filter((item) => item.kind === "endpoint").length
        }
      });
      expect(actionableSeed).not.toBeNull();

      const hugeHeapBefore = process.memoryUsage().heapUsed;
      const hugeAnalysis = await recorder.callJsonTool<JsFileAnalysis>({
        task: "huge-js",
        label: "analyze largest huge bundle",
        name: "analyze-js-file",
        arguments: {
          path: hugeScript.path
        }
      });
      const hugeHeapDelta = Math.max(
        0,
        process.memoryUsage().heapUsed - hugeHeapBefore
      );
      expect(hugeAnalysis).toEqual(
        expect.objectContaining({
          analysisMode: "text-scan",
          parse: expect.objectContaining({
            skipped: true,
            reason: "file-too-large"
          })
        })
      );
      expect(hugeHeapDelta).toBeLessThan(MAX_HEAP_DELTA_BYTES);

      const mediumAnalysis = await recorder.callJsonTool<JsFileAnalysis>({
        task: "medium-js",
        label: "analyze medium bundle",
        name: "analyze-js-file",
        arguments: {
          path: mediumScript.path
        }
      });
      expect(mediumAnalysis.analysisMode).toBe("ast");
      expect(mediumAnalysis.parse.ok).toBe(true);
      recorder.observe({
        kind: "huge-bundle-safety",
        label: "huge analysis degraded safely",
        passed:
          hugeAnalysis.analysisMode === "text-scan" &&
          hugeAnalysis.parse.skipped === true &&
          hugeHeapDelta < MAX_HEAP_DELTA_BYTES,
        details: {
          hugeBytes: readableSize(hugeScript),
          heapDeltaBytes: hugeHeapDelta
        }
      });

      const hugeFileSearch = await findSearchFilesMatch(recorder, {
        label: "search huge body",
        pathContains: hugeToken,
        queries: ["function", "return", "http", "const"]
      });
      expect(hugeFileSearch.result.items[0]).toEqual(
        expect.objectContaining({
          path: hugeScript.path,
          matchKind: "body"
        })
      );

      const hugeJsSearch =
        endpointSuggestion && endpointSuggestion.path === hugeScript.path
          ? await findJsSearchMatch(recorder, {
              label: "search discovered huge endpoint",
              pathContains: hugeToken,
              kind: "endpoint",
              queries: [endpointSuggestion.value]
            })
          : await findJsSearchMatch(recorder, {
              label: "search huge JS facts",
              pathContains: hugeToken,
              queries: ["http", "api", "Error", "json", "return"]
            });
      expect(hugeJsSearch.result.items[0]?.path).toBe(hugeScript.path);

      const endpointSeed =
        (endpointSuggestion
          ? await findOptionalJsSearchMatch(recorder, {
              label: "search discovered endpoint seed",
              pathContains: pathToken({ path: endpointSuggestion.path }),
              kind: "endpoint",
              queries: [endpointSuggestion.value]
            })
          : null) ??
        (await findOptionalJsSearchMatch(recorder, {
          label: "find huge endpoint-like seed",
          pathContains: hugeToken,
          kind: "endpoint",
          queries: ["http", "api", "json"]
        })) ??
        (await findOptionalJsSearchMatch(recorder, {
          label: "find endpoint-like seed",
          kind: "endpoint",
          queries: ["http", "api", "json"]
        }));
      if (endpointSeed) {
        expect(endpointSeed.result.items[0]?.kind).toBe("endpoint");
      }

      const hugePage = await recorder.callJsonTool<FixtureReadPageShape>({
        task: "huge-js",
        label: "read bounded huge page",
        name: "read-file",
        arguments: {
          path: hugeScript.path,
          maxBytes: 2048
        }
      });
      expect(hugePage).toEqual(
        expect.objectContaining({
          path: hugeScript.path,
          truncated: true
        })
      );
      expect(hugePage.nextCursor).not.toBeNull();
      expect(hugePage.bytesReturned).toBeLessThanOrEqual(2048);

      const snippet = await recorder.callJsonTool<FileSnippetShape>({
        task: "bounded-read",
        label: "read small script snippet",
        name: "read-file-snippet",
        arguments: {
          path: smallScript.path,
          startLine: 1,
          lineCount: 3
        }
      });
      expect(snippet.path).toBe(smallScript.path);
      expect(Buffer.byteLength(snippet.text, "utf8")).toBeLessThanOrEqual(
        65_536
      );

      if (!actionableSeed) {
        throw new Error(
          "Expected live seed discovery to produce a readable seed."
        );
      }
      const readableSeed =
        (await findOptionalJsSearchMatch(recorder, {
          label: "search discovered readable seed",
          pathContains: pathToken({ path: actionableSeed.path }),
          kind: actionableSeed.kind as JsSearchKind,
          queries: [actionableSeed.value]
        })) ??
        (await findOptionalJsSearchMatch(recorder, {
          label: "find medium string seed",
          pathContains: mediumToken,
          kind: "string",
          queries: ["Error", "http", "json", "default", "name"]
        })) ??
        (await findOptionalJsSearchMatch(recorder, {
          label: "find medium call seed",
          pathContains: mediumToken,
          kind: "call",
          queries: ["fetch", "querySelector", "addEventListener", "render"]
        })) ??
        hugeJsSearch;

      const readableFact = selectRequiredJsMatch(
        readableSeed.result,
        "a readable JS fact"
      );
      expect(readableFact.nodeId).toBeTruthy();

      const symbolSnippet = await recorder.callJsonTool<JsSymbolReadResult>({
        task: "symbol-read",
        label: "read discovered JS snippet",
        name: "read-js-symbol",
        arguments: {
          path: readableFact.path,
          nodeId: readableFact.nodeId
        }
      });
      expect(symbolSnippet).toEqual(
        expect.objectContaining({
          truncated: expect.any(Boolean)
        })
      );
      expect(Buffer.byteLength(symbolSnippet.text, "utf8")).toBeLessThanOrEqual(
        32_000
      );
      recorder.observe({
        kind: "symbol-read-usefulness",
        label: "live discovered snippet",
        passed:
          Boolean(symbolSnippet.text) &&
          Buffer.byteLength(symbolSnippet.text, "utf8") <= 32_000,
        details: {
          bytes: Buffer.byteLength(symbolSnippet.text, "utf8"),
          truncated: symbolSnippet.truncated
        }
      });

      const selectorNoise = await recorder.callJsonTool<JsSearchResult>({
        task: "selector-quality",
        label: "search semantic selector noise",
        name: "search-js",
        arguments: {
          query: ".2",
          kind: "selector",
          pathContains: mediumToken,
          limit: 20
        }
      });
      expect(
        selectorNoise.items.some((item) => isNumericDotSelector(item.value))
      ).toBe(false);

      const nodeTrace = await recorder.callJsonTool<JsPipelineTraceResult>({
        task: "pipeline",
        label: "trace discovered node",
        name: "trace-js-pipeline",
        arguments: {
          seed: readableFact.nodeId,
          kind: "nodeId",
          pathContains: pathToken({ path: readableFact.path }),
          limit: 3
        }
      });
      expect(nodeTrace.totalMatched).toBeGreaterThan(0);
      expect(compactJsonByteLength(nodeTrace)).toBeLessThan(128 * 1024);
      expect(JSON.stringify(nodeTrace)).not.toContain('"program"');
      expect(JSON.stringify(nodeTrace)).not.toContain('"body":');
      recorder.observe({
        kind: "trace-usefulness",
        label: "live node trace",
        passed:
          nodeTrace.totalMatched > 0 &&
          compactJsonByteLength(nodeTrace) < 128 * 1024,
        details: {
          totalMatched: nodeTrace.totalMatched,
          compactBytes: compactJsonByteLength(nodeTrace)
        }
      });

      if (endpointSeed) {
        const endpointFact = selectRequiredJsMatch(
          endpointSeed.result,
          "an endpoint seed"
        );
        const endpointTrace =
          await recorder.callJsonTool<JsPipelineTraceResult>({
            task: "pipeline",
            label: "trace endpoint seed",
            name: "trace-js-pipeline",
            arguments: {
              seed: endpointFact.value,
              kind: "endpoint",
              pathContains: pathToken({ path: endpointFact.path }),
              limit: 3
            }
          });
        expect(endpointTrace.totalMatched).toBeGreaterThan(0);
        expect(endpointTrace.items[0]).toEqual(
          expect.objectContaining({
            analysisMode: expect.stringMatching(/ast|text-scan/)
          })
        );
        expect(compactJsonByteLength(endpointTrace)).toBeLessThan(128 * 1024);
        expect(JSON.stringify(endpointTrace)).not.toContain('"program"');
        expect(JSON.stringify(endpointTrace)).not.toContain('"body":');
        recorder.observe({
          kind: "trace-usefulness",
          label: "live endpoint trace",
          passed:
            endpointTrace.totalMatched > 0 &&
            compactJsonByteLength(endpointTrace) < 128 * 1024,
          details: {
            totalMatched: endpointTrace.totalMatched,
            compactBytes: compactJsonByteLength(endpointTrace)
          }
        });
      }

      const report = recorder.buildReport({
        heapDeltaBytes: Math.max(0, process.memoryUsage().heapUsed - heapBefore)
      });
      assertAgentDogfoodBudgets(report, {
        maxReturnedBytes: MAX_RETURNED_BYTES,
        maxElapsedMs: MAX_ELAPSED_MS,
        maxSingleToolDurationMs: MAX_SINGLE_TOOL_DURATION_MS,
        maxSingleResponseBytes: MAX_SINGLE_RESPONSE_BYTES,
        maxHeapDeltaBytes: MAX_HEAP_DELTA_BYTES,
        minQuality: {
          "seed-discovery": 1,
          "trace-usefulness": 1,
          "symbol-read-usefulness": 1,
          "huge-bundle-safety": 1
        }
      });
      await maybeEmitAgentDogfoodReport(report);
    } catch (error) {
      await maybeEmitAgentDogfoodReport(
        recorder.buildReport({
          heapDeltaBytes: Math.max(
            0,
            process.memoryUsage().heapUsed - heapBefore
          )
        })
      );
      throw error;
    } finally {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  }, 120_000);
});
