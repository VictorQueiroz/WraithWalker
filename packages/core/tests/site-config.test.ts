import { describe, expect, it } from "vitest";

import {
  createConfiguredSiteConfig,
  createDiscoveredSiteConfig,
  createSiteConfig,
  DEFAULT_DUMP_ALLOWLIST_PATTERN,
  DEFAULT_DUMP_ALLOWLIST_PATTERNS,
  DISCOVERED_SITE_CREATED_AT,
  EXPLICIT_SITE_EXTRA_DUMP_ALLOWLIST_PATTERNS,
  isValidDumpAllowlistPatterns,
  mergeSiteConfigs,
  normalizeDumpAllowlistPatterns,
  normalizeSiteConfig,
  normalizeSiteConfigs,
  shouldDumpRequest
} from "../src/site-config.mts";

describe("site config helpers", () => {
  it("normalizes dump patterns and preserves valid input", () => {
    expect(normalizeDumpAllowlistPatterns(undefined)).toEqual(
      DEFAULT_DUMP_ALLOWLIST_PATTERNS
    );
    expect(normalizeDumpAllowlistPatterns(["\\.js$", "[", "\\.css$"])).toEqual([
      "\\.js$",
      "\\.css$"
    ]);
    expect(normalizeDumpAllowlistPatterns(["[", "   ", 42 as any])).toEqual(
      DEFAULT_DUMP_ALLOWLIST_PATTERNS
    );
    expect(normalizeDumpAllowlistPatterns("\\.css$")).toEqual(["\\.css$"]);
  });

  it("normalizes legacy fields into a full site config", () => {
    const config = normalizeSiteConfig({
      origin: "app.example.com",
      dumpAllowlistPattern: "\\.svg$"
    });

    expect(config).toEqual(
      expect.objectContaining({
        origin: "https://app.example.com",
        dumpAllowlistPatterns: ["\\.svg$"]
      })
    );
  });

  it("canonicalizes duplicate normalized origins, preserves the earliest createdAt, merges patterns, and sorts by origin", () => {
    expect(
      normalizeSiteConfigs([
        {
          origin: "zeta.example.com",
          createdAt: "2026-04-10T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.css$"]
        },
        {
          origin: "app.example.com",
          createdAt: "2026-04-09T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        },
        {
          origin: "https://app.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.json$", "\\.js$"]
        }
      ])
    ).toEqual([
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$", "\\.json$"]
      },
      {
        origin: "https://zeta.example.com",
        createdAt: "2026-04-10T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.css$"]
      }
    ]);
  });

  it("resolves duplicate createdAt precedence across later, valid, invalid, and lexical fallback cases", () => {
    const cases = [
      {
        name: "keeps the existing earlier valid timestamp",
        siteConfigs: [
          {
            origin: "app.example.com",
            createdAt: "2026-04-08T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          },
          {
            origin: "https://app.example.com",
            createdAt: "2026-04-09T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.json$"]
          }
        ],
        expectedCreatedAt: "2026-04-08T00:00:00.000Z"
      },
      {
        name: "prefers a valid candidate over an invalid current timestamp",
        siteConfigs: [
          {
            origin: "app.example.com",
            createdAt: "not-a-date",
            dumpAllowlistPatterns: ["\\.js$"]
          },
          {
            origin: "https://app.example.com",
            createdAt: "2026-04-08T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.json$"]
          }
        ],
        expectedCreatedAt: "2026-04-08T00:00:00.000Z"
      },
      {
        name: "keeps a valid current timestamp over an invalid candidate",
        siteConfigs: [
          {
            origin: "app.example.com",
            createdAt: "2026-04-08T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          },
          {
            origin: "https://app.example.com",
            createdAt: "not-a-date",
            dumpAllowlistPatterns: ["\\.json$"]
          }
        ],
        expectedCreatedAt: "2026-04-08T00:00:00.000Z"
      },
      {
        name: "falls back to lexical comparison when both timestamps are invalid",
        siteConfigs: [
          {
            origin: "app.example.com",
            createdAt: "zzz",
            dumpAllowlistPatterns: ["\\.js$"]
          },
          {
            origin: "https://app.example.com",
            createdAt: "aaa",
            dumpAllowlistPatterns: ["\\.json$"]
          }
        ],
        expectedCreatedAt: "aaa"
      }
    ] as const;

    for (const testCase of cases) {
      expect(normalizeSiteConfigs(testCase.siteConfigs), testCase.name).toEqual(
        [
          {
            origin: "https://app.example.com",
            createdAt: testCase.expectedCreatedAt,
            dumpAllowlistPatterns: ["\\.js$", "\\.json$"]
          }
        ]
      );
    }
  });

  it("creates explicit and discovered site configs with the expected defaults", () => {
    const explicit = createSiteConfig("https://app.example.com");
    const configured = createConfiguredSiteConfig("https://app.example.com");
    const discovered = createDiscoveredSiteConfig("https://app.example.com");

    expect(explicit.dumpAllowlistPatterns).toEqual(
      DEFAULT_DUMP_ALLOWLIST_PATTERNS
    );
    expect(configured.dumpAllowlistPatterns).toEqual([
      ...DEFAULT_DUMP_ALLOWLIST_PATTERNS,
      ...EXPLICIT_SITE_EXTRA_DUMP_ALLOWLIST_PATTERNS
    ]);
    expect(discovered).toEqual({
      origin: "https://app.example.com",
      createdAt: DISCOVERED_SITE_CREATED_AT,
      dumpAllowlistPatterns: DEFAULT_DUMP_ALLOWLIST_PATTERNS
    });
  });

  it("merges discovered origins with explicit config and keeps explicit values authoritative", () => {
    const merged = mergeSiteConfigs(
      [
        {
          origin: "app.example.com",
          createdAt: "2026-04-09T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.json$"]
        },
        {
          origin: "https://app.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.svg$"]
        }
      ],
      [
        { origin: "https://app.example.com" },
        { origin: "https://admin.example.com" }
      ]
    );

    expect(merged).toEqual([
      {
        origin: "https://admin.example.com",
        createdAt: DISCOVERED_SITE_CREATED_AT,
        dumpAllowlistPatterns: DEFAULT_DUMP_ALLOWLIST_PATTERNS
      },
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.json$", "\\.svg$"]
      }
    ]);
  });

  it("validates pattern arrays and matches GET asset requests", () => {
    expect(isValidDumpAllowlistPatterns(["\\.js$", "\\.css$"])).toBe(true);
    expect(isValidDumpAllowlistPatterns(["\\.js$", "["])).toBe(false);

    const config = {
      origin: "https://app.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: [
        DEFAULT_DUMP_ALLOWLIST_PATTERN,
        "\\.css$",
        "\\.wasm$"
      ]
    };

    expect(
      shouldDumpRequest(config, "GET", "https://cdn.example.com/app.js")
    ).toBe(true);
    expect(
      shouldDumpRequest(config, "GET", "https://cdn.example.com/style.css")
    ).toBe(true);
    expect(
      shouldDumpRequest(
        config,
        "GET",
        "https://cdn.example.com/pkg/module.wasm"
      )
    ).toBe(true);
    expect(
      shouldDumpRequest(config, "POST", "https://cdn.example.com/app.js")
    ).toBe(false);
    expect(
      shouldDumpRequest(config, "GET", "https://cdn.example.com/image.png")
    ).toBe(false);
    expect(shouldDumpRequest(config, "GET", "not a url")).toBe(false);
    expect(shouldDumpRequest(config, "GET", "data:text/plain,hello")).toBe(
      false
    );
    expect(
      shouldDumpRequest(
        config,
        "GET",
        "chrome-extension://extension-id/assets/app.js"
      )
    ).toBe(false);
  });
});
