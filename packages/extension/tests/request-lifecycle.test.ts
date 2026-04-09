import { promises as fs } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createRequestLifecycle } from "../src/lib/request-lifecycle.js";
import { createFixtureDescriptor as realCreateFixtureDescriptor } from "../src/lib/fixture-mapper.js";
import type { SiteConfig } from "../src/lib/types.js";
import { createWraithWalkerServerClient } from "../src/lib/wraithwalker-server.js";
import { startHttpServer } from "../../mcp-server/src/server.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

interface LifecycleHarnessOptions {
  siteConfig?: SiteConfig;
  createFixtureDescriptor?: typeof realCreateFixtureDescriptor;
}

function createServerBackedRepository(serverClient: ReturnType<typeof createWraithWalkerServerClient>) {
  return {
    exists: async (descriptor: Awaited<ReturnType<typeof realCreateFixtureDescriptor>>) => (
      await serverClient.hasFixture(descriptor)
    ).exists,
    read: async (descriptor: Awaited<ReturnType<typeof realCreateFixtureDescriptor>>) => {
      const fixture = await serverClient.readFixture(descriptor);
      if (!fixture.exists) {
        return null;
      }

      return {
        request: fixture.request,
        meta: fixture.meta,
        bodyBase64: fixture.bodyBase64,
        size: fixture.size
      };
    },
    writeIfAbsent: (payload: Parameters<NonNullable<Parameters<typeof createRequestLifecycle>[0]["repository"]>["writeIfAbsent"]>[0]) => (
      serverClient.writeFixtureIfAbsent(payload)
    )
  };
}

function createServerBackedLifecycleHarness({
  serverClient,
  siteConfig,
  responseBodies = {}
}: {
  serverClient: ReturnType<typeof createWraithWalkerServerClient>;
  siteConfig: SiteConfig;
  responseBodies?: Record<string, { body: string; base64Encoded: boolean }>;
}) {
  const state = {
    sessionActive: true,
    attachedTabs: new Map([[1, { topOrigin: siteConfig.origin }]]),
    requests: new Map<string, any>()
  };
  const sendDebuggerCommandMock = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
    if (method === "Network.getResponseBody") {
      const requestId = String(params?.requestId ?? "");
      return responseBodies[requestId] ?? { body: "", base64Encoded: false };
    }
    return { method, params };
  });
  const sendDebuggerCommand: Parameters<typeof createRequestLifecycle>[0]["sendDebuggerCommand"] =
    ((tabId, method, params) => sendDebuggerCommandMock(tabId, method, params) as Promise<any>);
  const lifecycle = createRequestLifecycle({
    state,
    sendDebuggerCommand,
    sendOffscreenMessage: vi.fn(async () => ({ ok: true })) as Parameters<typeof createRequestLifecycle>[0]["sendOffscreenMessage"],
    setLastError: vi.fn(),
    repository: createServerBackedRepository(serverClient),
    createFixtureDescriptor: realCreateFixtureDescriptor,
    getSiteConfigForOrigin: vi.fn((topOrigin) => (
      topOrigin === siteConfig.origin
        ? siteConfig
        : undefined
    ))
  });

  return {
    state,
    lifecycle,
    sendDebuggerCommand: sendDebuggerCommandMock
  };
}

function createLifecycleHarness({ siteConfig, createFixtureDescriptor }: LifecycleHarnessOptions = {}) {
  const state = {
    sessionActive: true,
    attachedTabs: new Map([[1, { topOrigin: "https://app.example.com" }]]),
    requests: new Map<string, any>()
  };

  const sendDebuggerCommandMock = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
    if (method === "Network.getRequestPostData") {
      return { postData: '{"seed":"one"}', base64Encoded: false };
    }
    if (method === "Network.getResponseBody") {
      return { body: '{"ok":true}', base64Encoded: false };
    }
    return { method, params };
  });
  const sendDebuggerCommand: Parameters<typeof createRequestLifecycle>[0]["sendDebuggerCommand"] =
    ((tabId, method, params) => sendDebuggerCommandMock(tabId, method, params) as Promise<any>);
  const sendOffscreenMessageMock = vi.fn(async (type: string, _payload?: Record<string, unknown>) => {
    if (type === "fs.hasFixture") {
      return { ok: true, exists: false };
    }
    if (type === "fs.readFixture") {
      return {
        ok: true,
        exists: true,
        request: {
          topOrigin: "https://app.example.com",
          url: "https://cdn.example.com/app.js",
          method: "GET",
          headers: [],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: "",
          queryHash: "",
          capturedAt: "2026-04-03T00:00:00.000Z"
        },
        bodyBase64: "eyJsb2NhbCI6dHJ1ZX0=",
        meta: {
          status: 200,
          statusText: "OK",
          headers: [
            { name: "Content-Type", value: "application/json" },
            { name: "Content-Length", value: "10" }
          ]
        }
      };
    }
    return { ok: true };
  });
  const sendOffscreenMessage: Parameters<typeof createRequestLifecycle>[0]["sendOffscreenMessage"] =
    ((type, payload) => sendOffscreenMessageMock(type, payload) as Promise<any>);
  const setLastError = vi.fn();
  const fixtureDescriptorFactory = createFixtureDescriptor || vi.fn(async ({ method, url }) => ({
    method,
    requestUrl: url,
    bodyPath: "body",
    requestPath: "request.json",
    metaPath: "response.meta.json",
    topOrigin: "https://app.example.com",
    topOriginKey: "https__app.example.com",
    requestOrigin: "https://cdn.example.com",
    requestOriginKey: "https__cdn.example.com",
    postDataEncoding: "utf8",
    queryHash: "",
    bodyHash: "",
    manifestPath: null,
    metadataOptional: false,
    slug: "body",
    assetLike: true,
    storageMode: "asset"
  }) as any);

  const lifecycle = createRequestLifecycle({
    state,
    sendDebuggerCommand,
    sendOffscreenMessage,
    setLastError,
    createFixtureDescriptor: fixtureDescriptorFactory,
    getSiteConfigForOrigin: siteConfig
      ? vi.fn((topOrigin) => (topOrigin === "https://app.example.com" ? siteConfig : undefined))
      : undefined
  });

  return {
    state,
    lifecycle,
    sendDebuggerCommand: sendDebuggerCommandMock,
    sendOffscreenMessage: sendOffscreenMessageMock,
    setLastError,
    createFixtureDescriptor: fixtureDescriptorFactory
  };
}

function createFetchPausedParams(overrides: { request?: Record<string, unknown> } & Record<string, unknown> = {}) {
  const { request: requestOverrides = {}, ...restOverrides } = overrides;
  const baseRequest = {
    method: "GET",
    url: "https://cdn.example.com/app.js",
    headers: {}
  };

  return {
    requestId: "fetch-1",
    networkId: "network-1",
    request: {
      ...baseRequest,
      ...requestOverrides
    },
    resourceType: "Script",
    ...restOverrides
  };
}

describe("request lifecycle", () => {
  it("uses inline fallback postData before consulting the debugger", async () => {
    const harness = createLifecycleHarness();

    const result = await harness.lifecycle.populatePostData(1, "req-inline", {
      postData: '{"mode":"inline"}'
    });

    expect(result).toEqual({
      body: '{"mode":"inline"}',
      encoding: "utf8"
    });
    expect(harness.sendDebuggerCommand).not.toHaveBeenCalledWith(1, "Network.getRequestPostData", expect.anything());
  });

  it("falls back to an empty body when request post data lookup fails", async () => {
    const harness = createLifecycleHarness();
    harness.sendDebuggerCommand.mockRejectedValueOnce(new Error("request body unavailable"));

    const result = await harness.lifecycle.populatePostData(1, "req-missing");

    expect(result).toEqual({
      body: "",
      encoding: "utf8"
    });
  });

  it("reuses an existing descriptor without recreating it", async () => {
    const harness = createLifecycleHarness();
    const descriptor = { bodyPath: "existing", requestPath: "request", metaPath: "meta" } as any;
    const entry = {
      tabId: 1,
      requestId: "req-existing",
      requestedAt: "2026-04-08T00:00:00.000Z",
      descriptor,
      method: "GET",
      url: "https://cdn.example.com/app.js",
      requestHeaders: [],
      requestBody: "",
      requestBodyEncoding: "utf8",
      resourceType: "Script",
      mimeType: "application/javascript",
      topOrigin: "https://app.example.com",
      replayed: false,
      responseStatus: 200,
      responseStatusText: "OK",
      responseHeaders: []
    };

    const result = await harness.lifecycle.ensureDescriptor(entry);

    expect(result).toBe(descriptor);
    expect(harness.createFixtureDescriptor).not.toHaveBeenCalled();
  });

  it("ignores paused requests with no tab, inactive session, or unattached tab", async () => {
    const harness = createLifecycleHarness();

    await harness.lifecycle.handleFetchRequestPaused({}, createFetchPausedParams());
    harness.state.sessionActive = false;
    await harness.lifecycle.handleFetchRequestPaused({ tabId: 1 }, createFetchPausedParams());
    harness.state.sessionActive = true;
    harness.state.attachedTabs.clear();
    await harness.lifecycle.handleFetchRequestPaused({ tabId: 1 }, createFetchPausedParams());

    expect(harness.sendDebuggerCommand).not.toHaveBeenCalledWith(1, "Fetch.continueRequest", expect.anything());
    expect(harness.sendOffscreenMessage).not.toHaveBeenCalled();
  });

  it("continues paused requests that already have a response status", async () => {
    const harness = createLifecycleHarness();

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({ responseStatusCode: 200 })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(1, "Fetch.continueRequest", { requestId: "fetch-1" });
  });

  it("continues paused requests that already have an error reason", async () => {
    const harness = createLifecycleHarness();

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({ responseErrorReason: "Failed" })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(1, "Fetch.continueRequest", { requestId: "fetch-1" });
  });

  it("continues paused requests for non-http URLs", async () => {
    const harness = createLifecycleHarness();

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        request: {
          url: "data:text/plain,hello"
        }
      })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(1, "Fetch.continueRequest", { requestId: "fetch-1" });
  });

  it("continues the request when no fixture exists", async () => {
    const harness = createLifecycleHarness();

    await harness.lifecycle.handleFetchRequestPaused({ tabId: 1 }, createFetchPausedParams());

    expect(harness.sendOffscreenMessage).toHaveBeenCalledWith("fs.hasFixture", expect.any(Object));
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(1, "Fetch.continueRequest", { requestId: "fetch-1" });
  });

  it("fulfills the request when a fixture exists", async () => {
    const harness = createLifecycleHarness();
    harness.sendOffscreenMessage.mockImplementation(async (type) => {
      if (type === "fs.hasFixture") {
        return { ok: true, exists: true };
      }
      if (type === "fs.readFixture") {
        return {
          ok: true,
          exists: true,
          request: {
            topOrigin: "https://app.example.com",
            url: "https://api.example.com/state",
            method: "GET",
            headers: [],
            body: "",
            bodyEncoding: "utf8",
            bodyHash: "",
            queryHash: "",
            capturedAt: "2026-04-03T00:00:00.000Z"
          },
          bodyBase64: "eyJsb2NhbCI6dHJ1ZX0=",
          meta: {
            status: 200,
            statusText: "OK",
            headers: [
              { name: "Content-Type", value: "application/json" },
              { name: "Content-Length", value: "10" }
            ]
          }
        };
      }
      return { ok: true };
    });

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-2",
        networkId: "network-2",
        request: {
          url: "https://api.example.com/state"
        },
        resourceType: "XHR"
      })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.fulfillRequest",
      expect.objectContaining({
        requestId: "fetch-2",
        responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }]
      })
    );
  });

  it("fetches request post data for non-GET paused requests", async () => {
    const harness = createLifecycleHarness();

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-post",
        networkId: "network-post",
        request: {
          method: "POST",
          url: "https://api.example.com/graphql"
        },
        resourceType: "XHR"
      })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(1, "Network.getRequestPostData", { requestId: "network-post" });
    expect(harness.state.requests.get("1:network-post")).toMatchObject({
      requestBody: '{"seed":"one"}',
      requestBodyEncoding: "utf8"
    });
  });

  it("falls back to the paused request id when networkId is missing", async () => {
    const harness = createLifecycleHarness();

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-post-no-network",
        networkId: undefined,
        request: {
          method: "POST",
          url: "https://api.example.com/graphql"
        },
        resourceType: "XHR"
      })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(1, "Network.getRequestPostData", {
      requestId: "fetch-post-no-network"
    });
    expect(harness.state.requests.get("1:fetch-post-no-network")).toMatchObject({
      requestId: "fetch-post-no-network",
      requestBody: '{"seed":"one"}',
      requestBodyEncoding: "utf8"
    });
  });

  it("uses the shared fixture pipeline for non-GET simple-mode requests", async () => {
    const harness = createLifecycleHarness({
      siteConfig: {
        origin: "https://app.example.com",
        createdAt: "2026-04-03T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.m?(js|ts)x?$"]
      }
    });

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-simple-post",
        networkId: "network-simple-post",
        request: {
          method: "POST",
          url: "https://api.example.com/graphql"
        },
        resourceType: "XHR"
      })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(1, "Network.getRequestPostData", { requestId: "network-simple-post" });
    expect(harness.sendOffscreenMessage).toHaveBeenCalledWith("fs.hasFixture", expect.any(Object));
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(1, "Fetch.continueRequest", { requestId: "fetch-simple-post" });
  });

  it("replays simple-mode files even when the dump allowlist would not match", async () => {
    const harness = createLifecycleHarness({
      siteConfig: {
        origin: "https://app.example.com",
        createdAt: "2026-04-03T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.css$"]
      },
      createFixtureDescriptor: realCreateFixtureDescriptor
    });
    harness.sendOffscreenMessage.mockImplementation(async (type) => {
      if (type === "fs.hasFixture") {
        return { ok: true, exists: true };
      }
      if (type === "fs.readFixture") {
        return {
          ok: true,
          exists: true,
          request: {
            topOrigin: "https://app.example.com",
            url: "https://cdn.example.com/assets/app.js",
            method: "GET",
            headers: [],
            body: "",
            bodyEncoding: "utf8",
            bodyHash: "",
            queryHash: "",
            capturedAt: "2026-04-03T00:00:00.000Z"
          },
          bodyBase64: "Y29uc29sZS5sb2coJ3NpbXBsZScpOw==",
          meta: {
            status: 200,
            statusText: "OK",
            headers: [{ name: "Content-Type", value: "application/javascript" }]
          }
        };
      }
      return { ok: true };
    });

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-simple-hit",
        networkId: "network-simple-hit",
        request: {
          method: "GET",
          url: "https://cdn.example.com/assets/app.js"
        },
        resourceType: "Script"
      })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.fulfillRequest",
      expect.objectContaining({
        requestId: "fetch-simple-hit",
        responseCode: 200
      })
    );
  });

  it("falls back to continueRequest when fixture read fails after a positive existence check", async () => {
    const harness = createLifecycleHarness();
    harness.sendOffscreenMessage.mockImplementation(async (type) => {
      if (type === "fs.hasFixture") {
        return { ok: true, exists: true };
      }
      if (type === "fs.readFixture") {
        return { ok: false, error: "fixture metadata corrupt" };
      }
      return { ok: true };
    });

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-read-fail",
        networkId: "network-read-fail"
      })
    );

    expect(harness.setLastError).toHaveBeenCalledWith("fixture metadata corrupt");
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(1, "Fetch.continueRequest", { requestId: "fetch-read-fail" });
  });

  it("falls back to continueRequest when fixture existence lookup fails", async () => {
    const harness = createLifecycleHarness();
    harness.sendOffscreenMessage.mockImplementation(async (type) => {
      if (type === "fs.hasFixture") {
        return { ok: false, error: "fixture existence lookup failed" };
      }
      return { ok: true };
    });

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-exists-fail",
        networkId: "network-exists-fail"
      })
    );

    expect(harness.setLastError).toHaveBeenCalledWith("fixture existence lookup failed");
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(1, "Fetch.continueRequest", {
      requestId: "fetch-exists-fail"
    });
  });

  it("falls back to continueRequest when fixture read returns no payload", async () => {
    const harness = createLifecycleHarness();
    harness.sendOffscreenMessage.mockImplementation(async (type) => {
      if (type === "fs.hasFixture") {
        return { ok: true, exists: true };
      }
      if (type === "fs.readFixture") {
        return { ok: true, exists: false };
      }
      return { ok: true };
    });

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-read-empty",
        networkId: "network-read-empty"
      })
    );

    expect(harness.setLastError).toHaveBeenCalledWith("Fixture lookup failed.");
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(1, "Fetch.continueRequest", { requestId: "fetch-read-empty" });
  });

  it("falls back to continueRequest when fixture read is missing required payload fields", async () => {
    const harness = createLifecycleHarness();
    harness.sendOffscreenMessage.mockImplementation(async (type) => {
      if (type === "fs.hasFixture") {
        return { ok: true, exists: true };
      }
      if (type === "fs.readFixture") {
        return {
          ok: true,
          exists: true,
          request: {
            topOrigin: "https://app.example.com",
            url: "https://cdn.example.com/app.js",
            method: "GET",
            headers: [],
            body: "",
            bodyEncoding: "utf8",
            bodyHash: "",
            queryHash: "",
            capturedAt: "2026-04-03T00:00:00.000Z"
          },
          meta: {
            status: 200,
            statusText: "OK",
            headers: [{ name: "Content-Type", value: "application/javascript" }]
          }
        } as any;
      }
      return { ok: true };
    });

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-read-partial",
        networkId: "network-read-partial"
      })
    );

    expect(harness.setLastError).toHaveBeenCalledWith("Fixture lookup failed.");
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(1, "Fetch.continueRequest", {
      requestId: "fetch-read-partial"
    });
  });

  it("captures a finished live response and writes a fixture", async () => {
    const harness = createLifecycleHarness();

    harness.lifecycle.handleNetworkRequestWillBeSent(
      { tabId: 1 },
      {
        requestId: "req-3",
        request: {
          method: "POST",
          url: "https://api.example.com/graphql",
          headers: { "Content-Type": "application/json" }
        },
        type: "XHR"
      }
    );
    harness.lifecycle.handleNetworkResponseReceived(
      { tabId: 1 },
      {
        requestId: "req-3",
        response: {
          status: 201,
          statusText: "Created",
          headers: { "Content-Type": "application/json" },
          mimeType: "application/json"
        },
        type: "XHR"
      }
    );

    await harness.lifecycle.handleNetworkLoadingFinished({ tabId: 1 }, { requestId: "req-3" });

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(1, "Network.getRequestPostData", { requestId: "req-3" });
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(1, "Network.getResponseBody", { requestId: "req-3" });
    expect(harness.sendOffscreenMessage).toHaveBeenCalledWith(
      "fs.writeFixture",
      expect.objectContaining({
        request: expect.objectContaining({
          method: "POST",
          url: "https://api.example.com/graphql"
        })
      })
    );
    expect(harness.state.requests.size).toBe(0);
  });

  it("preserves base64 request and response bodies when persisting fixtures", async () => {
    const harness = createLifecycleHarness();
    harness.sendDebuggerCommand.mockImplementation(async (_tabId, method, params) => {
      if (method === "Network.getRequestPostData") {
        return {
          postData: Buffer.from('{"seed":"base64"}', "utf8").toString("base64"),
          base64Encoded: true
        };
      }
      if (method === "Network.getResponseBody") {
        return {
          body: Buffer.from('{"ok":true}', "utf8").toString("base64"),
          base64Encoded: true
        };
      }
      return { method, params };
    });

    harness.lifecycle.handleNetworkRequestWillBeSent(
      { tabId: 1 },
      {
        requestId: "req-base64",
        request: {
          method: "POST",
          url: "https://api.example.com/graphql",
          headers: { "Content-Type": "application/json" }
        },
        type: "XHR"
      }
    );
    harness.lifecycle.handleNetworkResponseReceived(
      { tabId: 1 },
      {
        requestId: "req-base64",
        response: {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" },
          mimeType: "application/json"
        },
        type: "XHR"
      }
    );

    await harness.lifecycle.handleNetworkLoadingFinished({ tabId: 1 }, { requestId: "req-base64" });

    expect(harness.sendOffscreenMessage).toHaveBeenCalledWith(
      "fs.writeFixture",
      expect.objectContaining({
        request: expect.objectContaining({
          body: Buffer.from('{"seed":"base64"}', "utf8").toString("base64"),
          bodyEncoding: "base64"
        }),
        response: expect.objectContaining({
          body: Buffer.from('{"ok":true}', "utf8").toString("base64"),
          bodyEncoding: "base64",
          meta: expect.objectContaining({
            bodyEncoding: "base64"
          })
        })
      })
    );
  });

  it("records fixture write failures through lastError and still clears the request entry", async () => {
    const harness = createLifecycleHarness();
    harness.sendOffscreenMessage.mockImplementation(async (type) => {
      if (type === "fs.writeFixture") {
        return { ok: false, error: "Fixture write failed remotely." };
      }
      if (type === "fs.hasFixture") {
        return { ok: true, exists: false };
      }
      return { ok: true };
    });

    harness.lifecycle.handleNetworkRequestWillBeSent(
      { tabId: 1 },
      {
        requestId: "req-write-fail",
        request: {
          method: "POST",
          url: "https://api.example.com/graphql",
          headers: { "Content-Type": "application/json" }
        },
        type: "XHR"
      }
    );
    harness.lifecycle.handleNetworkResponseReceived(
      { tabId: 1 },
      {
        requestId: "req-write-fail",
        response: {
          status: 201,
          statusText: "Created",
          headers: { "Content-Type": "application/json" },
          mimeType: "application/json"
        },
        type: "XHR"
      }
    );

    await harness.lifecycle.handleNetworkLoadingFinished({ tabId: 1 }, { requestId: "req-write-fail" });

    expect(harness.setLastError).toHaveBeenCalledWith("Fixture write failed remotely.");
    expect(harness.state.requests.size).toBe(0);
  });

  it("ignores loading-finished events without a tab id", async () => {
    const harness = createLifecycleHarness();
    harness.state.requests.set("1:req-no-tab", { requestId: "req-no-tab" } as any);

    await harness.lifecycle.handleNetworkLoadingFinished({}, { requestId: "req-no-tab" });

    expect(harness.sendDebuggerCommand).not.toHaveBeenCalledWith(1, "Network.getResponseBody", expect.anything());
    expect(harness.state.requests.has("1:req-no-tab")).toBe(true);
  });

  it("writes captured simple-mode assets into the live server root instead of the local fallback root", async () => {
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-live-server-"
    });
    const localRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-local-root-"
    });
    const server = await startHttpServer(serverRoot.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const serverClient = createWraithWalkerServerClient(server.trpcUrl, {
      timeoutMs: 2_000
    });
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-07T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.js$"]
    };
    const state = {
      sessionActive: true,
      attachedTabs: new Map([[1, { topOrigin: "https://app.example.com" }]]),
      requests: new Map<string, any>()
    };
    const sendDebuggerCommandMock = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Network.getResponseBody") {
        return {
          body: "console.log('from live server');",
          base64Encoded: false
        };
      }
      return { method, params };
    });

    const lifecycle = createRequestLifecycle({
      state,
      sendDebuggerCommand: ((tabId, method, params) => sendDebuggerCommandMock(tabId, method, params) as Promise<any>),
      sendOffscreenMessage: vi.fn(async () => ({ ok: true })) as Parameters<typeof createRequestLifecycle>[0]["sendOffscreenMessage"],
      setLastError: vi.fn(),
      repository: {
        exists: async (descriptor) => (await serverClient.hasFixture(descriptor)).exists,
        read: async (descriptor) => {
          const fixture = await serverClient.readFixture(descriptor);
          if (!fixture.exists) {
            return null;
          }

          return {
            request: fixture.request,
            meta: fixture.meta,
            bodyBase64: fixture.bodyBase64,
            size: fixture.size
          };
        },
        writeIfAbsent: (payload) => serverClient.writeFixtureIfAbsent(payload)
      },
      createFixtureDescriptor: realCreateFixtureDescriptor,
      getSiteConfigForOrigin: vi.fn((topOrigin) => (
        topOrigin === "https://app.example.com"
          ? siteConfig
          : undefined
      ))
    });
    const descriptor = await realCreateFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/app.js",
      resourceType: "Script",
      mimeType: "application/javascript"
    });

    try {
      lifecycle.handleNetworkRequestWillBeSent(
        { tabId: 1 },
        {
          requestId: "req-live-server",
          request: {
            method: "GET",
            url: descriptor.requestUrl,
            headers: {}
          },
          type: "Script"
        }
      );
      lifecycle.handleNetworkResponseReceived(
        { tabId: 1 },
        {
          requestId: "req-live-server",
          response: {
            status: 200,
            statusText: "OK",
            headers: { "Content-Type": "application/javascript" },
            mimeType: "application/javascript"
          },
          type: "Script"
        }
      );

      await lifecycle.handleNetworkLoadingFinished({ tabId: 1 }, { requestId: "req-live-server" });

      expect(await fs.readFile(serverRoot.resolve(descriptor.bodyPath), "utf8")).toBe("console.log('from live server');");
      expect(await serverRoot.readJson(descriptor.requestPath)).toEqual(expect.objectContaining({
        topOrigin: "https://app.example.com",
        url: descriptor.requestUrl,
        method: "GET"
      }));
      expect(await serverRoot.readJson(descriptor.metaPath)).toEqual(expect.objectContaining({
        status: 200,
        mimeType: "application/javascript",
        resourceType: "Script"
      }));
      expect(await serverRoot.readJson(descriptor.manifestPath || "")).toEqual(expect.objectContaining({
        resourcesByPathname: expect.objectContaining({
          "/assets/app.js": [
            expect.objectContaining({
              bodyPath: descriptor.bodyPath,
              requestPath: descriptor.requestPath,
              metaPath: descriptor.metaPath
            })
          ]
        })
      }));
      expect(await serverClient.hasFixture(descriptor)).toEqual(expect.objectContaining({
        exists: true
      }));
      await expect(fs.access(localRoot.resolve(descriptor.bodyPath))).rejects.toThrow();
      await expect(fs.access(localRoot.resolve(descriptor.requestPath))).rejects.toThrow();
      await expect(fs.access(localRoot.resolve(descriptor.metaPath))).rejects.toThrow();
      if (descriptor.manifestPath) {
        await expect(fs.access(localRoot.resolve(descriptor.manifestPath))).rejects.toThrow();
      }
      expect(state.requests.size).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("captures using server-provided site config from .wraithwalker/config.json before any fixtures exist", async () => {
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-server-config-"
    });
    await serverRoot.writeProjectConfig({
      schemaVersion: 1,
      sites: [{
        origin: "https://app.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.svg$"]
      }]
    });
    const server = await startHttpServer(serverRoot.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const serverClient = createWraithWalkerServerClient(server.trpcUrl, {
      timeoutMs: 2_000
    });
    const state = {
      sessionActive: true,
      attachedTabs: new Map([[1, { topOrigin: "https://app.example.com" }]]),
      requests: new Map<string, any>()
    };
    const sendDebuggerCommandMock = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Network.getResponseBody") {
        return {
          body: "<svg viewBox=\"0 0 10 10\"></svg>",
          base64Encoded: false
        };
      }
      return { method, params };
    });
    const systemInfo = await serverClient.getSystemInfo();
    const serverSiteConfig = systemInfo.siteConfigs.find((siteConfig) => siteConfig.origin === "https://app.example.com");

    expect(systemInfo.siteConfigs).toEqual([
      expect.objectContaining({
        origin: "https://app.example.com",
        dumpAllowlistPatterns: ["\\.svg$"]
      })
    ]);
    expect(serverSiteConfig).toBeTruthy();

    const lifecycle = createRequestLifecycle({
      state,
      sendDebuggerCommand: ((tabId, method, params) => sendDebuggerCommandMock(tabId, method, params) as Promise<any>),
      sendOffscreenMessage: vi.fn(async () => ({ ok: true })) as Parameters<typeof createRequestLifecycle>[0]["sendOffscreenMessage"],
      setLastError: vi.fn(),
      repository: {
        exists: async (descriptor) => (await serverClient.hasFixture(descriptor)).exists,
        read: async (descriptor) => {
          const fixture = await serverClient.readFixture(descriptor);
          if (!fixture.exists) {
            return null;
          }

          return {
            request: fixture.request,
            meta: fixture.meta,
            bodyBase64: fixture.bodyBase64,
            size: fixture.size
          };
        },
        writeIfAbsent: (payload) => serverClient.writeFixtureIfAbsent(payload)
      },
      createFixtureDescriptor: realCreateFixtureDescriptor,
      getSiteConfigForOrigin: vi.fn((topOrigin) => (
        topOrigin === "https://app.example.com"
          ? serverSiteConfig
          : undefined
      ))
    });
    const descriptor = await realCreateFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/logo.svg",
      resourceType: "Image",
      mimeType: "image/svg+xml"
    });

    try {
      lifecycle.handleNetworkRequestWillBeSent(
        { tabId: 1 },
        {
          requestId: "req-server-config",
          request: {
            method: "GET",
            url: descriptor.requestUrl,
            headers: {}
          },
          type: "Image"
        }
      );
      lifecycle.handleNetworkResponseReceived(
        { tabId: 1 },
        {
          requestId: "req-server-config",
          response: {
            status: 200,
            statusText: "OK",
            headers: { "Content-Type": "image/svg+xml" },
            mimeType: "image/svg+xml"
          },
          type: "Image"
        }
      );

      await lifecycle.handleNetworkLoadingFinished({ tabId: 1 }, { requestId: "req-server-config" });

      expect(await fs.readFile(serverRoot.resolve(descriptor.bodyPath), "utf8")).toBe("<svg viewBox=\"0 0 10 10\"></svg>");
      expect(await serverRoot.readJson(descriptor.requestPath)).toEqual(expect.objectContaining({
        topOrigin: "https://app.example.com",
        url: descriptor.requestUrl
      }));
      expect(await serverRoot.readJson(descriptor.metaPath)).toEqual(expect.objectContaining({
        mimeType: "image/svg+xml",
        resourceType: "Image"
      }));
      expect(await serverRoot.readJson(descriptor.manifestPath || "")).toEqual(expect.objectContaining({
        resourcesByPathname: expect.objectContaining({
          "/assets/logo.svg": [
            expect.objectContaining({
              bodyPath: descriptor.bodyPath,
              requestPath: descriptor.requestPath,
              metaPath: descriptor.metaPath
            })
          ]
        })
      }));
    } finally {
      await server.close();
    }
  });

  it("replays the human-facing projection for a live tRPC-backed asset fixture through Fetch.fulfillRequest with sanitized headers", async () => {
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-live-replay-asset-"
    });
    const server = await startHttpServer(serverRoot.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const serverClient = createWraithWalkerServerClient(server.trpcUrl, {
      timeoutMs: 2_000
    });
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.js$"]
    };
    const descriptor = await realCreateFixtureDescriptor({
      topOrigin: siteConfig.origin,
      method: "GET",
      url: "https://cdn.example.com/assets/app.js",
      resourceType: "Script",
      mimeType: "application/javascript"
    });
    const body = "console.log('server replay');";

    try {
      await serverClient.writeFixtureIfAbsent({
        descriptor,
        request: {
          topOrigin: descriptor.topOrigin,
          url: descriptor.requestUrl,
          method: descriptor.method,
          headers: [],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: descriptor.bodyHash,
          queryHash: descriptor.queryHash,
          capturedAt: "2026-04-08T00:00:00.000Z"
        },
        response: {
          body,
          bodyEncoding: "utf8",
          meta: {
            status: 203,
            statusText: "Non-Authoritative Information",
            headers: [
              { name: "Content-Type", value: "application/javascript" },
              { name: "Content-Length", value: String(body.length) },
              { name: "Connection", value: "keep-alive" },
              { name: "Set-Cookie", value: "a=b" }
            ],
            mimeType: "application/javascript",
            resourceType: "Script",
            url: descriptor.requestUrl,
            method: descriptor.method,
            capturedAt: "2026-04-08T00:00:00.000Z",
            bodyEncoding: "utf8",
            bodySuggestedExtension: "js"
          }
        }
      });
      const harness = createServerBackedLifecycleHarness({ serverClient, siteConfig });

      await harness.lifecycle.handleFetchRequestPaused(
        { tabId: 1 },
        createFetchPausedParams({
          requestId: "fetch-live-server-asset",
          networkId: "network-live-server-asset",
          request: {
            method: "GET",
            url: descriptor.requestUrl,
            headers: {}
          },
          resourceType: "Script"
        })
      );

      expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
        1,
        "Fetch.fulfillRequest",
        {
          requestId: "fetch-live-server-asset",
          responseCode: 203,
          responsePhrase: "Non-Authoritative Information",
          responseHeaders: [
            { name: "Content-Type", value: "application/javascript" },
            { name: "Set-Cookie", value: "a=b" }
          ],
          body: Buffer.from("console.log(\"server replay\");", "utf8").toString("base64")
        }
      );
      expect(harness.state.requests.get("1:network-live-server-asset")).toMatchObject({
        replayed: true,
        topOrigin: siteConfig.origin,
        url: descriptor.requestUrl
      });
    } finally {
      await server.close();
    }
  });

  it("serves an edited human-facing projection body for a live tRPC-backed asset fixture", async () => {
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-live-replay-edited-projection-"
    });
    const server = await startHttpServer(serverRoot.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const serverClient = createWraithWalkerServerClient(server.trpcUrl, {
      timeoutMs: 2_000
    });
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.js$"]
    };
    const descriptor = await realCreateFixtureDescriptor({
      topOrigin: siteConfig.origin,
      method: "GET",
      url: "https://cdn.example.com/assets/app.js",
      resourceType: "Script",
      mimeType: "application/javascript"
    });

    try {
      await serverClient.writeFixtureIfAbsent({
        descriptor,
        request: {
          topOrigin: descriptor.topOrigin,
          url: descriptor.requestUrl,
          method: descriptor.method,
          headers: [],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: descriptor.bodyHash,
          queryHash: descriptor.queryHash,
          capturedAt: "2026-04-08T00:00:00.000Z"
        },
        response: {
          body: "console.log('canonical');",
          bodyEncoding: "utf8",
          meta: {
            status: 200,
            statusText: "OK",
            headers: [{ name: "Content-Type", value: "application/javascript" }],
            mimeType: "application/javascript",
            resourceType: "Script",
            url: descriptor.requestUrl,
            method: descriptor.method,
            capturedAt: "2026-04-08T00:00:00.000Z",
            bodyEncoding: "utf8",
            bodySuggestedExtension: "js"
          }
        }
      });
      await fs.writeFile(serverRoot.resolve(descriptor.projectionPath!), "window.__FROM_PROJECTION__ = true;\n");
      const harness = createServerBackedLifecycleHarness({ serverClient, siteConfig });

      await harness.lifecycle.handleFetchRequestPaused(
        { tabId: 1 },
        createFetchPausedParams({
          requestId: "fetch-live-server-edited-projection",
          networkId: "network-live-server-edited-projection",
          request: {
            method: "GET",
            url: descriptor.requestUrl,
            headers: {}
          },
          resourceType: "Script"
        })
      );

      expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
        1,
        "Fetch.fulfillRequest",
        expect.objectContaining({
          requestId: "fetch-live-server-edited-projection",
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/javascript" }],
          body: Buffer.from("window.__FROM_PROJECTION__ = true;\n", "utf8").toString("base64")
        })
      );
    } finally {
      await server.close();
    }
  });

  it("replays the query-specific CORS headers for live simple-mode asset variants", async () => {
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-live-replay-query-cors-"
    });
    const server = await startHttpServer(serverRoot.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const serverClient = createWraithWalkerServerClient(server.trpcUrl, {
      timeoutMs: 2_000
    });
    const siteConfig: SiteConfig = {
      origin: "https://domain-b.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.js$"]
    };
    const firstDescriptor = await realCreateFixtureDescriptor({
      topOrigin: siteConfig.origin,
      method: "GET",
      url: "https://domain-a.example.com/a.js?prop1=&prop2=B",
      resourceType: "Script",
      mimeType: "application/javascript"
    });
    const secondDescriptor = await realCreateFixtureDescriptor({
      topOrigin: siteConfig.origin,
      method: "GET",
      url: "https://domain-a.example.com/a.js?cache-bust=true&retry-attempt=2",
      resourceType: "Script",
      mimeType: "application/javascript"
    });
    const body = "console.log('shared variant body');";

    expect(firstDescriptor.bodyPath).not.toBe(secondDescriptor.bodyPath);
    expect(firstDescriptor.projectionPath).toBe(secondDescriptor.projectionPath);
    expect(firstDescriptor.metaPath).not.toBe(secondDescriptor.metaPath);

    try {
      await serverClient.writeFixtureIfAbsent({
        descriptor: firstDescriptor,
        request: {
          topOrigin: firstDescriptor.topOrigin,
          url: firstDescriptor.requestUrl,
          method: firstDescriptor.method,
          headers: [],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: firstDescriptor.bodyHash,
          queryHash: firstDescriptor.queryHash,
          capturedAt: "2026-04-08T00:00:00.000Z"
        },
        response: {
          body,
          bodyEncoding: "utf8",
          meta: {
            status: 200,
            statusText: "OK",
            headers: [{ name: "Content-Type", value: "application/javascript" }],
            mimeType: "application/javascript",
            resourceType: "Script",
            url: firstDescriptor.requestUrl,
            method: firstDescriptor.method,
            capturedAt: "2026-04-08T00:00:00.000Z",
            bodyEncoding: "utf8",
            bodySuggestedExtension: "js"
          }
        }
      });
      await serverClient.writeFixtureIfAbsent({
        descriptor: secondDescriptor,
        request: {
          topOrigin: secondDescriptor.topOrigin,
          url: secondDescriptor.requestUrl,
          method: secondDescriptor.method,
          headers: [],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: secondDescriptor.bodyHash,
          queryHash: secondDescriptor.queryHash,
          capturedAt: "2026-04-08T00:00:01.000Z"
        },
        response: {
          body,
          bodyEncoding: "utf8",
          meta: {
            status: 200,
            statusText: "OK",
            headers: [
              { name: "Content-Type", value: "application/javascript" },
              { name: "Access-Control-Allow-Origin", value: "https://domain-b.example.com" },
              { name: "Vary", value: "Origin" }
            ],
            mimeType: "application/javascript",
            resourceType: "Script",
            url: secondDescriptor.requestUrl,
            method: secondDescriptor.method,
            capturedAt: "2026-04-08T00:00:01.000Z",
            bodyEncoding: "utf8",
            bodySuggestedExtension: "js"
          }
        }
      });
      const harness = createServerBackedLifecycleHarness({ serverClient, siteConfig });

      await harness.lifecycle.handleFetchRequestPaused(
        { tabId: 1 },
        createFetchPausedParams({
          requestId: "fetch-live-server-query-cors",
          networkId: "network-live-server-query-cors",
          request: {
            method: "GET",
            url: secondDescriptor.requestUrl,
            headers: {}
          },
          resourceType: "Script"
        })
      );

      expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
        1,
        "Fetch.fulfillRequest",
        expect.objectContaining({
          requestId: "fetch-live-server-query-cors",
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "application/javascript" },
            { name: "Access-Control-Allow-Origin", value: "https://domain-b.example.com" },
            { name: "Vary", value: "Origin" }
          ],
          body: Buffer.from("console.log(\"shared variant body\");", "utf8").toString("base64")
        })
      );
    } finally {
      await server.close();
    }
  });

  it("replays an edited shared human-facing projection while keeping query-variant CORS headers", async () => {
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-live-replay-query-edited-projection-"
    });
    const server = await startHttpServer(serverRoot.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const serverClient = createWraithWalkerServerClient(server.trpcUrl, {
      timeoutMs: 2_000
    });
    const siteConfig: SiteConfig = {
      origin: "https://domain-b.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.js$"]
    };
    const firstDescriptor = await realCreateFixtureDescriptor({
      topOrigin: siteConfig.origin,
      method: "GET",
      url: "https://domain-a.example.com/a.js?prop1=&prop2=B",
      resourceType: "Script",
      mimeType: "application/javascript"
    });
    const secondDescriptor = await realCreateFixtureDescriptor({
      topOrigin: siteConfig.origin,
      method: "GET",
      url: "https://domain-a.example.com/a.js?cache-bust=true&retry-attempt=2",
      resourceType: "Script",
      mimeType: "application/javascript"
    });

    try {
      await serverClient.writeFixtureIfAbsent({
        descriptor: firstDescriptor,
        request: {
          topOrigin: firstDescriptor.topOrigin,
          url: firstDescriptor.requestUrl,
          method: firstDescriptor.method,
          headers: [],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: firstDescriptor.bodyHash,
          queryHash: firstDescriptor.queryHash,
          capturedAt: "2026-04-08T00:00:00.000Z"
        },
        response: {
          body: "console.log('canonical first');",
          bodyEncoding: "utf8",
          meta: {
            status: 200,
            statusText: "OK",
            headers: [{ name: "Content-Type", value: "application/javascript" }],
            mimeType: "application/javascript",
            resourceType: "Script",
            url: firstDescriptor.requestUrl,
            method: firstDescriptor.method,
            capturedAt: "2026-04-08T00:00:00.000Z",
            bodyEncoding: "utf8",
            bodySuggestedExtension: "js"
          }
        }
      });
      await serverClient.writeFixtureIfAbsent({
        descriptor: secondDescriptor,
        request: {
          topOrigin: secondDescriptor.topOrigin,
          url: secondDescriptor.requestUrl,
          method: secondDescriptor.method,
          headers: [],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: secondDescriptor.bodyHash,
          queryHash: secondDescriptor.queryHash,
          capturedAt: "2026-04-08T00:00:01.000Z"
        },
        response: {
          body: "console.log('canonical second');",
          bodyEncoding: "utf8",
          meta: {
            status: 200,
            statusText: "OK",
            headers: [
              { name: "Content-Type", value: "application/javascript" },
              { name: "Access-Control-Allow-Origin", value: "https://domain-b.example.com" },
              { name: "Vary", value: "Origin" }
            ],
            mimeType: "application/javascript",
            resourceType: "Script",
            url: secondDescriptor.requestUrl,
            method: secondDescriptor.method,
            capturedAt: "2026-04-08T00:00:01.000Z",
            bodyEncoding: "utf8",
            bodySuggestedExtension: "js"
          }
        }
      });
      await fs.writeFile(serverRoot.resolve(firstDescriptor.projectionPath!), "window.__QUERY_EDIT__ = true;\n");
      const harness = createServerBackedLifecycleHarness({ serverClient, siteConfig });

      await harness.lifecycle.handleFetchRequestPaused(
        { tabId: 1 },
        createFetchPausedParams({
          requestId: "fetch-live-server-query-edited-projection",
          networkId: "network-live-server-query-edited-projection",
          request: {
            method: "GET",
            url: secondDescriptor.requestUrl,
            headers: {}
          },
          resourceType: "Script"
        })
      );

      expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
        1,
        "Fetch.fulfillRequest",
        expect.objectContaining({
          requestId: "fetch-live-server-query-edited-projection",
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "application/javascript" },
            { name: "Access-Control-Allow-Origin", value: "https://domain-b.example.com" },
            { name: "Vary", value: "Origin" }
          ],
          body: Buffer.from("window.__QUERY_EDIT__ = true;\n", "utf8").toString("base64")
        })
      );
    } finally {
      await server.close();
    }
  });

  it("replays a live tRPC-backed simple-mode GET API fixture through Fetch.fulfillRequest", async () => {
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-live-replay-api-"
    });
    const server = await startHttpServer(serverRoot.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const serverClient = createWraithWalkerServerClient(server.trpcUrl, {
      timeoutMs: 2_000
    });
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.json$"]
    };
    const descriptor = await realCreateFixtureDescriptor({
      topOrigin: siteConfig.origin,
      method: "GET",
      url: "https://api.example.com/state",
      resourceType: "XHR"
    });
    const body = JSON.stringify({ ready: true });

    expect(descriptor.storageMode).toBe("api");

    try {
      await serverClient.writeFixtureIfAbsent({
        descriptor,
        request: {
          topOrigin: descriptor.topOrigin,
          url: descriptor.requestUrl,
          method: descriptor.method,
          headers: [{ name: "Accept", value: "application/json" }],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: descriptor.bodyHash,
          queryHash: descriptor.queryHash,
          capturedAt: "2026-04-08T00:00:00.000Z"
        },
        response: {
          body,
          bodyEncoding: "utf8",
          meta: {
            status: 200,
            statusText: "OK",
            headers: [
              { name: "Content-Type", value: "application/json" },
              { name: "X-Trace", value: "server" }
            ],
            mimeType: "application/json",
            resourceType: "XHR",
            url: descriptor.requestUrl,
            method: descriptor.method,
            capturedAt: "2026-04-08T00:00:00.000Z",
            bodyEncoding: "utf8",
            bodySuggestedExtension: "json"
          }
        }
      });
      const harness = createServerBackedLifecycleHarness({ serverClient, siteConfig });

      await harness.lifecycle.handleFetchRequestPaused(
        { tabId: 1 },
        createFetchPausedParams({
          requestId: "fetch-live-server-api",
          networkId: "network-live-server-api",
          request: {
            method: "GET",
            url: descriptor.requestUrl,
            headers: {
              Accept: "application/json"
            }
          },
          resourceType: "XHR"
        })
      );

      expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
        1,
        "Fetch.fulfillRequest",
        {
          requestId: "fetch-live-server-api",
          responseCode: 200,
          responsePhrase: "OK",
          responseHeaders: [
            { name: "Content-Type", value: "application/json" },
            { name: "X-Trace", value: "server" }
          ],
          body: Buffer.from(body, "utf8").toString("base64")
        }
      );
      expect(harness.state.requests.get("1:network-live-server-api")).toMatchObject({
        replayed: true,
        resourceType: "XHR",
        url: descriptor.requestUrl
      });
    } finally {
      await server.close();
    }
  });

  it("skips fixture writing when the site allowlist does not match the request pathname", async () => {
    const harness = createLifecycleHarness({
      siteConfig: {
        origin: "https://app.example.com",
        createdAt: "2026-04-03T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.css$"]
      },
      createFixtureDescriptor: realCreateFixtureDescriptor
    });

    harness.lifecycle.handleNetworkRequestWillBeSent(
      { tabId: 1 },
      {
        requestId: "req-skip",
        request: {
          method: "GET",
          url: "https://cdn.example.com/assets/app.js",
          headers: {}
        },
        type: "Script"
      }
    );
    harness.lifecycle.handleNetworkResponseReceived(
      { tabId: 1 },
      {
        requestId: "req-skip",
        response: {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/javascript" },
          mimeType: "application/javascript"
        },
        type: "Script"
      }
    );

    await harness.lifecycle.handleNetworkLoadingFinished({ tabId: 1 }, { requestId: "req-skip" });

    expect(harness.sendDebuggerCommand).not.toHaveBeenCalledWith(1, "Network.getResponseBody", expect.anything());
    expect(harness.sendOffscreenMessage).not.toHaveBeenCalledWith("fs.writeFixture", expect.anything());
    expect(harness.state.requests.size).toBe(0);
  });

  it("returns early for requestWillBeSent when the tab is unattached or the URL is non-http", () => {
    const harness = createLifecycleHarness();

    harness.state.attachedTabs.clear();
    harness.lifecycle.handleNetworkRequestWillBeSent(
      { tabId: 1 },
      {
        requestId: "req-ignore",
        request: {
          method: "GET",
          url: "https://api.example.com/ignored",
          headers: {}
        },
        type: "XHR"
      }
    );
    harness.lifecycle.handleNetworkRequestWillBeSent(
      { tabId: 1 },
      {
        requestId: "req-ignore-2",
        request: {
          method: "GET",
          url: "data:text/plain,hello",
          headers: {}
        },
        type: "XHR"
      }
    );

    expect(harness.state.requests.size).toBe(0);
  });

  it("stores inline request postData from requestWillBeSent", () => {
    const harness = createLifecycleHarness();

    harness.lifecycle.handleNetworkRequestWillBeSent(
      { tabId: 1 },
      {
        requestId: "req-inline",
        request: {
          method: "POST",
          url: "https://api.example.com/graphql",
          headers: {},
          postData: '{"mode":"inline"}'
        },
        type: "XHR"
      }
    );

    expect(harness.state.requests.get("1:req-inline")).toMatchObject({
      requestBody: '{"mode":"inline"}',
      requestBodyEncoding: "utf8"
    });
  });

  it("preserves existing topOrigin and resourceType when requestWillBeSent omits them", () => {
    const harness = createLifecycleHarness();
    harness.state.attachedTabs.set(1, { topOrigin: "" });
    const entry = harness.lifecycle.ensureRequestEntry(1, "req-preserve-request-fields");
    entry.topOrigin = "https://app.example.com";
    entry.resourceType = "XHR";

    harness.lifecycle.handleNetworkRequestWillBeSent(
      { tabId: 1 },
      {
        requestId: "req-preserve-request-fields",
        request: {
          method: "post",
          url: "https://api.example.com/graphql",
          headers: {
            "X-Trace": "1"
          }
        }
      } as any
    );

    expect(harness.state.requests.get("1:req-preserve-request-fields")).toMatchObject({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/graphql",
      requestHeaders: [{ name: "X-Trace", value: "1" }],
      resourceType: "XHR"
    });
  });

  it("returns early for responseReceived when the tab is missing or unattached", () => {
    const harness = createLifecycleHarness();

    harness.lifecycle.handleNetworkResponseReceived(
      {},
      {
        requestId: "req-no-tab",
        response: {
          status: 200,
          statusText: "OK",
          headers: {},
          mimeType: "application/json"
        },
        type: "XHR"
      }
    );
    harness.state.attachedTabs.clear();
    harness.lifecycle.handleNetworkResponseReceived(
      { tabId: 1 },
      {
        requestId: "req-unattached",
        response: {
          status: 200,
          statusText: "OK",
          headers: {},
          mimeType: "application/json"
        },
        type: "XHR"
      }
    );

    expect(harness.state.requests.size).toBe(0);
  });

  it("preserves existing mimeType and resourceType when responseReceived omits them", () => {
    const harness = createLifecycleHarness();
    const entry = harness.lifecycle.ensureRequestEntry(1, "req-preserve-response-fields");
    entry.mimeType = "application/javascript";
    entry.resourceType = "Script";

    harness.lifecycle.handleNetworkResponseReceived(
      { tabId: 1 },
      {
        requestId: "req-preserve-response-fields",
        response: {
          status: 204,
          statusText: "No Content",
          headers: {
            ETag: "\"abc123\""
          },
          mimeType: ""
        }
      } as any
    );

    expect(harness.state.requests.get("1:req-preserve-response-fields")).toMatchObject({
      responseStatus: 204,
      responseStatusText: "No Content",
      responseHeaders: [{ name: "ETag", value: "\"abc123\"" }],
      mimeType: "application/javascript",
      resourceType: "Script"
    });
  });

  it("returns early for loadingFinished when the request entry does not exist", async () => {
    const harness = createLifecycleHarness();

    await harness.lifecycle.handleNetworkLoadingFinished({ tabId: 1 }, { requestId: "missing-entry" });

    expect(harness.sendDebuggerCommand).not.toHaveBeenCalledWith(1, "Network.getResponseBody", expect.anything());
  });

  it("clears tracked requests on loadingFailed when a tab id is present", () => {
    const harness = createLifecycleHarness();
    harness.state.requests.set("1:req-loading-failed", {
      requestId: "req-loading-failed"
    } as any);

    harness.lifecycle.handleNetworkLoadingFailed({ tabId: 1 }, { requestId: "req-loading-failed" });

    expect(harness.state.requests.has("1:req-loading-failed")).toBe(false);
  });

  it("ignores loadingFailed events when the tab id is missing", () => {
    const harness = createLifecycleHarness();
    harness.state.requests.set("1:req-loading-failed-missing-tab", {
      requestId: "req-loading-failed-missing-tab"
    } as any);

    harness.lifecycle.handleNetworkLoadingFailed({}, { requestId: "req-loading-failed-missing-tab" });

    expect(harness.state.requests.has("1:req-loading-failed-missing-tab")).toBe(true);
  });

  it("skips fixture writing for replayed requests but still clears the entry", async () => {
    const harness = createLifecycleHarness();
    harness.state.requests.set("1:req-replayed", {
      replayed: true,
      requestId: "req-replayed"
    });

    await harness.lifecycle.handleNetworkLoadingFinished({ tabId: 1 }, { requestId: "req-replayed" });

    expect(harness.sendDebuggerCommand).not.toHaveBeenCalledWith(1, "Network.getResponseBody", expect.anything());
    expect(harness.sendOffscreenMessage).not.toHaveBeenCalledWith("fs.writeFixture", expect.anything());
    expect(harness.state.requests.size).toBe(0);
  });

  it("records response body lookup failures during loadingFinished", async () => {
    const harness = createLifecycleHarness();
    harness.sendDebuggerCommand.mockImplementation(async (_tabId, method, params) => {
      if (method === "Network.getResponseBody") {
        throw new Error("response body unavailable");
      }
      if (method === "Network.getRequestPostData") {
        return { postData: '{"seed":"one"}', base64Encoded: false };
      }
      return { method, params };
    });

    harness.lifecycle.handleNetworkRequestWillBeSent(
      { tabId: 1 },
      {
        requestId: "req-response-error",
        request: {
          method: "GET",
          url: "https://api.example.com/error",
          headers: {}
        },
        type: "XHR"
      }
    );
    harness.lifecycle.handleNetworkResponseReceived(
      { tabId: 1 },
      {
        requestId: "req-response-error",
        response: {
          status: 500,
          statusText: "Server Error",
          headers: {},
          mimeType: "application/json"
        },
        type: "XHR"
      }
    );

    await harness.lifecycle.handleNetworkLoadingFinished({ tabId: 1 }, { requestId: "req-response-error" });

    expect(harness.setLastError).toHaveBeenCalledWith("response body unavailable");
    expect(harness.state.requests.size).toBe(0);
  });

  it("records non-Error loadingFinished failures as strings", async () => {
    const state = {
      sessionActive: true,
      attachedTabs: new Map([[1, { topOrigin: "https://app.example.com" }]]),
      requests: new Map<string, any>()
    };
    const setLastError = vi.fn();
    const lifecycle = createRequestLifecycle({
      state,
      sendDebuggerCommand: vi.fn(async (_tabId, method) => {
        if (method === "Network.getResponseBody") {
          return { body: '{"ok":true}', base64Encoded: false };
        }
        if (method === "Network.getRequestPostData") {
          return { postData: "", base64Encoded: false };
        }
        return undefined;
      }) as Parameters<typeof createRequestLifecycle>[0]["sendDebuggerCommand"],
      sendOffscreenMessage: vi.fn(async () => ({ ok: true })) as Parameters<typeof createRequestLifecycle>[0]["sendOffscreenMessage"],
      setLastError,
      repository: {
        exists: vi.fn().mockResolvedValue(false),
        read: vi.fn().mockResolvedValue(null),
        writeIfAbsent: vi.fn().mockRejectedValue("persist failed")
      },
      createFixtureDescriptor: realCreateFixtureDescriptor,
      getSiteConfigForOrigin: vi.fn((topOrigin) => (
        topOrigin === "https://app.example.com"
          ? {
              origin: "https://app.example.com",
              createdAt: "2026-04-08T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.json$"]
            }
          : undefined
      ))
    });

    lifecycle.handleNetworkRequestWillBeSent(
      { tabId: 1 },
      {
        requestId: "req-string-error",
        request: {
          method: "GET",
          url: "https://api.example.com/error.json",
          headers: {}
        },
        type: "XHR"
      }
    );
    lifecycle.handleNetworkResponseReceived(
      { tabId: 1 },
      {
        requestId: "req-string-error",
        response: {
          status: 500,
          statusText: "Server Error",
          headers: {},
          mimeType: "application/json"
        },
        type: "XHR"
      }
    );
    await lifecycle.handleNetworkLoadingFinished({ tabId: 1 }, { requestId: "req-string-error" });

    expect(setLastError).toHaveBeenCalledWith("persist failed");
    expect(state.requests.size).toBe(0);
  });

  it("records fixture lookup errors and falls back to continueRequest", async () => {
    const harness = createLifecycleHarness();
    harness.sendOffscreenMessage.mockResolvedValueOnce({ ok: false, error: "disk unavailable" } as any);

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-4",
        networkId: "network-4",
        request: {
          url: "https://cdn.example.com/font.woff2"
        },
        resourceType: "Font"
      })
    );

    expect(harness.setLastError).toHaveBeenCalledWith("disk unavailable");
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(1, "Fetch.continueRequest", { requestId: "fetch-4" });
  });

  it("does not delete failed requests when no tabId is present", () => {
    const harness = createLifecycleHarness();
    harness.state.requests.set("1:req-no-tab", { requestId: "req-no-tab" });

    harness.lifecycle.handleNetworkLoadingFailed({}, { requestId: "req-no-tab" });

    expect(harness.state.requests.size).toBe(1);
  });

  it("drops failed requests from the in-memory store", () => {
    const harness = createLifecycleHarness();
    harness.state.requests.set("1:req-5", { requestId: "req-5" });

    harness.lifecycle.handleNetworkLoadingFailed({ tabId: 1 }, { requestId: "req-5" });

    expect(harness.state.requests.size).toBe(0);
  });
});
