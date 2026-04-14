import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { createServerRootRuntime } from "./root-runtime.mjs";
import {
  checkoutProjectionWorkspace,
  discardProjectionWorkspace,
  pushProjectionWorkspace
} from "./projection-workspace.mjs";
import {
  flattenStaticResourceManifest,
  listAssets,
  listApiEndpoints,
  matchSiteConfigsByOrigin,
  patchProjectionFile,
  readApiFixture,
  readFixtureBody,
  readFixtureSnippet,
  readOriginInfo,
  resolveFixturePath,
  restoreProjectionFile,
  searchFixtureContent,
  writeProjectionFile
} from "./fixture-reader.mjs";
import { optionalStringArraySchema, renderErrorMessage, renderJson, renderUnknownError } from "./server-responses.mjs";

function renderOriginNotFound(origin: string, availableOrigins: string[]) {
  const available = availableOrigins.join(", ");
  return renderErrorMessage(`Origin "${origin}" not found.${available ? ` Available: ${available}` : ""}`);
}

export function registerFixtureTools(
  server: McpServer,
  rootPath: string,
  {
    runtime
  }: {
    runtime: ReturnType<typeof createServerRootRuntime>;
  }
): void {
  async function resolveSiteConfig(origin: string) {
    const configs = await runtime.readEffectiveSiteConfigs();
    return {
      configs,
      config: configs.find((candidate) => candidate.origin === origin)
    };
  }

  async function resolveDiscoverySiteConfigs(origin: string) {
    const configs = await runtime.readEffectiveSiteConfigs();
    return {
      configs,
      matchedConfigs: matchSiteConfigsByOrigin(configs, origin)
    };
  }

  server.tool(
    "list-sites",
    "List all captured origins and their fixture summary",
    {
      search: z.string().trim().min(1).optional().describe("Optional case-insensitive origin substring filter")
    },
    async ({ search }) => {
      const configs = await runtime.readEffectiveSiteConfigs();
      const normalizedSearch = search?.toLowerCase();
      const origins = [];

      for (const config of configs) {
        if (normalizedSearch && !config.origin.toLowerCase().includes(normalizedSearch)) {
          continue;
        }

        const info = await readOriginInfo(rootPath, config);
        origins.push({
          origin: info.origin,
          manifestPath: info.manifestPath,
          apiEndpoints: info.apiEndpoints.length,
          staticAssets: flattenStaticResourceManifest(info.manifest).length
        });
      }

      return renderJson(origins);
    }
  );

  server.tool(
    "list-files",
    "List captured static assets for an origin with optional filters, pagination, and body availability",
    {
      origin: z.string().describe("The origin to list assets for (e.g., https://app.example.com)"),
      resourceTypes: optionalStringArraySchema.describe("Optional static resource types to include"),
      mimeTypes: optionalStringArraySchema.describe("Optional MIME types to include"),
      pathnameContains: z.string().optional().describe("Optional case-insensitive pathname substring filter"),
      requestOrigin: z.string().optional().describe("Optional exact request origin filter"),
      limit: z.number().int().positive().max(200).optional().describe("Maximum number of assets to return"),
      cursor: z.string().optional().describe("Opaque pagination cursor returned by a previous list-files call")
    },
    async ({ origin, resourceTypes, mimeTypes, pathnameContains, requestOrigin, limit, cursor }) => {
      const { configs, matchedConfigs } = await resolveDiscoverySiteConfigs(origin);
      if (matchedConfigs.length === 0) {
        return renderOriginNotFound(origin, configs.map((candidate) => candidate.origin));
      }

      try {
        const assets = await listAssets(rootPath, matchedConfigs, {
          resourceTypes,
          mimeTypes,
          pathnameContains,
          requestOrigin,
          limit,
          cursor
        });

        return renderJson(assets);
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.tool(
    "list-api-routes",
    "List all captured API endpoints for an origin",
    { origin: z.string().describe("The origin to list endpoints for (e.g., https://app.example.com)") },
    async ({ origin }) => {
      const { configs, matchedConfigs } = await resolveDiscoverySiteConfigs(origin);
      if (matchedConfigs.length === 0) {
        return renderOriginNotFound(origin, configs.map((candidate) => candidate.origin));
      }

      const endpoints = await listApiEndpoints(rootPath, matchedConfigs);
      return renderJson(endpoints);
    }
  );

  server.tool(
    "search-files",
    "Search live fixture content across assets, endpoint bodies, and text-like files, with path fallback when body text is unavailable or misses",
    {
      query: z.string().trim().min(1).describe("Case-insensitive substring query to search for"),
      origin: z.string().optional().describe("Optional origin filter"),
      pathContains: z.string().optional().describe("Optional case-insensitive relative path substring filter"),
      mimeTypes: optionalStringArraySchema.describe("Optional MIME types to include"),
      resourceTypes: optionalStringArraySchema.describe("Optional resource types to include"),
      limit: z.number().int().positive().max(100).optional().describe("Maximum number of matches to return"),
      cursor: z.string().optional().describe("Opaque pagination cursor returned by a previous search-files call")
    },
    async ({ query, origin, pathContains, mimeTypes, resourceTypes, limit, cursor }) => {
      if (origin) {
        const { configs, matchedConfigs } = await resolveDiscoverySiteConfigs(origin);
        if (matchedConfigs.length === 0) {
          return renderOriginNotFound(origin, configs.map((candidate) => candidate.origin));
        }
      }

      try {
        const results = await searchFixtureContent(rootPath, {
          query,
          origin,
          pathContains,
          mimeTypes,
          resourceTypes,
          limit,
          cursor
        });

        return renderJson(results);
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.tool(
    "read-file",
    "Read a fixture response body by its file path relative to the fixture root",
    {
      path: z.string().describe("Relative path to the fixture file (e.g., cdn.example.com/assets/app.js)"),
      pretty: z.boolean().optional().describe("Format supported text-like fixtures for easier reading without changing stored bytes")
    },
    async ({ path: filePath, pretty }) => {
      if (!resolveFixturePath(rootPath, filePath)) {
        return renderErrorMessage(`Invalid fixture path: ${filePath}. Paths must stay within the fixture root.`);
      }

      let content: string | null;
      try {
        content = await readFixtureBody(rootPath, filePath, { pretty });
      } catch (error) {
        return renderUnknownError(error);
      }
      if (content === null) {
        return renderErrorMessage(`File not found: ${filePath}`);
      }

      return {
        content: [{ type: "text" as const, text: content }]
      };
    }
  );

  server.tool(
    "read-file-snippet",
    "Read a bounded text snippet from a fixture file relative to the fixture root",
    {
      path: z.string().describe("Relative path to the text fixture file"),
      pretty: z.boolean().optional().describe("Format supported text-like fixtures before slicing lines for easier inspection"),
      startLine: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional().describe("1-based line number to start reading from"),
      lineCount: z.number().int().positive().max(400).optional().describe("Maximum number of lines to return"),
      maxBytes: z.number().int().positive().max(64000).optional().describe("Maximum UTF-8 bytes to return")
    },
    async ({ path: filePath, pretty, startLine, lineCount, maxBytes }) => {
      try {
        const snippet = await readFixtureSnippet(rootPath, filePath, {
          pretty,
          startLine,
          lineCount,
          maxBytes
        });
        return renderJson(snippet);
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.tool(
    "read-api-response",
    "Read the response metadata and body for an API fixture returned by list-api-routes",
    {
      fixtureDir: z.string().describe("Fixture directory returned by list-api-routes"),
      pretty: z.boolean().optional().describe("Format supported text-like response bodies for easier reading without changing stored bytes")
    },
    async ({ fixtureDir, pretty }) => {
      if (!resolveFixturePath(rootPath, path.join(fixtureDir, "response.meta.json"))) {
        return renderErrorMessage(`Invalid fixture directory: ${fixtureDir}. Paths must stay within the fixture root.`);
      }

      let fixture;
      try {
        fixture = await readApiFixture(rootPath, fixtureDir, { pretty });
      } catch (error) {
        return renderUnknownError(error);
      }
      if (!fixture) {
        return renderErrorMessage(`Endpoint fixture not found: ${fixtureDir}`);
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(fixture, null, 2) }]
      };
    }
  );

  server.tool(
    "read-site-manifest",
    "Read the RESOURCE_MANIFEST.json for an origin",
    { origin: z.string().describe("The origin to read the manifest for") },
    async ({ origin }) => {
      const { configs, config } = await resolveSiteConfig(origin);
      if (!config) {
        return renderOriginNotFound(origin, configs.map((candidate) => candidate.origin));
      }

      const info = await readOriginInfo(rootPath, config);
      if (!info.manifest) {
        return renderErrorMessage(`No manifest found for "${origin}".`);
      }

      return renderJson(info.manifest);
    }
  );

  server.tool(
    "write-file",
    "Overwrite a human-facing captured projection file with UTF-8 text",
    {
      path: z.string().describe("Visible projection path returned by list-files or search-files"),
      content: z.string().describe("Replacement UTF-8 text to write into the projection")
    },
    async ({ path: filePath, content }) => {
      try {
        return renderJson(await writeProjectionFile(rootPath, filePath, content));
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.tool(
    "patch-file",
    "Patch a human-facing captured projection file by line range, with conflict detection",
    {
      path: z.string().describe("Visible projection path returned by list-files or search-files"),
      startLine: z.number().int().positive().describe("1-based line number where the replacement starts"),
      endLine: z.number().int().positive().describe("1-based line number where the replacement ends"),
      expectedText: z.string().describe("Current text expected in the selected line range"),
      replacement: z.string().describe("Replacement text for the selected line range")
    },
    async ({ path: filePath, startLine, endLine, expectedText, replacement }) => {
      try {
        return renderJson(await patchProjectionFile(rootPath, {
          path: filePath,
          startLine,
          endLine,
          expectedText,
          replacement
        }));
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.tool(
    "restore-file",
    "Restore a human-facing captured projection file from its canonical hidden snapshot",
    {
      path: z.string().describe("Visible projection path returned by list-files or search-files")
    },
    async ({ path: filePath }) => {
      try {
        return renderJson(await restoreProjectionFile(rootPath, filePath));
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.tool(
    "checkout-workspace",
    "Copy selected projection-backed captured files into a local projection workspace for same-machine agent editing",
    {
      paths: optionalStringArraySchema.describe("Optional explicit projection-backed file paths returned by list-files or search-files"),
      includeGlobs: optionalStringArraySchema.describe("Optional root-relative glob selectors for projection-backed files"),
      excludeGlobs: optionalStringArraySchema.describe("Optional root-relative glob selectors to exclude from the workspace")
    },
    async ({ paths, includeGlobs, excludeGlobs }) => {
      try {
        return renderJson(await checkoutProjectionWorkspace(rootPath, {
          paths,
          includeGlobs,
          excludeGlobs
        }));
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.tool(
    "push-workspace",
    "Push tracked edits from a local projection workspace back into the human-facing fixture root",
    {
      workspaceId: z.string().trim().min(1).describe("Projection workspace id returned by checkout-workspace")
    },
    async ({ workspaceId }) => {
      try {
        return renderJson(await pushProjectionWorkspace(rootPath, workspaceId));
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.tool(
    "discard-workspace",
    "Remove a local projection workspace after the agent is done with it",
    {
      workspaceId: z.string().trim().min(1).describe("Projection workspace id returned by checkout-workspace")
    },
    async ({ workspaceId }) => {
      try {
        return renderJson(await discardProjectionWorkspace(rootPath, workspaceId));
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );
}
