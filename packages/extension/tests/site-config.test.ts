import { describe, expect, it } from "vitest";

import { DEFAULT_DUMP_ALLOWLIST_PATTERN, DEFAULT_DUMP_ALLOWLIST_PATTERNS } from "../src/lib/constants.js";
import {
  createSiteConfig,
  isValidDumpAllowlistPatterns,
  normalizeDumpAllowlistPatterns,
  normalizeSiteConfig,
  shouldDumpRequest
} from "../src/lib/site-config.js";
import type { SiteConfig } from "../src/lib/types.js";

describe("site config", () => {
  describe("normalizeDumpAllowlistPatterns", () => {
    it("returns the default patterns for empty or invalid input", () => {
      expect(normalizeDumpAllowlistPatterns(undefined)).toEqual(DEFAULT_DUMP_ALLOWLIST_PATTERNS);
      expect(normalizeDumpAllowlistPatterns(null)).toEqual(DEFAULT_DUMP_ALLOWLIST_PATTERNS);
      expect(normalizeDumpAllowlistPatterns("")).toEqual(DEFAULT_DUMP_ALLOWLIST_PATTERNS);
      expect(normalizeDumpAllowlistPatterns([])).toEqual(DEFAULT_DUMP_ALLOWLIST_PATTERNS);
    });

    it("migrates a legacy single-pattern string into an array", () => {
      expect(normalizeDumpAllowlistPatterns("\\.css$")).toEqual(["\\.css$"]);
    });

    it("falls back to defaults for an invalid legacy string", () => {
      expect(normalizeDumpAllowlistPatterns("[")).toEqual(DEFAULT_DUMP_ALLOWLIST_PATTERNS);
    });

    it("filters out invalid patterns from an array", () => {
      expect(normalizeDumpAllowlistPatterns(["\\.js$", "[", "\\.css$"])).toEqual(["\\.js$", "\\.css$"]);
    });

    it("falls back to defaults when all array entries are invalid", () => {
      expect(normalizeDumpAllowlistPatterns(["[", "("])).toEqual(DEFAULT_DUMP_ALLOWLIST_PATTERNS);
    });

    it("preserves valid patterns from an array", () => {
      expect(normalizeDumpAllowlistPatterns(["\\.js$", "\\.css$"])).toEqual(["\\.js$", "\\.css$"]);
    });
  });

  describe("normalizeSiteConfig legacy migration", () => {
    it("migrates dumpAllowlistPattern string to dumpAllowlistPatterns array", () => {
      const config = normalizeSiteConfig({
        origin: "https://app.example.com",
        mode: "simple",
        dumpAllowlistPattern: "\\.css$"
      } as any);

      expect(config.dumpAllowlistPatterns).toEqual(["\\.css$"]);
    });

    it("prefers dumpAllowlistPatterns over legacy dumpAllowlistPattern", () => {
      const config = normalizeSiteConfig({
        origin: "https://app.example.com",
        mode: "simple",
        dumpAllowlistPatterns: ["\\.js$"],
        dumpAllowlistPattern: "\\.css$"
      } as any);

      expect(config.dumpAllowlistPatterns).toEqual(["\\.js$"]);
    });
  });

  describe("isValidDumpAllowlistPatterns", () => {
    it("returns true when all patterns are valid", () => {
      expect(isValidDumpAllowlistPatterns(["\\.js$", "\\.css$"])).toBe(true);
    });

    it("returns false when any pattern is invalid", () => {
      expect(isValidDumpAllowlistPatterns(["\\.js$", "["])).toBe(false);
    });

    it("returns true for an empty array", () => {
      expect(isValidDumpAllowlistPatterns([])).toBe(true);
    });
  });

  describe("createSiteConfig", () => {
    it("creates a config with default patterns as an array", () => {
      const config = createSiteConfig("app.example.com");
      expect(config.dumpAllowlistPatterns).toEqual(DEFAULT_DUMP_ALLOWLIST_PATTERNS);
      expect(Array.isArray(config.dumpAllowlistPatterns)).toBe(true);
    });
  });

  describe("shouldDumpRequest with multiple patterns", () => {
    const baseSite: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-03T00:00:00.000Z",
      mode: "simple",
      dumpAllowlistPatterns: ["\\.js$", "\\.css$", "\\.json$"]
    };

    it("matches the first pattern", () => {
      expect(shouldDumpRequest(baseSite, "GET", "https://cdn.example.com/app.js")).toBe(true);
    });

    it("matches a middle pattern", () => {
      expect(shouldDumpRequest(baseSite, "GET", "https://cdn.example.com/style.css")).toBe(true);
    });

    it("matches the last pattern", () => {
      expect(shouldDumpRequest(baseSite, "GET", "https://cdn.example.com/data.json")).toBe(true);
    });

    it("rejects when no pattern matches", () => {
      expect(shouldDumpRequest(baseSite, "GET", "https://cdn.example.com/image.png")).toBe(false);
    });

    it("rejects non-GET requests regardless of patterns", () => {
      expect(shouldDumpRequest(baseSite, "POST", "https://cdn.example.com/app.js")).toBe(false);
    });
  });
});
