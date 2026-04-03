import { describe, expect, it } from "vitest";

import { createCapturePolicy } from "../src/lib/capture-policy.js";
import type { SiteConfig } from "../src/lib/types.js";

describe("capture policy", () => {
  it("returns the configured site and mode for a top origin", () => {
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-03T00:00:00.000Z",
      mode: "simple",
      dumpAllowlistPattern: "\\.m?(js|ts)x?$"
    };
    const policy = createCapturePolicy({
      getSiteConfigForOrigin: (topOrigin) => (topOrigin === siteConfig.origin ? siteConfig : undefined)
    });

    expect(policy.getSiteConfig("https://app.example.com")).toEqual(siteConfig);
    expect(policy.getSiteMode("https://app.example.com")).toBe("simple");
    expect(policy.getSiteMode("https://missing.example.com")).toBeUndefined();
  });

  it("uses the site allowlist to decide whether a live response should persist", () => {
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-03T00:00:00.000Z",
      mode: "advanced",
      dumpAllowlistPattern: "\\.css$"
    };
    const policy = createCapturePolicy({
      getSiteConfigForOrigin: () => siteConfig
    });

    expect(policy.shouldPersist({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/app.css"
    })).toBe(true);
    expect(policy.shouldPersist({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/app.js"
    })).toBe(false);
  });

  it("defaults to persisting when no site config is available", () => {
    const policy = createCapturePolicy();

    expect(policy.shouldPersist({
      topOrigin: "https://unknown.example.com",
      method: "POST",
      url: "https://api.example.com/graphql"
    })).toBe(true);
  });
});
