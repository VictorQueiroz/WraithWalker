import { describe, expect, it } from "vitest";

import { createCapturePolicy } from "../src/lib/capture-policy.js";
import type { SiteConfig } from "../src/lib/types.js";

describe("capture policy", () => {
  it("returns the configured site for a top origin", () => {
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-03T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.m?(js|ts)x?$"]
    };
    const policy = createCapturePolicy({
      getSiteConfigForOrigin: (topOrigin) =>
        topOrigin === siteConfig.origin ? siteConfig : undefined
    });

    expect(policy.getSiteConfig("https://app.example.com")).toEqual(siteConfig);
    expect(policy.getSiteConfig("https://missing.example.com")).toBeUndefined();
  });

  it("uses the site allowlist to decide whether a live response should persist", () => {
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-03T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.css$"]
    };
    const policy = createCapturePolicy({
      getSiteConfigForOrigin: () => siteConfig
    });

    expect(
      policy.shouldPersist({
        topOrigin: "https://app.example.com",
        method: "GET",
        url: "https://cdn.example.com/app.css"
      })
    ).toBe(true);
    expect(
      policy.shouldPersist({
        topOrigin: "https://app.example.com",
        method: "GET",
        url: "https://cdn.example.com/app.js"
      })
    ).toBe(false);
  });

  it("matches when any of multiple allowlist patterns match", () => {
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-03T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.css$", "\\.js$", "\\.wasm$"]
    };
    const policy = createCapturePolicy({
      getSiteConfigForOrigin: () => siteConfig
    });

    expect(
      policy.shouldPersist({
        topOrigin: "https://app.example.com",
        method: "GET",
        url: "https://cdn.example.com/app.css"
      })
    ).toBe(true);
    expect(
      policy.shouldPersist({
        topOrigin: "https://app.example.com",
        method: "GET",
        url: "https://cdn.example.com/app.js"
      })
    ).toBe(true);
    expect(
      policy.shouldPersist({
        topOrigin: "https://app.example.com",
        method: "GET",
        url: "https://cdn.example.com/runtime.wasm"
      })
    ).toBe(true);
    expect(
      policy.shouldPersist({
        topOrigin: "https://app.example.com",
        method: "GET",
        url: "https://cdn.example.com/image.png"
      })
    ).toBe(false);
  });

  it("rejects when no allowlist patterns match", () => {
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-03T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.css$"]
    };
    const policy = createCapturePolicy({
      getSiteConfigForOrigin: () => siteConfig
    });

    expect(
      policy.shouldPersist({
        topOrigin: "https://app.example.com",
        method: "GET",
        url: "https://cdn.example.com/app.js"
      })
    ).toBe(false);
  });

  it("defaults to persisting when no site config is available", () => {
    const policy = createCapturePolicy();

    expect(
      policy.shouldPersist({
        topOrigin: "https://unknown.example.com",
        method: "POST",
        url: "https://api.example.com/graphql"
      })
    ).toBe(true);
  });
});
