import { afterEach, describe, expect, it, vi } from "vitest";

import { createFixtureDescriptor as realCreateFixtureDescriptor } from "../src/lib/fixture-mapper.js";
import { createRequestLifecycle } from "../src/lib/request-lifecycle.js";
import {
  createLifecycleHarness
} from "./helpers/request-lifecycle-test-helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("request lifecycle persistence and tracking", () => {
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
          postData: Buffer.from("{\"seed\":\"base64\"}", "utf8").toString("base64"),
          base64Encoded: true
        };
      }
      if (method === "Network.getResponseBody") {
        return {
          body: Buffer.from("{\"ok\":true}", "utf8").toString("base64"),
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
          body: Buffer.from("{\"seed\":\"base64\"}", "utf8").toString("base64"),
          bodyEncoding: "base64"
        }),
        response: expect.objectContaining({
          body: Buffer.from("{\"ok\":true}", "utf8").toString("base64"),
          bodyEncoding: "base64",
          meta: expect.objectContaining({
            bodyEncoding: "base64"
          })
        })
      })
    );
  });

  it("records default repository write failures through lastError and still clears the request entry", async () => {
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

  it("returns early for requestWillBeSent when the tab id is missing", () => {
    const harness = createLifecycleHarness();

    harness.lifecycle.handleNetworkRequestWillBeSent(
      {},
      {
        requestId: "req-missing-tab",
        request: {
          method: "GET",
          url: "https://api.example.com/ignored",
          headers: {}
        },
        type: "XHR"
      }
    );

    expect(harness.state.requests.size).toBe(0);
  });

  it("returns early for requestWillBeSent when the tab is unattached", () => {
    const harness = createLifecycleHarness();
    harness.state.attachedTabs.clear();

    harness.lifecycle.handleNetworkRequestWillBeSent(
      { tabId: 1 },
      {
        requestId: "req-unattached",
        request: {
          method: "GET",
          url: "https://api.example.com/ignored",
          headers: {}
        },
        type: "XHR"
      }
    );

    expect(harness.state.requests.size).toBe(0);
  });

  it("returns early for requestWillBeSent when the URL is non-http", () => {
    const harness = createLifecycleHarness();

    harness.lifecycle.handleNetworkRequestWillBeSent(
      { tabId: 1 },
      {
        requestId: "req-non-http",
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
          postData: "{\"mode\":\"inline\"}"
        },
        type: "XHR"
      }
    );

    expect(harness.state.requests.get("1:req-inline")).toMatchObject({
      requestBody: "{\"mode\":\"inline\"}",
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

  it("returns early for responseReceived when the tab id is missing", () => {
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

    expect(harness.state.requests.size).toBe(0);
  });

  it("returns early for responseReceived when the tab is unattached", () => {
    const harness = createLifecycleHarness();
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
        return { postData: "{\"seed\":\"one\"}", base64Encoded: false };
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
          return { body: "{\"ok\":true}", base64Encoded: false };
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
});
