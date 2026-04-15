import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTimedFetch,
  createWraithWalkerServerTransportOptions,
  isServerCacheFresh,
  WRAITHWALKER_SERVER_SOURCE_HEADER,
  WRAITHWALKER_SERVER_REQUEST_TIMEOUT_MS
} from "../src/lib/wraithwalker-server.js";
import type {
  GenerateContextPayload,
  LinkTraceFixturePayload,
  RecordTraceClickPayload,
  ServerHeartbeatPayload,
  WraithWalkerServerTrpcClient,
  WriteFixtureIfAbsentPayload
} from "../src/lib/wraithwalker-server.shared.js";
import { bindWraithWalkerServerClient } from "../src/lib/wraithwalker-server.client.js";

afterEach(() => {
  vi.doUnmock("@trpc/client");
  vi.doUnmock("../src/lib/wraithwalker-server.transport.js");
  vi.restoreAllMocks();
});

function createTrpcClientDouble(): {
  trpc: WraithWalkerServerTrpcClient;
  spies: {
    getSystemInfo: ReturnType<typeof vi.fn>;
    revealRoot: ReturnType<typeof vi.fn>;
    listScenarios: ReturnType<typeof vi.fn>;
    saveScenario: ReturnType<typeof vi.fn>;
    switchScenario: ReturnType<typeof vi.fn>;
    diffScenarios: ReturnType<typeof vi.fn>;
    saveScenarioFromTrace: ReturnType<typeof vi.fn>;
    heartbeat: ReturnType<typeof vi.fn>;
    hasFixture: ReturnType<typeof vi.fn>;
    readConfiguredSiteConfigs: ReturnType<typeof vi.fn>;
    readEffectiveSiteConfigs: ReturnType<typeof vi.fn>;
    writeConfiguredSiteConfigs: ReturnType<typeof vi.fn>;
    readFixture: ReturnType<typeof vi.fn>;
    writeFixtureIfAbsent: ReturnType<typeof vi.fn>;
    generateContext: ReturnType<typeof vi.fn>;
    recordTraceClick: ReturnType<typeof vi.fn>;
    linkTraceFixture: ReturnType<typeof vi.fn>;
  };
} {
  const spies = {
    getSystemInfo: vi.fn().mockResolvedValue({ name: "server" }),
    revealRoot: vi.fn().mockResolvedValue({ ok: true, command: "open-root" }),
    listScenarios: vi.fn().mockResolvedValue({
      snapshots: [],
      activeScenarioName: null,
      activeScenarioMissing: false,
      activeTrace: null,
      supportsTraceSave: false
    }),
    saveScenario: vi.fn().mockResolvedValue({ ok: true, name: "saved" }),
    switchScenario: vi.fn().mockResolvedValue({ ok: true, name: "active" }),
    diffScenarios: vi.fn().mockResolvedValue({
      ok: true,
      diff: {
        scenarioA: "baseline",
        scenarioB: "candidate",
        added: [],
        removed: [],
        changed: []
      }
    }),
    saveScenarioFromTrace: vi
      .fn()
      .mockResolvedValue({ ok: true, name: "trace-save" }),
    heartbeat: vi.fn().mockResolvedValue({
      activeTraceId: null,
      commands: []
    }),
    hasFixture: vi.fn().mockResolvedValue({
      exists: true,
      sentinel: { rootId: "root-1" }
    }),
    readConfiguredSiteConfigs: vi.fn().mockResolvedValue({
      siteConfigs: [],
      sentinel: { rootId: "root-1" }
    }),
    readEffectiveSiteConfigs: vi.fn().mockResolvedValue({
      siteConfigs: [],
      sentinel: { rootId: "root-1" }
    }),
    writeConfiguredSiteConfigs: vi.fn().mockResolvedValue({
      siteConfigs: [],
      sentinel: { rootId: "root-1" }
    }),
    readFixture: vi.fn().mockResolvedValue({
      exists: false,
      sentinel: { rootId: "root-1" }
    }),
    writeFixtureIfAbsent: vi.fn().mockResolvedValue({
      written: true,
      descriptor: {
        bodyPath: "fixtures/example.body",
        requestPath: "fixtures/example.request.json",
        metaPath: "fixtures/example.meta.json"
      },
      sentinel: { rootId: "root-1" }
    }),
    generateContext: vi.fn().mockResolvedValue({ ok: true }),
    recordTraceClick: vi.fn().mockResolvedValue({
      recorded: true,
      activeTrace: null
    }),
    linkTraceFixture: vi.fn().mockResolvedValue({
      linked: true,
      trace: null
    })
  };

  return {
    spies,
    trpc: {
      system: {
        info: { query: spies.getSystemInfo, mutate: vi.fn() },
        revealRoot: { query: vi.fn(), mutate: spies.revealRoot }
      },
      scenarios: {
        list: { query: spies.listScenarios, mutate: vi.fn() },
        save: { query: vi.fn(), mutate: spies.saveScenario },
        switch: { query: vi.fn(), mutate: spies.switchScenario },
        diff: { query: spies.diffScenarios, mutate: vi.fn() },
        saveFromTrace: { query: vi.fn(), mutate: spies.saveScenarioFromTrace }
      },
      extension: {
        heartbeat: { query: vi.fn(), mutate: spies.heartbeat }
      },
      fixtures: {
        has: { query: spies.hasFixture, mutate: vi.fn() },
        read: { query: spies.readFixture, mutate: vi.fn() },
        writeIfAbsent: { query: vi.fn(), mutate: spies.writeFixtureIfAbsent },
        generateContext: { query: vi.fn(), mutate: spies.generateContext }
      },
      config: {
        readConfiguredSiteConfigs: {
          query: spies.readConfiguredSiteConfigs,
          mutate: vi.fn()
        },
        readEffectiveSiteConfigs: {
          query: spies.readEffectiveSiteConfigs,
          mutate: vi.fn()
        },
        writeConfiguredSiteConfigs: {
          query: vi.fn(),
          mutate: spies.writeConfiguredSiteConfigs
        }
      },
      scenarioTraces: {
        recordClick: { query: vi.fn(), mutate: spies.recordTraceClick },
        linkFixture: { query: vi.fn(), mutate: spies.linkTraceFixture }
      }
    }
  };
}

describe("wraithwalker server client helpers", () => {
  it("reports freshness based on the configured ttl", () => {
    expect(isServerCacheFresh(1_000, 5_000, 5_500)).toBe(true);
    expect(isServerCacheFresh(1_000, 5_000, 6_001)).toBe(false);
    expect(isServerCacheFresh(0, 5_000, 1_000)).toBe(false);
  });

  it("wraps fetch without changing successful responses", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    const timedFetch = createTimedFetch(100, fetchImpl);

    const response = await timedFetch("http://127.0.0.1:4319/trpc/system.info");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("aborts slow requests with the default timeout budget", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_, reject) => {
          const signal = init?.signal;
          signal?.addEventListener(
            "abort",
            () => {
              reject(signal.reason);
            },
            { once: true }
          );
        })
    );

    const timedFetch = createTimedFetch(1, fetchImpl);

    await expect(
      timedFetch("http://127.0.0.1:4319/trpc/system.info")
    ).rejects.toThrow(`Timed out after 1ms`);
  });

  it("reuses an already-aborted upstream signal reason", async () => {
    const upstream = new AbortController();
    const reason = new Error("Request cancelled.");
    upstream.abort(reason);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation((_input, init) => Promise.reject(init?.signal?.reason));

    const timedFetch = createTimedFetch(100, fetchImpl);

    await expect(
      timedFetch("http://127.0.0.1:4319/trpc/system.info", {
        signal: upstream.signal
      })
    ).rejects.toBe(reason);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:4319/trpc/system.info",
      expect.objectContaining({
        signal: expect.objectContaining({
          aborted: true,
          reason
        })
      })
    );
  });

  it("propagates upstream aborts during in-flight requests and cleans up listeners", async () => {
    const upstream = new AbortController();
    const reason = new Error("Upstream aborted.");
    const addEventListenerSpy = vi.spyOn(upstream.signal, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(
      upstream.signal,
      "removeEventListener"
    );
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(init.signal?.reason);
            },
            { once: true }
          );
        })
    );

    const timedFetch = createTimedFetch(100, fetchImpl);
    const pending = timedFetch("http://127.0.0.1:4319/trpc/system.info", {
      signal: upstream.signal
    });
    const onAbort = addEventListenerSpy.mock.calls[0]?.[1];

    upstream.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
      { once: true }
    );
    expect(removeEventListenerSpy).toHaveBeenCalledWith("abort", onAbort);
  });

  it("keeps the exported default timeout meaningful for local server probes", () => {
    expect(WRAITHWALKER_SERVER_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(WRAITHWALKER_SERVER_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(1_000);
  });

  it("forces POST batching for extension-side local server traffic", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    const transport = createWraithWalkerServerTransportOptions(
      "http://127.0.0.1:4319/trpc",
      {
        timeoutMs: 42,
        fetchImpl
      }
    );

    expect(transport.url).toBe("http://127.0.0.1:4319/trpc");
    expect(transport.methodOverride).toBe("POST");
    expect(await transport.headers()).toEqual({
      "x-trpc-source": WRAITHWALKER_SERVER_SOURCE_HEADER
    });

    await transport.fetch("http://127.0.0.1:4319/trpc/system.info", {
      method: "POST"
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:4319/trpc/system.info",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal)
      })
    );
  });
});

describe("bound wraithwalker server client", () => {
  it("routes system methods through the expected procedures", async () => {
    const { trpc, spies } = createTrpcClientDouble();
    const client = bindWraithWalkerServerClient(trpc);

    await expect(client.getSystemInfo()).resolves.toEqual({ name: "server" });
    await expect(client.revealRoot()).resolves.toEqual({
      ok: true,
      command: "open-root"
    });
    expect(spies.getSystemInfo).toHaveBeenCalledWith();
    expect(spies.revealRoot).toHaveBeenCalledWith();
  });

  it("routes scenario list and switch methods without reshaping payloads", async () => {
    const { trpc, spies } = createTrpcClientDouble();
    const client = bindWraithWalkerServerClient(trpc);

    await client.listScenarios();
    await client.switchScenario("baseline");
    await client.diffScenarios("baseline", "candidate");
    expect(spies.listScenarios).toHaveBeenCalledWith();
    expect(spies.switchScenario).toHaveBeenCalledWith({ name: "baseline" });
    expect(spies.diffScenarios).toHaveBeenCalledWith({
      scenarioA: "baseline",
      scenarioB: "candidate"
    });
  });

  it("omits undefined descriptions for scenario saves", async () => {
    const { trpc, spies } = createTrpcClientDouble();
    const client = bindWraithWalkerServerClient(trpc);

    await client.saveScenario("baseline");
    await client.saveScenario("baseline", "Saved by hand.");
    await client.saveScenarioFromTrace("trace-save");
    await client.saveScenarioFromTrace("trace-save", "Saved from trace.");
    expect(spies.saveScenario).toHaveBeenNthCalledWith(1, {
      name: "baseline"
    });
    expect(spies.saveScenario).toHaveBeenNthCalledWith(2, {
      name: "baseline",
      description: "Saved by hand."
    });
    expect(spies.saveScenarioFromTrace).toHaveBeenNthCalledWith(1, {
      name: "trace-save"
    });
    expect(spies.saveScenarioFromTrace).toHaveBeenNthCalledWith(2, {
      name: "trace-save",
      description: "Saved from trace."
    });
  });

  it("passes heartbeat payloads through unchanged", async () => {
    const { trpc, spies } = createTrpcClientDouble();
    const client = bindWraithWalkerServerClient(trpc);
    const payload: ServerHeartbeatPayload = {
      clientId: "client-1",
      extensionVersion: "0.2.0",
      sessionActive: true,
      enabledOrigins: ["https://app.example.com"],
      recentConsoleEntries: [
        {
          level: "error",
          message: "Boom",
          url: "https://app.example.com",
          timestamp: "2026-04-14T00:00:00.000Z"
        }
      ],
      completedCommands: [
        {
          commandId: "command-1",
          type: "refresh_config",
          ok: true,
          completedAt: "2026-04-14T00:00:01.000Z"
        }
      ]
    };

    await client.heartbeat(payload);
    expect(spies.heartbeat).toHaveBeenCalledWith(payload);
  });

  it("passes config and fixture payloads through unchanged", async () => {
    const { trpc, spies } = createTrpcClientDouble();
    const client = bindWraithWalkerServerClient(trpc);
    const descriptor = {
      bodyPath: "fixtures/example.body",
      requestPath: "fixtures/example.request.json",
      metaPath: "fixtures/example.meta.json"
    };
    const siteConfigs = [
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-14T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.mjs$"]
      }
    ];
    const writePayload: WriteFixtureIfAbsentPayload = {
      descriptor,
      request: {
        method: "GET",
        url: "https://app.example.com/api/example",
        headers: {}
      },
      response: {
        body: "body",
        bodyEncoding: "utf8",
        meta: {
          status: 200,
          mimeType: "application/json",
          resourceType: "Fetch",
          fetchedAt: "2026-04-14T00:00:00.000Z"
        }
      }
    };
    const generateContextPayload: GenerateContextPayload = {
      siteConfigs,
      editorId: "cursor"
    };

    await client.hasFixture(descriptor);
    await client.readConfiguredSiteConfigs();
    await client.readEffectiveSiteConfigs();
    await client.writeConfiguredSiteConfigs(siteConfigs);
    await client.readFixture(descriptor);
    await client.writeFixtureIfAbsent(writePayload);
    await client.generateContext(generateContextPayload);
    expect(spies.hasFixture).toHaveBeenCalledWith({ descriptor });
    expect(spies.readConfiguredSiteConfigs).toHaveBeenCalledWith();
    expect(spies.readEffectiveSiteConfigs).toHaveBeenCalledWith();
    expect(spies.writeConfiguredSiteConfigs).toHaveBeenCalledWith({
      siteConfigs
    });
    expect(spies.readFixture).toHaveBeenCalledWith({ descriptor });
    expect(spies.writeFixtureIfAbsent).toHaveBeenCalledWith(writePayload);
    expect(spies.generateContext).toHaveBeenCalledWith(
      generateContextPayload
    );
  });

  it("passes trace payloads through unchanged", async () => {
    const { trpc, spies } = createTrpcClientDouble();
    const client = bindWraithWalkerServerClient(trpc);
    const recordPayload: RecordTraceClickPayload = {
      traceId: "trace-1",
      step: {
        stepId: "step-1",
        tabId: 7,
        recordedAt: "2026-04-14T00:00:00.000Z",
        pageUrl: "https://app.example.com/settings",
        topOrigin: "https://app.example.com",
        selector: "#save",
        tagName: "button",
        textSnippet: "Save"
      }
    };
    const linkPayload: LinkTraceFixturePayload = {
      traceId: "trace-1",
      tabId: 7,
      requestedAt: "2026-04-14T00:00:01.000Z",
      fixture: {
        bodyPath: "fixtures/example.body",
        requestUrl: "https://app.example.com/api/example",
        resourceType: "Fetch",
        capturedAt: "2026-04-14T00:00:01.000Z"
      }
    };

    await client.recordTraceClick(recordPayload);
    await client.linkTraceFixture(linkPayload);
    expect(spies.recordTraceClick).toHaveBeenCalledWith(recordPayload);
    expect(spies.linkTraceFixture).toHaveBeenCalledWith(linkPayload);
  });
});

describe("wraithwalker server client construction", () => {
  it("builds the trpc client with httpBatchLink and transport options", async () => {
    vi.resetModules();

    const fetchImpl = vi.fn<typeof fetch>();
    const trpc = createTrpcClientDouble().trpc;
    const transportOptions = {
      url: "http://127.0.0.1:4319/trpc",
      methodOverride: "POST" as const
    };
    const batchLink = { kind: "batch-link" };
    const createTRPCClientMock = vi.fn(() => trpc as any);
    const httpBatchLinkMock = vi.fn(() => batchLink as any);
    const createTransportOptionsMock = vi.fn(() => transportOptions);

    vi.doMock("@trpc/client", () => ({
      createTRPCClient: createTRPCClientMock,
      httpBatchLink: httpBatchLinkMock
    }));
    vi.doMock("../src/lib/wraithwalker-server.transport.js", () => ({
      createWraithWalkerServerTransportOptions: createTransportOptionsMock
    }));

    const { createWraithWalkerServerClient } = await import(
      "../src/lib/wraithwalker-server.client.js"
    );

    createWraithWalkerServerClient("http://127.0.0.1:4319/trpc", {
      timeoutMs: 42,
      fetchImpl
    });

    expect(createTransportOptionsMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4319/trpc",
      {
        timeoutMs: 42,
        fetchImpl
      }
    );
    expect(httpBatchLinkMock).toHaveBeenCalledWith(transportOptions);
    expect(createTRPCClientMock).toHaveBeenCalledWith({
      links: [batchLink]
    });
  });
});
