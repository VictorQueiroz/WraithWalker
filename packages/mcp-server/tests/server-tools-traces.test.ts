import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

import { registerTraceTools } from "../src/server-tools-traces.mts";

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function createToolRegistry() {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool(
      name: string,
      _description: string,
      _schema: unknown,
      handler: ToolHandler
    ) {
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

describe("trace tool registration", () => {
  it("rejects start-trace when a trace is already active", async () => {
    const runtime = {
      getActiveTrace: vi.fn().mockResolvedValue({
        traceId: "trace-1",
        status: "armed"
      }),
      startTrace: vi.fn()
    };
    const extensionSessions = {
      getStatus: vi.fn().mockResolvedValue({
        connected: true,
        clientId: "client-1",
        enabledOrigins: ["https://app.example.com"]
      })
    };
    const registry = createToolRegistry();

    registerTraceTools(registry.server, {
      runtime: runtime as never,
      extensionSessions: extensionSessions as never
    });

    const result = await registry.callTool("start-trace", {
      name: "Duplicate trace"
    });

    expect(result.isError).toBe(true);
    expect(readText(result)).toContain('Trace "trace-1" is already active.');
    expect(runtime.startTrace).not.toHaveBeenCalled();
  });

  it("surfaces stop-trace failures even when non-Error values are thrown", async () => {
    const runtime = {
      stopTrace: vi.fn().mockRejectedValue("trace stop failed"),
      listTraces: vi.fn().mockResolvedValue([]),
      readTrace: vi.fn()
    };
    const registry = createToolRegistry();

    registerTraceTools(registry.server, {
      runtime: runtime as never,
      extensionSessions: {
        getStatus: vi.fn()
      } as never
    });

    const result = await registry.callTool("stop-trace", {
      traceId: "trace-1"
    });

    expect(result.isError).toBe(true);
    expect(readText(result)).toBe("trace stop failed");
  });

  it("returns a not-found error when a stored trace is missing", async () => {
    const runtime = {
      listTraces: vi.fn().mockResolvedValue([]),
      readTrace: vi.fn().mockResolvedValue(null)
    };
    const registry = createToolRegistry();

    registerTraceTools(registry.server, {
      runtime: runtime as never,
      extensionSessions: {
        getStatus: vi.fn()
      } as never
    });

    const readResult = await registry.callTool("read-trace", {
      traceId: "missing-trace"
    });
    expect(readResult.isError).toBe(true);
    expect(readText(readResult)).toBe('Trace "missing-trace" not found.');

    const listResult = await registry.callTool("list-traces", {});
    expect(readJson(listResult)).toEqual([]);
  });
});
