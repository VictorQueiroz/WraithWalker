import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SiteConfig } from "@wraithwalker/core/site-config";
import { describe, expect, it, vi } from "vitest";

import { registerSiteConfigTools } from "../src/server-tools-site-config.mts";

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function createToolRegistry() {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool(name: string, _description: string, _schema: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    }
  } as unknown as McpServer;

  return {
    server,
    async callTool(name: string, args: Record<string, unknown>) {
      const handler = handlers.get(name);
      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }

      return handler(args);
    }
  };
}

function readJson(result: ToolResult) {
  return JSON.parse(result.content[0]?.text ?? "null");
}

function readText(result: ToolResult) {
  return result.content[0]?.text ?? "";
}

function createSiteConfig(origin: string, dumpAllowlistPatterns: string[]): SiteConfig {
  return {
    origin,
    createdAt: "2026-04-14T00:00:00.000Z",
    dumpAllowlistPatterns
  };
}

function createHarness({
  initialConfigs = [],
  status = {
    connected: false,
    sessionActive: false,
    enabledOrigins: []
  }
}: {
  initialConfigs?: SiteConfig[];
  status?: {
    connected: boolean;
    sessionActive: boolean;
    enabledOrigins: string[];
  };
} = {}) {
  let configuredSiteConfigs = [...initialConfigs];
  const runtime = {
    readConfiguredSiteConfigs: vi.fn(async () => configuredSiteConfigs),
    writeConfiguredSiteConfigs: vi.fn(async (nextConfigs: SiteConfig[]) => {
      configuredSiteConfigs = nextConfigs;
    })
  };
  const extensionSessions = {
    getStatus: vi.fn(async () => ({
      ...status,
      captureReady: status.connected && status.sessionActive && status.enabledOrigins.length > 0
    }))
  };
  const registry = createToolRegistry();

  registerSiteConfigTools(registry.server, {
    runtime: runtime as never,
    extensionSessions: extensionSessions as never
  });

  return {
    ...registry,
    runtime,
    extensionSessions,
    getConfiguredSiteConfigs: () => configuredSiteConfigs
  };
}

describe("site config tool registration", () => {
  it("filters configured sites by a case-insensitive search", async () => {
    const harness = createHarness({
      initialConfigs: [
        createSiteConfig("https://alpha.example.com", ["\\.js$"]),
        createSiteConfig("https://beta.example.com", ["\\.css$"])
      ]
    });

    const result = await harness.callTool("list-configured-sites", { search: "BETA" });

    expect(readJson(result)).toEqual([
      expect.objectContaining({
        origin: "https://beta.example.com"
      })
    ]);
  });

  it("rejects invalid origins and avoids rewriting existing whitelist entries", async () => {
    const existing = createSiteConfig("https://app.example.com", ["\\.js$"]);
    const harness = createHarness({
      initialConfigs: [existing]
    });

    const invalidResult = await harness.callTool("whitelist-site", { origin: "file:///tmp/test" });
    expect(invalidResult.isError).toBe(true);
    expect(readText(invalidResult)).toContain("Only http and https origins are supported.");

    const unchangedResult = await harness.callTool("whitelist-site", { origin: "app.example.com" });
    expect(readJson(unchangedResult)).toEqual({
      changed: false,
      siteConfig: existing,
      configuredSites: [existing]
    });
    expect(harness.runtime.writeConfiguredSiteConfigs).not.toHaveBeenCalled();
  });

  it("returns unchanged removals when the origin is not explicitly configured", async () => {
    const existing = createSiteConfig("https://app.example.com", ["\\.js$"]);
    const harness = createHarness({
      initialConfigs: [existing]
    });

    const result = await harness.callTool("remove-site", { origin: "https://missing.example.com" });

    expect(readJson(result)).toEqual({
      changed: false,
      removedOrigin: "https://missing.example.com",
      configuredSites: [existing]
    });
    expect(harness.runtime.writeConfiguredSiteConfigs).not.toHaveBeenCalled();
  });

  it("surfaces site-pattern validation failures before rewriting configs", async () => {
    const harness = createHarness({
      initialConfigs: [createSiteConfig("https://app.example.com", ["\\.js$"])]
    });

    const missingOriginResult = await harness.callTool("update-site-patterns", {
      origin: "https://missing.example.com",
      mode: "replace",
      dumpPatterns: ["\\.json$"]
    });
    expect(missingOriginResult.isError).toBe(true);
    expect(readText(missingOriginResult)).toContain("Call whitelist-site first.");

    const missingPatternsResult = await harness.callTool("update-site-patterns", {
      origin: "https://app.example.com",
      mode: "append"
    });
    expect(missingPatternsResult.isError).toBe(true);
    expect(readText(missingPatternsResult)).toContain("dumpPatterns is required when mode is replace or append.");

    const invalidPatternResult = await harness.callTool("update-site-patterns", {
      origin: "https://app.example.com",
      mode: "replace",
      dumpPatterns: ["   "]
    });
    expect(invalidPatternResult.isError).toBe(true);
    expect(readText(invalidPatternResult)).toContain("Invalid dump allowlist pattern");
  });

  it("supports replace no-ops and reset-to-default behavior for explicit site configs", async () => {
    const harness = createHarness({
      initialConfigs: [createSiteConfig("https://app.example.com", [
        "\\.m?(js|ts)x?$",
        "\\.css$",
        "\\.wasm$",
        "\\.json$"
      ])]
    });

    const replaceResult = await harness.callTool("update-site-patterns", {
      origin: "https://app.example.com",
      mode: "replace",
      dumpPatterns: ["\\.m?(js|ts)x?$", "\\.css$", "\\.wasm$", "\\.json$"]
    });
    expect(readJson(replaceResult)).toEqual(expect.objectContaining({
      changed: false,
      siteConfig: expect.objectContaining({
        dumpAllowlistPatterns: ["\\.m?(js|ts)x?$", "\\.css$", "\\.wasm$", "\\.json$"]
      })
    }));

    harness.runtime.writeConfiguredSiteConfigs.mockClear();
    harness.runtime.readConfiguredSiteConfigs.mockImplementation(async () => [
      createSiteConfig("https://app.example.com", ["\\.svg$"])
    ]);

    const resetResult = await harness.callTool("update-site-patterns", {
      origin: "https://app.example.com",
      mode: "reset"
    });
    expect(readJson(resetResult)).toEqual(expect.objectContaining({
      changed: true,
      siteConfig: expect.objectContaining({
        dumpAllowlistPatterns: ["\\.m?(js|ts)x?$", "\\.css$", "\\.wasm$", "\\.json$"]
      })
    }));
  });

  it("reports prepare-site readiness across inactive, ready, and invalid-origin states", async () => {
    const inactiveHarness = createHarness({
      initialConfigs: [createSiteConfig("https://app.example.com", ["\\.js$"])],
      status: {
        connected: true,
        sessionActive: false,
        enabledOrigins: []
      }
    });

    const inactiveResult = await inactiveHarness.callTool("prepare-site-for-capture", {
      origin: "https://app.example.com"
    });
    expect(readJson(inactiveResult)).toEqual(expect.objectContaining({
      changed: false,
      connected: true,
      sessionActive: false,
      captureReady: false,
      nextAction: "start_extension_session"
    }));

    const readyHarness = createHarness({
      initialConfigs: [createSiteConfig("https://app.example.com", ["\\.js$"])],
      status: {
        connected: true,
        sessionActive: true,
        enabledOrigins: ["https://app.example.com"]
      }
    });

    const readyResult = await readyHarness.callTool("prepare-site-for-capture", {
      origin: "https://app.example.com"
    });
    expect(readJson(readyResult)).toEqual(expect.objectContaining({
      changed: false,
      captureReady: true,
      nextAction: "ready",
      guidance: "Capture is ready for this origin."
    }));

    const invalidResult = await readyHarness.callTool("prepare-site-for-capture", {
      origin: "file:///tmp/test"
    });
    expect(invalidResult.isError).toBe(true);
    expect(readText(invalidResult)).toContain("Only http and https origins are supported.");
  });
});
