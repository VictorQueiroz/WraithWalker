import { describe, expect, it } from "vitest";

import {
  arrayifyHeaders,
  buildRequestPayload,
  buildResponseMeta,
  buildSessionSnapshot,
  createRequestEntry,
  extractOrigin,
  findMatchingOrigin,
  isHttpUrl,
  replayResponseHeaders
} from "../src/lib/background-helpers.js";
describe("background helpers", () => {
  it("accepts only http and https URLs", () => {
    expect(isHttpUrl("https://app.example.com")).toBe(true);
    expect(isHttpUrl("http://app.example.com")).toBe(true);
    expect(isHttpUrl("data:text/plain,hello")).toBe(false);
    expect(extractOrigin("https://app.example.com/path")).toBe("https://app.example.com");
    expect(extractOrigin("chrome://extensions")).toBeNull();
    expect(
      findMatchingOrigin("https://app.example.com/dashboard", ["https://app.example.com", "https://preview.example.com"])
    ).toBe("https://app.example.com");
    expect(findMatchingOrigin("https://cdn.example.com/app.js", ["https://app.example.com"])).toBeNull();
  });

  it("normalizes header collections", () => {
    expect(arrayifyHeaders({ Accept: "application/json" })).toEqual([
      { name: "Accept", value: "application/json" }
    ]);
    expect(arrayifyHeaders([{ name: "X-Test", value: 10 } as any])).toEqual([
      { name: "X-Test", value: "10" }
    ]);
  });

  it("strips hop-by-hop and body-derived replay headers", () => {
    const headers = replayResponseHeaders([
      { name: "Content-Type", value: "application/json" },
      { name: "Content-Length", value: "88" },
      { name: "Connection", value: "keep-alive" },
      { name: "Set-Cookie", value: "a=b" }
    ]);

    expect(headers).toEqual([
      { name: "Content-Type", value: "application/json" },
      { name: "Set-Cookie", value: "a=b" }
    ]);
  });

  it("builds a session snapshot without editor-launch state", () => {
    const snapshot = buildSessionSnapshot({
      sessionActive: true,
      attachedTabIds: [11, 22],
      enabledOrigins: ["https://app.example.com"],
      rootReady: true,
      lastError: ""
    });

    expect(snapshot).toEqual({
      sessionActive: true,
      attachedTabIds: [11, 22],
      enabledOrigins: ["https://app.example.com"],
      rootReady: true,
      lastError: ""
    });
  });

  it("builds deterministic request and response metadata", () => {
    const entry = createRequestEntry({
      tabId: 4,
      requestId: "abc",
      topOrigin: "https://app.example.com"
    });

    entry.url = "https://api.example.com/graphql";
    entry.method = "POST";
    entry.requestHeaders = [{ name: "Content-Type", value: "application/json" }];
    entry.requestBody = '{"query":"{viewer{id}}"}';
    entry.descriptor = { bodyHash: "body123", queryHash: "query456" } as any;
    entry.responseStatus = 201;
    entry.responseStatusText = "Created";
    entry.responseHeaders = [{ name: "Content-Type", value: "application/json" }];
    entry.mimeType = "application/json";
    entry.resourceType = "XHR";

    expect(buildRequestPayload(entry, "2026-04-02T20:10:00.000Z")).toEqual({
      topOrigin: "https://app.example.com",
      url: "https://api.example.com/graphql",
      method: "POST",
      headers: [{ name: "Content-Type", value: "application/json" }],
      body: '{"query":"{viewer{id}}"}',
      bodyEncoding: "utf8",
      bodyHash: "body123",
      queryHash: "query456",
      capturedAt: "2026-04-02T20:10:00.000Z"
    });

    expect(buildResponseMeta(entry, "utf8", "2026-04-02T20:10:00.000Z")).toEqual({
      status: 201,
      statusText: "Created",
      headers: [{ name: "Content-Type", value: "application/json" }],
      mimeType: "application/json",
      resourceType: "XHR",
      url: "https://api.example.com/graphql",
      method: "POST",
      capturedAt: "2026-04-02T20:10:00.000Z",
      bodyEncoding: "utf8",
      bodySuggestedExtension: "json"
    });
  });
});
