import { describe, expect, it, vi } from "vitest";

import { createExtensionSessionTracker } from "../src/extension-session.mts";
import { createServerRootRuntime } from "../src/root-runtime.mts";
import {
  renderErrorMessage,
  renderJson,
  renderUnknownError
} from "../src/server-responses.mts";
import {
  createConnectedServer,
  registerTools
} from "../src/server-tool-registration.mts";
import { registerBrowserTools } from "../src/server-tools-browser.mts";
import { createCanonicalFixtureRoot } from "../../../test-support/canonical-fixture-root.mts";

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

function createToolRecorder() {
  const tools = new Map<
    string,
    {
      description: string;
      schema: unknown;
      handler: (args: Record<string, unknown>) => Promise<unknown>;
    }
  >();

  return {
    server: {
      tool: vi.fn(
        (
          name: string,
          description: string,
          schema: unknown,
          handler: (args: Record<string, unknown>) => Promise<unknown>
        ) => {
          tools.set(name, { description, schema, handler });
        }
      )
    } as any,
    tools
  };
}

describe("server helper modules", () => {
  it("renders JSON and error tool responses", () => {
    expect(renderJson({ ok: true })).toEqual({
      content: [{ type: "text", text: '{\n  "ok": true\n}' }]
    });
    expect(renderErrorMessage("No fixture root.")).toEqual({
      content: [{ type: "text", text: "No fixture root." }],
      isError: true
    });
    expect(renderUnknownError(new Error("Boom"))).toEqual({
      content: [{ type: "text", text: "Boom" }],
      isError: true
    });
  });

  it("registers browser tools and filters recent console entries", async () => {
    const extensionSessions = createExtensionSessionTracker({
      getActiveTrace: async () => null,
      getEffectiveSiteConfigs: async () => [
        {
          origin: "https://app.example.com",
          createdAt: "2026-04-14T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }
      ]
    });
    await extensionSessions.heartbeat({
      clientId: "client-1",
      extensionVersion: "1.0.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"],
      recentConsoleEntries: [
        {
          tabId: 7,
          topOrigin: "https://app.example.com",
          source: "javascript",
          level: "error",
          text: "Boom from popup",
          timestamp: "2026-04-14T00:00:00.000Z"
        },
        {
          tabId: 7,
          topOrigin: "https://app.example.com",
          source: "network",
          level: "warn",
          text: "Slow request",
          timestamp: "2026-04-14T00:00:01.000Z"
        }
      ]
    });

    const { server, tools } = createToolRecorder();
    registerBrowserTools(server, { extensionSessions });

    const status = await tools.get("browser-status")?.handler({});
    expect(JSON.parse(readTextContent(status))).toEqual(
      expect.objectContaining({
        connected: true,
        captureReady: true,
        clientId: "client-1",
        enabledOrigins: ["https://app.example.com"]
      })
    );

    const consoleEntries = await tools.get("read-console")?.handler({
      search: "boom",
      levels: ["error"],
      limit: 1
    });
    expect(JSON.parse(readTextContent(consoleEntries))).toEqual(
      expect.objectContaining({
        returnedEntries: 1,
        entries: [
          expect.objectContaining({
            level: "error",
            text: "Boom from popup"
          })
        ]
      })
    );
  });

  it("registers fixture and snapshot tools against a canonical root", async () => {
    const canonical = await createCanonicalFixtureRoot({
      rootId: "root-server-helpers"
    });
    await canonical.root.ensureScenario(canonical.scenarioName);

    const runtime = createServerRootRuntime({
      rootPath: canonical.root.rootPath,
      sentinel: canonical.root.sentinel
    });
    const extensionSessions = createExtensionSessionTracker({
      getActiveTrace: () => runtime.getActiveTrace(),
      getEffectiveSiteConfigs: () => runtime.readEffectiveSiteConfigs()
    });
    const { server, tools } = createToolRecorder();

    registerTools(server, canonical.root.rootPath, {
      runtime,
      extensionSessions
    });

    expect([...tools.keys()]).toEqual(
      expect.arrayContaining([
        "list-sites",
        "read-file",
        "list-snapshots",
        "save-trace-as-snapshot"
      ])
    );

    const listSitesResult = await tools.get("list-sites")?.handler({});
    expect(JSON.parse(readTextContent(listSitesResult))).toEqual([
      expect.objectContaining({
        origin: canonical.siteConfig.origin,
        apiEndpoints: 1,
        staticAssets: 1
      })
    ]);

    const readFileResult = await tools.get("read-file")?.handler({
      path:
        canonical.assetDescriptor.projectionPath ??
        canonical.assetDescriptor.bodyPath
    });
    expect(readTextContent(readFileResult)).toBe(canonical.assetBody);

    const listSnapshotsResult = await tools.get("list-snapshots")?.handler({});
    expect(JSON.parse(readTextContent(listSnapshotsResult))).toEqual({
      scenarios: [canonical.scenarioName],
      snapshots: [
        {
          name: canonical.scenarioName,
          source: "unknown",
          hasMetadata: false,
          isActive: false
        }
      ]
    });
  });

  it("creates a connected MCP server instance that can close cleanly", async () => {
    const canonical = await createCanonicalFixtureRoot({
      rootId: "root-connected-server"
    });
    const runtime = createServerRootRuntime({
      rootPath: canonical.root.rootPath,
      sentinel: canonical.root.sentinel
    });
    const extensionSessions = createExtensionSessionTracker({
      getActiveTrace: () => runtime.getActiveTrace(),
      getEffectiveSiteConfigs: () => runtime.readEffectiveSiteConfigs()
    });
    const server = createConnectedServer(canonical.root.rootPath, {
      runtime,
      extensionSessions
    });

    await expect(server.close()).resolves.toBeUndefined();
  });
});
