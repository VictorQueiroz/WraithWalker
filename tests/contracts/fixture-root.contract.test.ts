import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listAssets,
  readFixtureBody,
  readSiteConfigs,
  searchFixtureContent
} from "../../packages/core/src/fixtures.mts";
import { runCli } from "../../packages/cli/src/lib/runner.mts";
import { startHttpServer } from "../../packages/mcp-server/src/server.mts";
import type { AppRouter } from "../../packages/mcp-server/src/trpc.mts";
import {
  listScenarios,
  saveScenario,
  switchScenario
} from "../../packages/native-host/src/lib.mts";
import { createCanonicalFixtureRoot } from "../../test-support/canonical-fixture-root.mts";

function readTextContent(result: unknown): string {
  if (
    !result ||
    typeof result !== "object" ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    throw new Error("Expected an MCP tool result with content.");
  }

  const textEntry = result.content.find(
    (entry): entry is { type: string; text?: string } =>
      Boolean(entry) &&
      typeof entry === "object" &&
      "type" in entry &&
      typeof entry.type === "string"
  );
  if (!textEntry?.text) {
    throw new Error("Expected text content.");
  }

  return textEntry.text;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fixture root contracts", () => {
  it("keeps canonical fixture roots consistent across core, cli, mcp-server, and native-host", async () => {
    const canonical = await createCanonicalFixtureRoot({
      rootId: "root-fixture-contract"
    });
    const assetPath =
      canonical.assetDescriptor.projectionPath ??
      canonical.assetDescriptor.bodyPath;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(await readSiteConfigs(canonical.root.rootPath)).toEqual([
      canonical.siteConfig
    ]);

    const listedAssets = await listAssets(canonical.root.rootPath, [
      canonical.siteConfig
    ]);
    expect(listedAssets.matchedOrigins).toEqual([canonical.siteConfig.origin]);
    expect(listedAssets.items).toEqual([
      expect.objectContaining({
        requestUrl: canonical.assetDescriptor.requestUrl,
        path: assetPath,
        mimeType: canonical.assetMeta.mimeType
      })
    ]);

    await expect(
      readFixtureBody(canonical.root.rootPath, assetPath)
    ).resolves.toBe(canonical.assetBody);

    const searchMatches = await searchFixtureContent(canonical.root.rootPath, {
      query: "canonical-item"
    });
    expect(searchMatches.items).toEqual([
      expect.objectContaining({
        sourceKind: "endpoint",
        path: canonical.apiDescriptor.bodyPath,
        matchKind: "body"
      })
    ]);

    await expect(
      saveScenario({
        path: canonical.root.rootPath,
        expectedRootId: canonical.root.rootId,
        name: canonical.scenarioName
      })
    ).resolves.toEqual({
      ok: true,
      name: canonical.scenarioName
    });

    await expect(
      listScenarios({
        path: canonical.root.rootPath,
        expectedRootId: canonical.root.rootId
      })
    ).resolves.toEqual({
      ok: true,
      scenarios: [canonical.scenarioName],
      snapshots: [
        expect.objectContaining({
          name: canonical.scenarioName,
          source: "manual",
          hasMetadata: true,
          isActive: false
        })
      ],
      activeScenarioName: null,
      activeScenarioMissing: false,
      activeTrace: null,
      supportsTraceSave: false
    });

    await expect(
      switchScenario({
        path: canonical.root.rootPath,
        expectedRootId: canonical.root.rootId,
        name: canonical.scenarioName
      })
    ).resolves.toEqual({
      ok: true,
      name: canonical.scenarioName
    });

    await expect(
      runCli(["scenarios", "list"], {
        cwd: canonical.root.rootPath,
        isTTY: false
      })
    ).resolves.toBe(0);
    expect(logSpy.mock.calls.flat().join("\n")).toContain(
      canonical.scenarioName
    );
    expect(errorSpy).not.toHaveBeenCalled();

    const server = await startHttpServer(canonical.root.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const trpcClient = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: server.trpcUrl
        })
      ]
    });
    const mcpClient = new Client({
      name: "wraithwalker-contract-client",
      version: "1.0.0"
    });
    const transport = new StreamableHTTPClientTransport(new URL(server.url));

    try {
      await mcpClient.connect(transport);

      const configured =
        await trpcClient.config.readConfiguredSiteConfigs.query();
      expect(configured.siteConfigs).toEqual([canonical.siteConfig]);

      const scenarios = await trpcClient.scenarios.list.query();
      expect(scenarios.scenarios).toEqual([canonical.scenarioName]);

      const listSitesResult = await mcpClient.callTool({
        name: "list-sites",
        arguments: {}
      });
      expect(JSON.parse(readTextContent(listSitesResult))).toEqual([
        expect.objectContaining({
          origin: canonical.siteConfig.origin,
          apiEndpoints: 1,
          staticAssets: 1
        })
      ]);

      const readFileResult = await mcpClient.callTool({
        name: "read-file",
        arguments: {
          path: assetPath
        }
      });
      expect(readTextContent(readFileResult)).toBe(canonical.assetBody);

      const snapshotsResult = await mcpClient.callTool({
        name: "list-snapshots",
        arguments: {}
      });
      expect(JSON.parse(readTextContent(snapshotsResult))).toEqual({
        scenarios: [canonical.scenarioName],
        snapshots: [
          expect.objectContaining({
            name: canonical.scenarioName,
            source: "manual",
            hasMetadata: true,
            isActive: true
          })
        ]
      });
    } finally {
      await transport.close();
      await mcpClient.close();
      await server.close();
    }
  });
});
