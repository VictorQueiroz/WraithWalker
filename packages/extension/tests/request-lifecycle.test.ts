import { describe, expect, it, vi } from "vitest";

import { createRequestLifecycle } from "../src/lib/request-lifecycle.js";
import { createFixtureDescriptor as realCreateFixtureDescriptor } from "../src/lib/fixture-mapper.js";
import type { SiteConfig } from "../src/lib/types.js";

interface LifecycleHarnessOptions {
  siteConfig?: SiteConfig;
  createFixtureDescriptor?: typeof realCreateFixtureDescriptor;
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
    siteMode: siteConfig?.mode || "advanced",
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

  it("uses the shared fixture pipeline for non-GET simple-mode requests", async () => {
    const harness = createLifecycleHarness({
      siteConfig: {
        origin: "https://app.example.com",
        createdAt: "2026-04-03T00:00:00.000Z",
        mode: "simple",
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
        mode: "simple",
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

  it("skips fixture writing when the site allowlist does not match the request pathname", async () => {
    const harness = createLifecycleHarness({
      siteConfig: {
        origin: "https://app.example.com",
        createdAt: "2026-04-03T00:00:00.000Z",
        mode: "simple",
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

  it("returns early for loadingFinished when the request entry does not exist", async () => {
    const harness = createLifecycleHarness();

    await harness.lifecycle.handleNetworkLoadingFinished({ tabId: 1 }, { requestId: "missing-entry" });

    expect(harness.sendDebuggerCommand).not.toHaveBeenCalledWith(1, "Network.getResponseBody", expect.anything());
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
