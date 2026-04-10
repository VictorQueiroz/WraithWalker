import { afterEach, describe, expect, it, vi } from "vitest";

import { createBackgroundTraceService, TRACE_BINDING_NAME } from "../src/lib/background-trace-service.js";
import { DetachedDebuggerCommandError } from "../src/lib/background-runtime-shared.js";
import type { FixtureDescriptor, RequestEntry } from "../src/lib/types.js";
import { createBackgroundState, createMockServerClient } from "./helpers/background-service-test-helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function createActiveTrace(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    traceId: "trace-1",
    status: "armed" as const,
    createdAt: "2026-04-08T00:00:00.000Z",
    rootId: "server-root",
    selectedOrigins: ["https://app.example.com"],
    extensionClientId: "client-1",
    steps: [],
    ...overrides
  };
}

describe("background trace service", () => {
  it("records trace binding payloads and updates the active trace", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-0000-0000-000000000001");
    const state = createBackgroundState({
      serverInfo: {
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc"
      },
      activeTrace: createActiveTrace(),
      attachedTabs: new Map([[7, {
        topOrigin: "https://app.example.com",
        traceScriptIdentifier: null,
        traceArmedForTraceId: null
      }]])
    });
    const nextTrace = createActiveTrace({ traceId: "trace-2" });
    const serverClient = createMockServerClient({
      recordTraceClick: vi.fn().mockResolvedValue({
        recorded: true,
        activeTrace: nextTrace
      })
    });
    const scheduleHeartbeat = vi.fn();
    const service = createBackgroundTraceService({
      state,
      serverClient,
      sendDebuggerCommand: vi.fn(),
      scheduleHeartbeat,
      markServerOffline: vi.fn()
    });

    const handled = await service.handleBindingCalled(7, {
      name: TRACE_BINDING_NAME,
      payload: JSON.stringify({
        pageUrl: "https://app.example.com/dashboard",
        topOrigin: "",
        selector: "#submit",
        tagName: "button",
        textSnippet: "Save"
      })
    });

    expect(handled).toBe(true);
    expect(serverClient.recordTraceClick).toHaveBeenCalledWith({
      traceId: "trace-1",
      step: expect.objectContaining({
        stepId: "00000000-0000-0000-0000-000000000001",
        tabId: 7,
        pageUrl: "https://app.example.com/dashboard",
        topOrigin: "https://app.example.com",
        selector: "#submit",
        tagName: "button",
        textSnippet: "Save"
      })
    });
    expect(state.activeTrace).toEqual(nextTrace);
    expect(scheduleHeartbeat).toHaveBeenCalled();
  });

  it("links persisted fixtures to the active trace", async () => {
    const state = createBackgroundState({
      serverInfo: {
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc"
      },
      activeTrace: createActiveTrace()
    });
    const nextTrace = createActiveTrace({ traceId: "trace-linked" });
    const serverClient = createMockServerClient({
      linkTraceFixture: vi.fn().mockResolvedValue({
        linked: true,
        trace: nextTrace
      })
    });
    const scheduleHeartbeat = vi.fn();
    const service = createBackgroundTraceService({
      state,
      serverClient,
      sendDebuggerCommand: vi.fn(),
      scheduleHeartbeat,
      markServerOffline: vi.fn()
    });

    await service.linkTraceFixtureIfNeeded({
      descriptor: {
        bodyPath: "assets/app.js",
        requestUrl: "https://cdn.example.com/app.js"
      } as FixtureDescriptor,
      entry: {
        tabId: 4,
        requestId: "req-4",
        requestedAt: "2026-04-09T00:00:00.000Z",
        resourceType: "",
        url: "https://cdn.example.com/app.js"
      } as RequestEntry,
      capturedAt: "2026-04-09T00:00:05.000Z"
    });

    expect(serverClient.linkTraceFixture).toHaveBeenCalledWith({
      traceId: "trace-1",
      tabId: 4,
      requestedAt: "2026-04-09T00:00:00.000Z",
      fixture: {
        bodyPath: "assets/app.js",
        requestUrl: "https://cdn.example.com/app.js",
        resourceType: "Other",
        capturedAt: "2026-04-09T00:00:05.000Z"
      }
    });
    expect(state.activeTrace).toEqual(nextTrace);
    expect(scheduleHeartbeat).toHaveBeenCalled();
  });

  it("arms traced tabs by injecting the binding and evaluation script", async () => {
    const state = createBackgroundState({
      sessionActive: true,
      serverInfo: {
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc"
      },
      activeTrace: createActiveTrace(),
      attachedTabs: new Map([[8, {
        topOrigin: "https://app.example.com",
        traceScriptIdentifier: null,
        traceArmedForTraceId: null
      }]])
    });
    const sendDebuggerCommand = vi.fn(async <T = unknown>(_tabId: number, method: string) => {
      if (method === "Page.addScriptToEvaluateOnNewDocument") {
        return { identifier: "trace-script-1" } as T;
      }
      return undefined as T;
    }) as <T = unknown>(
      tabId: number,
      method: string,
      params?: Record<string, unknown>
    ) => Promise<T>;
    const service = createBackgroundTraceService({
      state,
      serverClient: createMockServerClient(),
      sendDebuggerCommand,
      scheduleHeartbeat: vi.fn(),
      markServerOffline: vi.fn()
    });

    await service.armTraceForTab(8);

    expect(sendDebuggerCommand).toHaveBeenCalledWith(8, "Runtime.addBinding", {
      name: TRACE_BINDING_NAME
    });
    expect(sendDebuggerCommand).toHaveBeenCalledWith(
      8,
      "Page.addScriptToEvaluateOnNewDocument",
      expect.objectContaining({
        source: expect.stringContaining(TRACE_BINDING_NAME)
      })
    );
    expect(sendDebuggerCommand).toHaveBeenCalledWith(
      8,
      "Runtime.evaluate",
      expect.objectContaining({
        expression: expect.stringContaining(TRACE_BINDING_NAME)
      })
    );
    expect(state.attachedTabs.get(8)).toMatchObject({
      traceScriptIdentifier: "trace-script-1",
      traceArmedForTraceId: "trace-1"
    });
  });

  it("ignores detached-tab races during trace arming", async () => {
    const state = createBackgroundState({
      sessionActive: true,
      serverInfo: {
        rootPath: "/tmp/server-root",
        sentinel: { rootId: "server-root" },
        baseUrl: "http://127.0.0.1:4319",
        mcpUrl: "http://127.0.0.1:4319/mcp",
        trpcUrl: "http://127.0.0.1:4319/trpc"
      },
      activeTrace: createActiveTrace(),
      attachedTabs: new Map([[6, {
        topOrigin: "https://app.example.com",
        traceScriptIdentifier: null,
        traceArmedForTraceId: null
      }]])
    });
    const sendDebuggerCommand = vi.fn(async () => {
      throw new DetachedDebuggerCommandError(6, "Runtime.addBinding", "Debugger is not attached to the tab with id: 6.");
    });
    const service = createBackgroundTraceService({
      state,
      serverClient: createMockServerClient(),
      sendDebuggerCommand,
      scheduleHeartbeat: vi.fn(),
      markServerOffline: vi.fn()
    });

    await expect(service.armTraceForTab(6)).resolves.toBeUndefined();
    expect(state.attachedTabs.get(6)).toMatchObject({
      traceScriptIdentifier: null,
      traceArmedForTraceId: null
    });
  });

  it("syncs trace bindings by disarming attached tabs when tracing is inactive", async () => {
    const state = createBackgroundState({
      sessionActive: false,
      activeTrace: null,
      serverInfo: null,
      attachedTabs: new Map([
        [1, {
          topOrigin: "https://app.example.com",
          traceScriptIdentifier: "trace-script-1",
          traceArmedForTraceId: "trace-1"
        }],
        [2, {
          topOrigin: "https://app.example.com",
          traceScriptIdentifier: "trace-script-2",
          traceArmedForTraceId: "trace-1"
        }]
      ])
    });
    const sendDebuggerCommand = vi.fn(async () => undefined);
    const service = createBackgroundTraceService({
      state,
      serverClient: createMockServerClient(),
      sendDebuggerCommand,
      scheduleHeartbeat: vi.fn(),
      markServerOffline: vi.fn()
    });

    await service.syncTraceBindings();

    expect(sendDebuggerCommand).toHaveBeenCalledWith(1, "Page.removeScriptToEvaluateOnNewDocument", {
      identifier: "trace-script-1"
    });
    expect(sendDebuggerCommand).toHaveBeenCalledWith(2, "Page.removeScriptToEvaluateOnNewDocument", {
      identifier: "trace-script-2"
    });
    expect(sendDebuggerCommand).toHaveBeenCalledWith(1, "Runtime.evaluate", {
      expression: "globalThis.__wraithwalkerDisableTrace?.()",
      awaitPromise: false,
      returnByValue: false
    });
    expect(sendDebuggerCommand).toHaveBeenCalledWith(2, "Runtime.evaluate", {
      expression: "globalThis.__wraithwalkerDisableTrace?.()",
      awaitPromise: false,
      returnByValue: false
    });
    expect(state.attachedTabs.get(1)).toMatchObject({
      traceScriptIdentifier: null,
      traceArmedForTraceId: null
    });
    expect(state.attachedTabs.get(2)).toMatchObject({
      traceScriptIdentifier: null,
      traceArmedForTraceId: null
    });
  });
});
