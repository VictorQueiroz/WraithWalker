import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { diffScenarios, renderDiffMarkdown } from "./fixture-diff.mjs";
import { listScenarios, readFixtureBody, readOriginInfo, readSiteConfigs } from "./fixture-reader.mjs";

export async function startServer(rootPath: string): Promise<void> {
  const server = new McpServer({
    name: "wraithwalker",
    version: "0.1.0"
  });

  server.tool(
    "list-origins",
    "List all captured origins and their fixture summary",
    {},
    async () => {
      const configs = await readSiteConfigs(rootPath);
      const origins = [];

      for (const config of configs) {
        const info = await readOriginInfo(rootPath, config);
        origins.push({
          origin: info.origin,
          mode: info.mode,
          apiEndpoints: info.apiEndpoints.length,
          staticAssets: info.manifest
            ? Object.values(info.manifest.resourcesByPathname).flat().length
            : 0
        });
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(origins, null, 2) }]
      };
    }
  );

  server.tool(
    "list-endpoints",
    "List all captured API endpoints for an origin",
    { origin: z.string().describe("The origin to list endpoints for (e.g., https://app.example.com)") },
    async ({ origin }) => {
      const configs = await readSiteConfigs(rootPath);
      const config = configs.find((candidate) => candidate.origin === origin);
      if (!config) {
        return {
          content: [{ type: "text" as const, text: `Origin "${origin}" not found. Available: ${configs.map((candidate) => candidate.origin).join(", ")}` }],
          isError: true
        };
      }

      const info = await readOriginInfo(rootPath, config);
      const endpoints = info.apiEndpoints.map((endpoint) => ({
        method: endpoint.method,
        pathname: endpoint.pathname,
        status: endpoint.status,
        mimeType: endpoint.mimeType
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(endpoints, null, 2) }]
      };
    }
  );

  server.tool(
    "read-fixture",
    "Read a fixture response body by its file path relative to the fixture root",
    { path: z.string().describe("Relative path to the fixture file (e.g., cdn.example.com/assets/app.js)") },
    async ({ path: filePath }) => {
      const content = await readFixtureBody(rootPath, filePath);
      if (content === null) {
        return {
          content: [{ type: "text" as const, text: `File not found: ${filePath}` }],
          isError: true
        };
      }

      return {
        content: [{ type: "text" as const, text: content }]
      };
    }
  );

  server.tool(
    "read-manifest",
    "Read the RESOURCE_MANIFEST.json for an origin",
    { origin: z.string().describe("The origin to read the manifest for") },
    async ({ origin }) => {
      const configs = await readSiteConfigs(rootPath);
      const config = configs.find((candidate) => candidate.origin === origin);
      if (!config) {
        return {
          content: [{ type: "text" as const, text: `Origin "${origin}" not found.` }],
          isError: true
        };
      }

      const info = await readOriginInfo(rootPath, config);
      if (!info.manifest) {
        return {
          content: [{ type: "text" as const, text: `No manifest found for "${origin}".` }],
          isError: true
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(info.manifest, null, 2) }]
      };
    }
  );

  server.tool(
    "list-scenarios",
    "List all saved fixture scenarios",
    {},
    async () => {
      const scenarios = await listScenarios(rootPath);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ scenarios }, null, 2) }]
      };
    }
  );

  server.tool(
    "diff-scenarios",
    "Compare two scenario snapshots and report differences in API endpoints",
    {
      scenarioA: z.string().describe("Name of the first scenario"),
      scenarioB: z.string().describe("Name of the second scenario")
    },
    async ({ scenarioA, scenarioB }) => {
      try {
        const diff = await diffScenarios(rootPath, scenarioA, scenarioB);
        return {
          content: [{ type: "text" as const, text: renderDiffMarkdown(diff) }]
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
