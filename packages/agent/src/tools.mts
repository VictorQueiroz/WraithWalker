import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  listApiEndpoints,
  readApiFixture,
  searchFixtureContent
} from "@wraithwalker/core/fixtures";

import type { AgentDatabase } from "./db.mjs";
import type { AgentModelProvider } from "./gateway.mjs";
import { ensureProjectIndexed } from "./indexer.mjs";
import type { AgentProject } from "./projects.mjs";
import { searchProjectChunks } from "./retrieval.mjs";

export const MAX_TOOL_OUTPUT_CHARS = 4000;
const MAX_ENDPOINT_ROWS = 80;
const MAX_TEXT_SEARCH_MATCHES = 12;

export interface AgentToolsDependencies {
  rootPath: string;
  db: AgentDatabase;
  provider: AgentModelProvider;
  project: AgentProject;
}

export function boundToolText(
  text: string,
  maxChars = MAX_TOOL_OUTPUT_CHARS
): string {
  if (text.length <= maxChars) {
    return text;
  }

  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n[output truncated: ${omitted} of ${text.length} chars omitted]`;
}

function projectOriginConfigs(project: AgentProject) {
  return project.origins.map((origin) => ({ origin: origin.origin }));
}

export function createAgentTools(deps: AgentToolsDependencies): ToolSet {
  const { rootPath, db, provider, project } = deps;

  return {
    search_captures: tool({
      description:
        "Semantic search over everything captured for the selected project (API fixtures, static asset maps, tab capture links). Always call this first to ground answers in captured data.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Natural-language question or keywords to search for")
      }),
      execute: async ({ query }) => {
        await ensureProjectIndexed({ rootPath, db, provider }, project);
        const results = await searchProjectChunks(
          { db, provider },
          project.id,
          query
        );
        if (results.length === 0) {
          return boundToolText(
            "No indexed capture content matched. Try list_api_endpoints or search_fixture_text for exact strings."
          );
        }

        return boundToolText(
          results
            .map(
              (result, index) =>
                `#${index + 1} (${result.kind}, score ${result.score.toFixed(2)}, ref ${result.refPath})\n${result.content}`
            )
            .join("\n---\n")
        );
      }
    }),
    list_api_endpoints: tool({
      description:
        "List captured API endpoints (method, path, status, mime) for the selected project's origins.",
      inputSchema: z.object({
        pathContains: z
          .string()
          .optional()
          .describe("Only include endpoints whose pathname contains this text")
      }),
      execute: async ({ pathContains }) => {
        const result = await listApiEndpoints(
          rootPath,
          projectOriginConfigs(project)
        );
        const filtered = result.items.filter(
          (endpoint) =>
            !pathContains || endpoint.pathname.includes(pathContains)
        );
        const rows = filtered
          .slice(0, MAX_ENDPOINT_ROWS)
          .map(
            (endpoint) =>
              `${endpoint.method} ${endpoint.pathname} → ${endpoint.status} ${endpoint.mimeType} [dir: ${endpoint.fixtureDir}]`
          );
        const summary =
          filtered.length > MAX_ENDPOINT_ROWS
            ? `\n[${filtered.length - MAX_ENDPOINT_ROWS} more endpoints omitted; refine pathContains]`
            : "";

        return boundToolText(
          rows.length === 0
            ? "No captured API endpoints for this project."
            : `${rows.join("\n")}${summary}`
        );
      }
    }),
    read_api_fixture: tool({
      description:
        "Read one captured API fixture (response metadata plus a bounded page of the response body). Use the fixture dir from list_api_endpoints or search_captures refs.",
      inputSchema: z.object({
        fixtureDir: z
          .string()
          .describe("Fixture directory path as returned by other tools"),
        cursor: z
          .string()
          .optional()
          .describe("Pagination cursor from a previous truncated read")
      }),
      execute: async ({ fixtureDir, cursor }) => {
        const fixture = await readApiFixture(rootPath, fixtureDir, {
          maxBytes: 3000,
          ...(cursor ? { cursor } : {})
        });
        if (!fixture) {
          return "Fixture not found. Check the fixtureDir value.";
        }

        const bodyInfo = fixture.body
          ? `${fixture.body.text}\n[bytes ${fixture.body.startByte}-${fixture.body.startByte + fixture.body.bytesReturned} of ${fixture.body.sizeBytes}${fixture.body.nextCursor ? `; nextCursor: ${fixture.body.nextCursor}` : ""}]`
          : "[binary or unreadable body]";

        return boundToolText(
          [
            `${fixture.meta.method} ${fixture.meta.url}`,
            `status ${fixture.meta.status} ${fixture.meta.statusText}; mime ${fixture.meta.mimeType}`,
            bodyInfo
          ].join("\n")
        );
      }
    }),
    search_fixture_text: tool({
      description:
        "Exact-substring search across captured asset and API fixture bodies (lexical, not semantic). Good for finding literal strings, keys, or URLs.",
      inputSchema: z.object({
        query: z.string().describe("Exact substring to search for"),
        origin: z
          .string()
          .optional()
          .describe("Restrict to one origin, e.g. https://api.example.com")
      }),
      execute: async ({ query, origin }) => {
        const result = await searchFixtureContent(rootPath, {
          query,
          ...(origin ? { origin } : {}),
          limit: MAX_TEXT_SEARCH_MATCHES
        });
        if (result.items.length === 0) {
          return "No fixture content matched that text.";
        }

        return boundToolText(
          result.items
            .map(
              (match) =>
                `${match.path} (${match.sourceKind}, ${match.matchCount} match${match.matchCount === 1 ? "" : "es"}, line ${match.matchLine})\n${match.excerpt}`
            )
            .join("\n---\n")
        );
      }
    }),
    get_project_overview: tool({
      description:
        "Summarize the selected project: captured origins, connected origins observed in the same browser tabs, fixture counts, and trace activity.",
      inputSchema: z.object({}),
      execute: async () => {
        const lines = [
          `project ${project.displayName} (${project.id})`,
          `origins: ${project.origins
            .map(
              (origin) =>
                `${origin.origin} (${origin.apiFixtureCount} api fixtures, ${origin.assetCount} assets)`
            )
            .join("; ")}`,
          `connected origins (captured under this project's tabs): ${
            project.connectedOrigins.join(", ") || "none"
          }`,
          `trace steps recorded: ${project.traceStepCount}`
        ];
        for (const link of project.tabLinks.slice(0, 10)) {
          lines.push(
            `tab link: ${link.origin} requested while on ${link.pageUrl}`
          );
        }

        return boundToolText(lines.join("\n"));
      }
    })
  };
}
