import { describe, expect, it } from "vitest";

import {
  appendVaryHeader,
  buildLocalServerCorsHeaders,
  isAllowedLocalServerOrigin
} from "../src/local-server-cors.mts";

describe("local server cors policy", () => {
  it("allows browser extension origins and rejects regular web origins", () => {
    expect(isAllowedLocalServerOrigin("chrome-extension://abc123")).toBe(true);
    expect(isAllowedLocalServerOrigin("moz-extension://abc123")).toBe(true);
    expect(isAllowedLocalServerOrigin("safari-web-extension://abc123")).toBe(true);
    expect(isAllowedLocalServerOrigin("https://example.com")).toBe(false);
    expect(isAllowedLocalServerOrigin(undefined)).toBe(false);
    expect(isAllowedLocalServerOrigin("not a url")).toBe(false);
  });

  it("builds reflected cors headers for allowed extension origins", () => {
    expect(buildLocalServerCorsHeaders({
      origin: "chrome-extension://abc123",
      requestedHeaders: "content-type, x-trpc-source"
    })).toEqual({
      "Access-Control-Allow-Origin": "chrome-extension://abc123",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, x-trpc-source",
      "Access-Control-Max-Age": "600",
      Vary: "Origin"
    });

    expect(buildLocalServerCorsHeaders({
      origin: "https://example.com"
    })).toBeNull();
  });

  it("allows private-network preflight when the browser requests it for loopback access", () => {
    expect(buildLocalServerCorsHeaders({
      origin: "chrome-extension://abc123",
      requestedHeaders: "content-type, x-trpc-source",
      requestedPrivateNetwork: "true"
    })).toEqual({
      "Access-Control-Allow-Origin": "chrome-extension://abc123",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, x-trpc-source",
      "Access-Control-Allow-Private-Network": "true",
      "Access-Control-Max-Age": "600",
      Vary: "Origin"
    });
  });

  it("appends Origin to existing vary headers without duplicating entries", () => {
    expect(appendVaryHeader("trpc-accept, accept", "Origin")).toBe("trpc-accept, accept, Origin");
    expect(appendVaryHeader("Origin, accept", "Origin")).toBe("Origin, accept");
    expect(appendVaryHeader(undefined, "Origin")).toBe("Origin");
  });
});
