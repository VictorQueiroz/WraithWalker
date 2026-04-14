import { afterEach, describe, expect, it, vi } from "vitest";

import { createFixtureDescriptor as realCreateFixtureDescriptor } from "../src/lib/fixture-mapper.js";
import { StaleFetchRequestCommandError } from "../src/lib/background-runtime-shared.js";
import {
  createFetchPausedParams,
  createLifecycleHarness
} from "./helpers/request-lifecycle-test-helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("request lifecycle fetch flow", () => {
  it("uses inline fallback postData before consulting the debugger", async () => {
    const harness = createLifecycleHarness();

    const result = await harness.lifecycle.populatePostData(1, "req-inline", {
      postData: '{"mode":"inline"}'
    });

    expect(result).toEqual({
      body: '{"mode":"inline"}',
      encoding: "utf8"
    });
    expect(harness.sendDebuggerCommand).not.toHaveBeenCalledWith(
      1,
      "Network.getRequestPostData",
      expect.anything()
    );
  });

  it("falls back to an empty body when request post data lookup fails", async () => {
    const harness = createLifecycleHarness();
    harness.sendDebuggerCommand.mockRejectedValueOnce(
      new Error("request body unavailable")
    );

    const result = await harness.lifecycle.populatePostData(1, "req-missing");

    expect(result).toEqual({
      body: "",
      encoding: "utf8"
    });
  });

  it("reuses an existing descriptor without recreating it", async () => {
    const harness = createLifecycleHarness();
    const descriptor = {
      bodyPath: "existing",
      requestPath: "request",
      metaPath: "meta"
    } as any;
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
      replayOnResponse: false,
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

    await harness.lifecycle.handleFetchRequestPaused(
      {},
      createFetchPausedParams()
    );
    harness.state.sessionActive = false;
    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams()
    );
    harness.state.sessionActive = true;
    harness.state.attachedTabs.clear();
    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams()
    );

    expect(harness.sendDebuggerCommand).not.toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      expect.anything()
    );
    expect(harness.sendOffscreenMessage).not.toHaveBeenCalled();
  });

  it("continues paused requests that already have a response status", async () => {
    const harness = createLifecycleHarness();

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({ responseStatusCode: 200 })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      { requestId: "fetch-1" }
    );
  });

  it("continues paused requests that already have an error reason", async () => {
    const harness = createLifecycleHarness();

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({ responseErrorReason: "Failed" })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      { requestId: "fetch-1" }
    );
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

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      { requestId: "fetch-1" }
    );
  });

  it("drops a non-http stale paused request quietly", async () => {
    const harness = createLifecycleHarness();
    harness.sendDebuggerCommand.mockImplementation(
      async (_tabId, method, params) => {
        if (
          method === "Fetch.continueRequest" &&
          (params as { requestId?: string } | undefined)?.requestId ===
            "fetch-stale-non-http"
        ) {
          throw new StaleFetchRequestCommandError(
            1,
            method,
            '{"code":-32602,"message":"Invalid InterceptionId."}'
          );
        }

        return { method, params };
      }
    );

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-stale-non-http",
        networkId: "network-stale-non-http",
        request: {
          url: "data:text/plain,hello"
        }
      })
    );

    expect(harness.setLastError).not.toHaveBeenCalled();
    expect(harness.state.requests.has("1:network-stale-non-http")).toBe(false);
  });

  it("continues the request when no fixture exists", async () => {
    const harness = createLifecycleHarness();

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams()
    );

    expect(harness.sendOffscreenMessage).toHaveBeenCalledWith(
      "fs.hasFixture",
      expect.any(Object)
    );
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      { requestId: "fetch-1" }
    );
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

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Network.getRequestPostData",
      {
        requestId: "network-post"
      }
    );
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

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Network.getRequestPostData",
      {
        requestId: "fetch-post-no-network"
      }
    );
    expect(harness.state.requests.get("1:fetch-post-no-network")).toMatchObject(
      {
        requestId: "fetch-post-no-network",
        requestBody: '{"seed":"one"}',
        requestBodyEncoding: "utf8"
      }
    );
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

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Network.getRequestPostData",
      {
        requestId: "network-simple-post"
      }
    );
    expect(harness.sendOffscreenMessage).toHaveBeenCalledWith(
      "fs.hasFixture",
      expect.any(Object)
    );
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      {
        requestId: "fetch-simple-post"
      }
    );
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

  it("synthesizes minimal CORS headers for replayed stylesheet overrides in browser cors mode", async () => {
    const harness = createLifecycleHarness({
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
            url: "https://cdn.example.com/assets/app.chunk.css",
            method: "GET",
            headers: [],
            body: "",
            bodyEncoding: "utf8",
            bodyHash: "",
            queryHash: "",
            capturedAt: "2026-04-09T00:00:00.000Z"
          },
          bodyBase64: Buffer.from("body{color:red}", "utf8").toString("base64"),
          meta: {
            status: 200,
            statusText: "OK",
            headers: [{ name: "Content-Type", value: "text/css" }]
          }
        };
      }
      return { ok: true };
    });

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-style-cors",
        networkId: "network-style-cors",
        request: {
          method: "GET",
          url: "https://cdn.example.com/assets/app.chunk.css",
          headers: {
            Origin: "https://app.example.com",
            "Sec-Fetch-Mode": "cors"
          }
        },
        resourceType: "Stylesheet"
      })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.fulfillRequest",
      expect.objectContaining({
        requestId: "fetch-style-cors",
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "text/css" },
          {
            name: "Access-Control-Allow-Origin",
            value: "https://app.example.com"
          },
          { name: "Vary", value: "Origin" }
        ],
        body: Buffer.from("body{color:red}", "utf8").toString("base64")
      })
    );
  });

  it("synthesizes credential-aware CORS headers for replayed font overrides", async () => {
    const harness = createLifecycleHarness({
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
            url: "https://cdn.example.com/assets/app.woff2",
            method: "GET",
            headers: [],
            body: "",
            bodyEncoding: "utf8",
            bodyHash: "",
            queryHash: "",
            capturedAt: "2026-04-09T00:00:00.000Z"
          },
          bodyBase64: Buffer.from([0, 1, 2, 3]).toString("base64"),
          meta: {
            status: 200,
            statusText: "OK",
            headers: [{ name: "Content-Type", value: "font/woff2" }]
          }
        };
      }
      return { ok: true };
    });

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-font-cors",
        networkId: "network-font-cors",
        request: {
          method: "GET",
          url: "https://cdn.example.com/assets/app.woff2",
          headers: {
            Origin: "https://app.example.com",
            "Sec-Fetch-Mode": "cors",
            Cookie: "session=abc123"
          }
        },
        resourceType: "Font"
      })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.fulfillRequest",
      expect.objectContaining({
        requestId: "fetch-font-cors",
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "font/woff2" },
          {
            name: "Access-Control-Allow-Origin",
            value: "https://app.example.com"
          },
          { name: "Access-Control-Allow-Credentials", value: "true" },
          { name: "Vary", value: "Origin" }
        ],
        body: Buffer.from([0, 1, 2, 3]).toString("base64")
      })
    );
  });

  it("replays synced asset overrides with the current live response headers on each reload when no .headers rule exists", async () => {
    const harness = createLifecycleHarness({
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
            url: "https://cdn.example.com/assets/app.css",
            method: "GET",
            headers: [],
            body: "",
            bodyEncoding: "utf8",
            bodyHash: "",
            queryHash: "",
            capturedAt: "2026-04-09T00:00:00.000Z"
          },
          bodyBase64: Buffer.from("body{color:rebeccapurple}", "utf8").toString(
            "base64"
          ),
          meta: {
            status: 200,
            statusText: "OK",
            headers: [{ name: "Content-Type", value: "text/css" }],
            headerStrategy: "live"
          }
        };
      }
      return { ok: true };
    });

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-live-headers-1",
        networkId: "network-live-headers-1",
        request: {
          method: "GET",
          url: "https://cdn.example.com/assets/app.css",
          headers: {
            Origin: "https://app.example.com",
            "Sec-Fetch-Mode": "cors"
          }
        },
        resourceType: "Stylesheet"
      })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      {
        requestId: "fetch-live-headers-1",
        interceptResponse: true
      }
    );
    expect(harness.sendDebuggerCommand).not.toHaveBeenCalledWith(
      1,
      "Fetch.fulfillRequest",
      expect.objectContaining({ requestId: "fetch-live-headers-1" })
    );

    harness.lifecycle.handleNetworkResponseReceived(
      { tabId: 1 },
      {
        requestId: "network-live-headers-1",
        response: {
          status: 200,
          statusText: "OK",
          headers: {
            "Content-Type": "text/css",
            ETag: '"v1"'
          },
          mimeType: "text/css"
        },
        type: "Stylesheet"
      }
    );

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-live-headers-1-response",
        networkId: "network-live-headers-1",
        request: {
          method: "GET",
          url: "https://cdn.example.com/assets/app.css",
          headers: {
            Origin: "https://app.example.com",
            "Sec-Fetch-Mode": "cors"
          }
        },
        resourceType: "Stylesheet",
        responseStatusCode: 200,
        responseHeaders: {
          "Content-Type": "text/css",
          ETag: '"v1"'
        }
      })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.fulfillRequest",
      expect.objectContaining({
        requestId: "fetch-live-headers-1-response",
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "text/css" },
          { name: "ETag", value: '"v1"' },
          {
            name: "Access-Control-Allow-Origin",
            value: "https://app.example.com"
          },
          { name: "Vary", value: "Origin" }
        ],
        body: Buffer.from("body{color:rebeccapurple}", "utf8").toString(
          "base64"
        )
      })
    );

    await harness.lifecycle.handleNetworkLoadingFinished(
      { tabId: 1 },
      { requestId: "network-live-headers-1" }
    );

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-live-headers-2",
        networkId: "network-live-headers-2",
        request: {
          method: "GET",
          url: "https://cdn.example.com/assets/app.css",
          headers: {
            Origin: "https://app.example.com",
            "Sec-Fetch-Mode": "cors"
          }
        },
        resourceType: "Stylesheet"
      })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      {
        requestId: "fetch-live-headers-2",
        interceptResponse: true
      }
    );

    harness.lifecycle.handleNetworkResponseReceived(
      { tabId: 1 },
      {
        requestId: "network-live-headers-2",
        response: {
          status: 200,
          statusText: "OK",
          headers: {
            "Content-Type": "text/css",
            ETag: '"v2"',
            "Cache-Control": "max-age=60"
          },
          mimeType: "text/css"
        },
        type: "Stylesheet"
      }
    );

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-live-headers-2-response",
        networkId: "network-live-headers-2",
        request: {
          method: "GET",
          url: "https://cdn.example.com/assets/app.css",
          headers: {
            Origin: "https://app.example.com",
            "Sec-Fetch-Mode": "cors"
          }
        },
        resourceType: "Stylesheet",
        responseStatusCode: 200,
        responseHeaders: {
          "Content-Type": "text/css",
          ETag: '"v2"',
          "Cache-Control": "max-age=60"
        }
      })
    );

    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.fulfillRequest",
      expect.objectContaining({
        requestId: "fetch-live-headers-2-response",
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "text/css" },
          { name: "ETag", value: '"v2"' },
          { name: "Cache-Control", value: "max-age=60" },
          {
            name: "Access-Control-Allow-Origin",
            value: "https://app.example.com"
          },
          { name: "Vary", value: "Origin" }
        ],
        body: Buffer.from("body{color:rebeccapurple}", "utf8").toString(
          "base64"
        )
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
        throw new Error("fixture read failed");
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

    expect(harness.setLastError).toHaveBeenCalledWith("fixture read failed");
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      {
        requestId: "fetch-read-fail"
      }
    );
  });

  it("falls back to continueRequest when fixture existence lookup fails", async () => {
    const harness = createLifecycleHarness();
    harness.sendOffscreenMessage.mockResolvedValueOnce({
      ok: false,
      error: "Fixture lookup failed upstream."
    } as any);

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-exists-fail",
        networkId: "network-exists-fail"
      })
    );

    expect(harness.setLastError).toHaveBeenCalledWith(
      "Fixture lookup failed upstream."
    );
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      {
        requestId: "fetch-exists-fail"
      }
    );
  });

  it("falls back to continueRequest when fixture read returns no payload", async () => {
    const harness = createLifecycleHarness();
    harness.sendOffscreenMessage.mockImplementation(async (type) => {
      if (type === "fs.hasFixture") {
        return { ok: true, exists: true };
      }
      if (type === "fs.readFixture") {
        return {
          ok: true,
          exists: false
        };
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
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      {
        requestId: "fetch-read-empty"
      }
    );
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
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      {
        requestId: "fetch-read-partial"
      }
    );
  });

  it("records fixture lookup errors and falls back to continueRequest", async () => {
    const harness = createLifecycleHarness();
    harness.sendOffscreenMessage.mockResolvedValueOnce({
      ok: false,
      error: "disk unavailable"
    } as any);

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
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      { requestId: "fetch-4" }
    );
  });

  it("retries a failed continueRequest without relying on Chrome-specific detach handling", async () => {
    const harness = createLifecycleHarness();
    let continueAttempts = 0;
    harness.sendDebuggerCommand.mockImplementation(
      async (_tabId, method, params) => {
        if (method === "Network.getRequestPostData") {
          return { postData: '{"seed":"one"}', base64Encoded: false };
        }
        if (method === "Network.getResponseBody") {
          return { body: '{"ok":true}', base64Encoded: false };
        }
        if (
          method === "Fetch.continueRequest" &&
          (params as { requestId?: string } | undefined)?.requestId ===
            "fetch-continue-retry" &&
          continueAttempts++ === 0
        ) {
          throw new Error("transport unavailable");
        }

        return { method, params };
      }
    );

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-continue-retry",
        networkId: "network-continue-retry"
      })
    );

    expect(harness.setLastError).toHaveBeenCalledWith("transport unavailable");
    expect(
      harness.sendDebuggerCommand.mock.calls.filter(
        ([, method]) => method === "Fetch.continueRequest"
      )
    ).toEqual([
      [1, "Fetch.continueRequest", { requestId: "fetch-continue-retry" }],
      [1, "Fetch.continueRequest", { requestId: "fetch-continue-retry" }]
    ]);
    expect(
      harness.state.requests.get("1:network-continue-retry")
    ).toMatchObject({
      requestId: "network-continue-retry",
      url: "https://cdn.example.com/app.js"
    });
  });

  it("drops a stale paused request without surfacing a stale fetch resolution error", async () => {
    const harness = createLifecycleHarness();
    harness.sendDebuggerCommand.mockImplementation(
      async (_tabId, method, params) => {
        if (
          method === "Fetch.continueRequest" &&
          (params as { requestId?: string } | undefined)?.requestId ===
            "fetch-stale-pause"
        ) {
          throw new StaleFetchRequestCommandError(
            1,
            method,
            '{"code":-32602,"message":"Invalid InterceptionId."}'
          );
        }

        return { method, params };
      }
    );

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-stale-pause",
        networkId: "network-stale-pause"
      })
    );

    expect(harness.setLastError).not.toHaveBeenCalled();
    expect(harness.state.requests.has("1:network-stale-pause")).toBe(false);
    expect(
      harness.sendDebuggerCommand.mock.calls.filter(
        ([, method]) => method === "Fetch.continueRequest"
      )
    ).toEqual([
      [1, "Fetch.continueRequest", { requestId: "fetch-stale-pause" }]
    ]);
  });

  it("resets replayOnResponse when a live-header replay fixture disappears during the response phase", async () => {
    const harness = createLifecycleHarness({
      createFixtureDescriptor: realCreateFixtureDescriptor
    });
    let readCount = 0;
    harness.sendOffscreenMessage.mockImplementation(async (type) => {
      if (type === "fs.hasFixture") {
        return { ok: true, exists: true };
      }
      if (type === "fs.readFixture") {
        if (readCount++ === 0) {
          return {
            ok: true,
            exists: true,
            request: {
              topOrigin: "https://app.example.com",
              url: "https://cdn.example.com/assets/app.css",
              method: "GET",
              headers: [],
              body: "",
              bodyEncoding: "utf8",
              bodyHash: "",
              queryHash: "",
              capturedAt: "2026-04-09T00:00:00.000Z"
            },
            bodyBase64: Buffer.from(
              "body{color:rebeccapurple}",
              "utf8"
            ).toString("base64"),
            meta: {
              status: 200,
              statusText: "OK",
              headers: [{ name: "Content-Type", value: "text/css" }],
              headerStrategy: "live"
            }
          };
        }

        return { ok: true, exists: false };
      }
      return { ok: true };
    });

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-live-reset",
        networkId: "network-live-reset",
        request: {
          method: "GET",
          url: "https://cdn.example.com/assets/app.css"
        },
        resourceType: "Stylesheet"
      })
    );

    expect(harness.state.requests.get("1:network-live-reset")).toMatchObject({
      replayOnResponse: true
    });

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-live-reset-response",
        networkId: "network-live-reset",
        request: {
          method: "GET",
          url: "https://cdn.example.com/assets/app.css"
        },
        resourceType: "Stylesheet",
        responseStatusCode: 200,
        responseHeaders: {
          "Content-Type": "text/css"
        }
      })
    );

    expect(harness.state.requests.get("1:network-live-reset")).toMatchObject({
      replayOnResponse: false
    });
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      {
        requestId: "fetch-live-reset-response"
      }
    );
  });

  it("records response-phase replay failures and still cleans up stale continuation safely", async () => {
    const harness = createLifecycleHarness({
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
            url: "https://cdn.example.com/assets/app.css",
            method: "GET",
            headers: [],
            body: "",
            bodyEncoding: "utf8",
            bodyHash: "",
            queryHash: "",
            capturedAt: "2026-04-09T00:00:00.000Z"
          },
          bodyBase64: Buffer.from("body{color:red}", "utf8").toString("base64"),
          meta: {
            status: 200,
            statusText: "OK",
            headers: [{ name: "Content-Type", value: "text/css" }],
            headerStrategy: "live"
          }
        };
      }
      return { ok: true };
    });
    let fulfillAttempts = 0;
    harness.sendDebuggerCommand.mockImplementation(
      async (_tabId, method, params) => {
        if (method === "Network.getRequestPostData") {
          return { postData: '{"seed":"one"}', base64Encoded: false };
        }
        if (method === "Network.getResponseBody") {
          return { body: '{"ok":true}', base64Encoded: false };
        }
        if (method === "Fetch.fulfillRequest" && fulfillAttempts++ === 0) {
          throw new Error("response replay failed");
        }
        if (
          method === "Fetch.continueRequest" &&
          (params as { requestId?: string } | undefined)?.requestId ===
            "fetch-live-error-response"
        ) {
          throw new StaleFetchRequestCommandError(
            1,
            method,
            '{"code":-32602,"message":"Invalid InterceptionId."}'
          );
        }
        return { method, params };
      }
    );

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-live-error",
        networkId: "network-live-error",
        request: {
          method: "GET",
          url: "https://cdn.example.com/assets/app.css"
        },
        resourceType: "Stylesheet"
      })
    );
    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-live-error-response",
        networkId: "network-live-error",
        request: {
          method: "GET",
          url: "https://cdn.example.com/assets/app.css"
        },
        resourceType: "Stylesheet",
        responseStatusCode: 200,
        responseHeaders: {
          "Content-Type": "text/css"
        }
      })
    );

    expect(harness.setLastError).toHaveBeenCalledWith("response replay failed");
    expect(harness.state.requests.has("1:network-live-error")).toBe(false);
  });

  it("drops a request when replay lookup fails and the fallback continue becomes stale", async () => {
    const harness = createLifecycleHarness();
    harness.sendOffscreenMessage.mockResolvedValueOnce({
      ok: false,
      error: "disk unavailable"
    } as any);
    harness.sendDebuggerCommand.mockImplementation(
      async (_tabId, method, params) => {
        if (
          method === "Fetch.continueRequest" &&
          (params as { requestId?: string } | undefined)?.requestId ===
            "fetch-stale-after-error"
        ) {
          throw new StaleFetchRequestCommandError(
            1,
            method,
            '{"code":-32602,"message":"Invalid InterceptionId."}'
          );
        }

        if (method === "Network.getRequestPostData") {
          return { postData: '{"seed":"one"}', base64Encoded: false };
        }
        if (method === "Network.getResponseBody") {
          return { body: '{"ok":true}', base64Encoded: false };
        }

        return { method, params };
      }
    );

    await harness.lifecycle.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        requestId: "fetch-stale-after-error",
        networkId: "network-stale-after-error"
      })
    );

    expect(harness.setLastError).toHaveBeenCalledWith("disk unavailable");
    expect(harness.state.requests.has("1:network-stale-after-error")).toBe(
      false
    );
  });
});
