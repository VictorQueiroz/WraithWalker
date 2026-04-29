import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  analyzeJsFile,
  readJsSymbol,
  searchJs,
  suggestJsSeeds,
  traceJsPipeline,
  type JsPipelineSeedKind,
  type JsSeedKind,
  type JsSearchKind
} from "./js-intelligence.mjs";
import { renderJson, renderUnknownError } from "./server-responses.mjs";

const jsSearchKindSchema = z.enum([
  "identifier",
  "string",
  "call",
  "property",
  "endpoint",
  "selector",
  "export"
]);

const jsPipelineSeedKindSchema = z.enum([
  "endpoint",
  "selector",
  "symbol",
  "nodeId"
]);

const jsSeedKindSchema = z.enum(["endpoint", "selector", "call", "string"]);

export function registerJsTools(server: McpServer, rootPath: string): void {
  server.registerTool(
    "analyze-js-file",
    {
      description:
        "Analyze one known JavaScript fixture and return compact semantic summaries without dumping the AST. Use suggest-js-seeds first when you need to discover actionable seeds across chunks.",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            "Relative path to a captured JavaScript-like fixture or projection"
          )
      })
    },
    async ({ path }) => {
      try {
        return renderJson(await analyzeJsFile(rootPath, path));
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.registerTool(
    "search-js",
    {
      description:
        "Search JavaScript facts when you already have a query. For unknown bundles, use suggest-js-seeds first, then pass a returned nodeId or value into trace-js-pipeline.",
      inputSchema: z.object({
        query: z
          .string()
          .trim()
          .min(1)
          .describe("Case-insensitive query to match in parsed JS facts"),
        kind: jsSearchKindSchema
          .optional()
          .describe(
            "Optional parsed fact kind to search: identifier, string, call, property, endpoint, selector, or export"
          ),
        origin: z
          .string()
          .optional()
          .describe("Optional exact top origin filter"),
        pathContains: z
          .string()
          .optional()
          .describe("Optional case-insensitive fixture path substring filter"),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe("Maximum number of matches to return"),
        cursor: z
          .string()
          .optional()
          .describe(
            "Opaque pagination cursor returned by a prior search-js call"
          )
      })
    },
    async ({ query, kind, origin, pathContains, limit, cursor }) => {
      try {
        return renderJson(
          await searchJs(rootPath, {
            query,
            kind: kind as JsSearchKind | undefined,
            origin,
            pathContains,
            limit,
            cursor
          })
        );
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.registerTool(
    "suggest-js-seeds",
    {
      description:
        "First JS discovery step: suggest high-signal endpoint, selector, call, and string seeds, including captured API metadata links for endpoint seeds when available. Next, pass a returned nodeId or value to trace-js-pipeline.",
      inputSchema: z.object({
        kinds: z
          .array(jsSeedKindSchema)
          .optional()
          .describe(
            "Optional seed kinds to include: endpoint, selector, call, or string"
          ),
        origin: z
          .string()
          .optional()
          .describe("Optional exact top origin filter"),
        pathContains: z
          .string()
          .optional()
          .describe("Optional case-insensitive fixture path substring filter"),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe("Maximum number of seed suggestions to return"),
        cursor: z
          .string()
          .optional()
          .describe(
            "Opaque pagination cursor returned by a prior suggest-js-seeds call"
          )
      })
    },
    async ({ kinds, origin, pathContains, limit, cursor }) => {
      try {
        return renderJson(
          await suggestJsSeeds(rootPath, {
            kinds: kinds as JsSeedKind[] | undefined,
            origin,
            pathContains,
            limit,
            cursor
          })
        );
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.registerTool(
    "trace-js-pipeline",
    {
      description:
        "Trace a likely JavaScript execution pipeline from a selector, endpoint, symbol, or nodeId using compact evidence and API metadata pointers. Next, use read-js-symbol for JS evidence and read-api-response for linked API metadata.",
      inputSchema: z.object({
        seed: z
          .string()
          .trim()
          .min(1)
          .describe("Selector, endpoint, symbol name, or node id to trace"),
        kind: jsPipelineSeedKindSchema.describe(
          "Seed kind: endpoint, selector, symbol, or nodeId"
        ),
        origin: z
          .string()
          .optional()
          .describe("Optional exact top origin filter"),
        pathContains: z
          .string()
          .optional()
          .describe("Optional case-insensitive fixture path substring filter"),
        limit: z
          .number()
          .int()
          .positive()
          .max(20)
          .optional()
          .describe("Maximum number of pipeline candidates to return")
      })
    },
    async ({ seed, kind, origin, pathContains, limit }) => {
      try {
        return renderJson(
          await traceJsPipeline(rootPath, {
            seed,
            kind: kind as JsPipelineSeedKind,
            origin,
            pathContains,
            limit
          })
        );
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.registerTool(
    "read-js-symbol",
    {
      description:
        "Read the smallest useful snippet after suggest-js-seeds, search-js, or trace-js-pipeline returns a nodeId. Prefer nodeId follow-up over broad file reads.",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            "Relative path to the JavaScript fixture that contains the symbol or node"
          ),
        symbol: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Symbol name to read when nodeId is not provided"),
        nodeId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Stable node id returned by analyze-js-file or search-js")
      })
    },
    async ({ path, symbol, nodeId }) => {
      if (!symbol && !nodeId) {
        return renderUnknownError(
          new Error("read-js-symbol requires either symbol or nodeId.")
        );
      }

      try {
        return renderJson(
          await readJsSymbol(rootPath, {
            path,
            symbol,
            nodeId
          })
        );
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );
}
