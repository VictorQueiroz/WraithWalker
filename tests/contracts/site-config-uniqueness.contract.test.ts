import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  PROJECT_CONFIG_RELATIVE_PATH,
  readProjectConfig
} from "@wraithwalker/core/project-config";
import { startHttpServer } from "@wraithwalker/mcp-server/server";
import type { AppRouter } from "@wraithwalker/mcp-server/trpc";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../../packages/cli/src/lib/runner.mts";
import { createWraithWalkerServerClient } from "../../packages/extension/src/lib/wraithwalker-server.ts";
import { createWraithwalkerFixtureRoot } from "../../test-support/wraithwalker-fixture-root.mts";

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

describe("site config uniqueness contracts", () => {
  it("presents one canonical site across cli, server, and extension surfaces while preserving read-vs-write cleanup policy", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-contract-site-config-",
      rootId: "root-site-config-contract"
    });
    const rawProjectConfig = {
      schemaVersion: 1,
      sites: [
        {
          origin: "app.example.com",
          createdAt: "2026-04-09T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        },
        {
          origin: "https://app.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.json$", "\\.js$"]
        }
      ]
    };
    const canonicalSite = {
      origin: "https://app.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.js$", "\\.json$"]
    };

    await root.writeProjectConfig(rawProjectConfig);

    await expect(readProjectConfig(root.rootPath)).resolves.toEqual({
      schemaVersion: 1,
      sites: [canonicalSite]
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      runCli(["config", "list"], {
        cwd: root.rootPath,
        isTTY: false
      })
    ).resolves.toBe(0);
    const listOutput = logSpy.mock.calls.flat().join("\n");
    expect(
      listOutput.match(
        /site\."https:\/\/app\.example\.com"\.dumpAllowlistPatterns=/g
      )
    ).toHaveLength(1);
    expect(listOutput).toContain(
      'site."https://app.example.com".dumpAllowlistPatterns=["\\\\.js$","\\\\.json$"]'
    );
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockClear();
    errorSpy.mockClear();

    await expect(
      runCli(["config", "get", 'site."https://app.example.com"'], {
        cwd: root.rootPath,
        isTTY: false
      })
    ).resolves.toBe(0);
    const getOutput = logSpy.mock.calls.flat().join("\n");
    expect(getOutput).toContain('"origin":"https://app.example.com"');
    expect(getOutput).toContain('"createdAt":"2026-04-08T00:00:00.000Z"');
    expect(getOutput).toContain(
      '"dumpAllowlistPatterns":["\\\\.js$","\\\\.json$"]'
    );
    expect(errorSpy).not.toHaveBeenCalled();

    const server = await startHttpServer(root.rootPath, {
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
    const extensionClient = createWraithWalkerServerClient(server.trpcUrl);
    const mcpClient = new Client({
      name: "wraithwalker-site-config-contract-client",
      version: "1.0.0"
    });
    const transport = new StreamableHTTPClientTransport(new URL(server.url));

    try {
      await mcpClient.connect(transport);

      const trpcConfigured =
        await trpcClient.config.readConfiguredSiteConfigs.query();
      expect(trpcConfigured.siteConfigs).toEqual([canonicalSite]);

      const extensionConfigured =
        await extensionClient.readConfiguredSiteConfigs();
      expect(extensionConfigured.siteConfigs).toEqual([canonicalSite]);

      const listConfiguredSitesResult = await mcpClient.callTool({
        name: "list-configured-sites",
        arguments: {}
      });
      expect(JSON.parse(readTextContent(listConfiguredSitesResult))).toEqual([
        canonicalSite
      ]);

      await expect(
        root.readJson(PROJECT_CONFIG_RELATIVE_PATH)
      ).resolves.toEqual(rawProjectConfig);

      const writeResult = await extensionClient.writeConfiguredSiteConfigs([
        rawProjectConfig.sites[0]!,
        rawProjectConfig.sites[1]!
      ]);
      expect(writeResult.siteConfigs).toEqual([canonicalSite]);
      await expect(
        root.readJson(PROJECT_CONFIG_RELATIVE_PATH)
      ).resolves.toEqual({
        schemaVersion: 1,
        sites: [canonicalSite]
      });
    } finally {
      await transport.close();
      await mcpClient.close();
      await server.close();
    }
  });
});
