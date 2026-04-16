import { afterEach, describe, expect, it, vi } from "vitest";

import { createBackgroundAuthority } from "../src/lib/background-authority.js";
import { normalizeSiteConfigs } from "../src/lib/site-config.js";
import { createAuthorityHarness } from "./helpers/background-authority-test-helpers.js";
import {
  createBackgroundState,
  createTestChromeApi,
  createMockServerClient
} from "./helpers/background-service-test-helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("background authority data", () => {
  it("falls back to local configured site configs when a server-backed read fails", async () => {
    const chromeApi = createTestChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return {
          ok: true,
          sentinel: { rootId: "local-root" },
          permission: "granted"
        };
      }
      if (message?.type === "fs.readConfiguredSiteConfigs") {
        return {
          ok: true,
          siteConfigs: [
            {
              origin: "https://local.example.com",
              createdAt: "2026-04-09T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.js$"]
            }
          ],
          sentinel: { rootId: "local-root" }
        };
      }
      return { ok: true };
    });

    const { authority } = createAuthorityHarness({
      chromeApi,
      serverClientOverrides: {
        readConfiguredSiteConfigs: vi
          .fn()
          .mockRejectedValue(new Error("server offline"))
      }
    });

    const result = await authority.readConfiguredSiteConfigsForAuthority();

    expect(result).toEqual({
      ok: true,
      siteConfigs: [
        {
          origin: "https://local.example.com",
          createdAt: "2026-04-09T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }
      ],
      sentinel: { rootId: "local-root" }
    });
  });

  it("collapses duplicate normalized origins when reading local configured site configs", async () => {
    const chromeApi = createTestChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return {
          ok: true,
          sentinel: { rootId: "local-root" },
          permission: "granted"
        };
      }
      if (message?.type === "fs.readConfiguredSiteConfigs") {
        return {
          ok: true,
          siteConfigs: [
            {
              origin: "local.example.com",
              createdAt: "2026-04-10T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.js$"]
            },
            {
              origin: "https://local.example.com",
              createdAt: "2026-04-09T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.json$", "\\.js$"]
            }
          ],
          sentinel: { rootId: "local-root" }
        };
      }
      return { ok: true };
    });

    const { authority } = createAuthorityHarness({
      chromeApi,
      normalizeSiteConfigs,
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      }
    });

    const result = await authority.readConfiguredSiteConfigsForAuthority();

    expect(result).toEqual({
      ok: true,
      siteConfigs: [
        {
          origin: "https://local.example.com",
          createdAt: "2026-04-09T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$", "\\.json$"]
        }
      ],
      sentinel: { rootId: "local-root" }
    });
  });

  it("collapses duplicate normalized origins when reading server configured site configs", async () => {
    const { authority } = createAuthorityHarness({
      normalizeSiteConfigs,
      serverClientOverrides: {
        readConfiguredSiteConfigs: vi.fn().mockResolvedValue({
          siteConfigs: [
            {
              origin: "server.example.com",
              createdAt: "2026-04-10T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.js$"]
            },
            {
              origin: "https://server.example.com",
              createdAt: "2026-04-09T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.json$", "\\.js$"]
            }
          ],
          sentinel: { rootId: "server-root" }
        })
      }
    });

    const result = await authority.readConfiguredSiteConfigsForAuthority();

    expect(result).toEqual({
      ok: true,
      siteConfigs: [
        {
          origin: "https://server.example.com",
          createdAt: "2026-04-09T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$", "\\.json$"]
        }
      ],
      sentinel: { rootId: "server-root" }
    });
  });

  it("surfaces repository fallback errors and incomplete fixture reads", async () => {
    const chromeApi = createTestChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    const responses = new Map<string, unknown>([
      ["fs.hasFixture", { ok: false, error: "Fixture lookup failed." }],
      [
        "fs.readFixture",
        { ok: true, exists: true, meta: { status: 200 }, bodyBase64: "Yg==" }
      ],
      ["fs.writeFixture", { ok: false, error: "Fixture write failed." }]
    ]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      return responses.get(String((message as { type?: string }).type));
    });
    const { authority } = createAuthorityHarness({
      chromeApi,
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      }
    });

    await expect(
      authority.repository.exists({
        requestUrl: "https://cdn.example.com/app.js",
        bodyPath: "assets/app.js"
      } as any)
    ).rejects.toThrow("Fixture lookup failed.");
    await expect(
      authority.repository.read({
        requestUrl: "https://cdn.example.com/app.js",
        bodyPath: "assets/app.js"
      } as any)
    ).resolves.toBeNull();
    await expect(
      authority.repository.writeIfAbsent({
        descriptor: {
          requestUrl: "https://cdn.example.com/app.js",
          bodyPath: "assets/app.js"
        } as any,
        request: {
          method: "GET",
          url: "https://cdn.example.com/app.js",
          headers: [],
          body: "",
          bodyEncoding: "utf8"
        } as any,
        response: {
          body: "body",
          bodyEncoding: "utf8",
          meta: {
            status: 200,
            statusText: "OK",
            headers: []
          } as any
        }
      })
    ).rejects.toThrow("Fixture write failed.");
  });

  it("rejects fixture reads when the local fallback reports an explicit read error", async () => {
    const chromeApi = createTestChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.readFixture") {
        return { ok: false, error: "Fixture read failed." };
      }
      return { ok: true };
    });
    const { authority } = createAuthorityHarness({
      chromeApi,
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      }
    });

    await expect(
      authority.repository.read({
        requestUrl: "https://cdn.example.com/app.js",
        bodyPath: "assets/app.js"
      } as any)
    ).rejects.toThrow("Fixture read failed.");
  });

  it("throws a combined error when the server is unavailable and no fallback root is ready", async () => {
    const chromeApi = createTestChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return { ok: false, error: "Permission denied." };
      }
      return { ok: true };
    });
    const { authority } = createAuthorityHarness({
      chromeApi,
      stateOverrides: {
        serverInfo: {
          rootPath: "/tmp/server-root",
          sentinel: { rootId: "server-root" },
          baseUrl: "http://127.0.0.1:4319",
          mcpUrl: "http://127.0.0.1:4319/mcp",
          trpcUrl: "http://127.0.0.1:4319/trpc"
        },
        serverCheckedAt: Date.now()
      }
    });

    await expect(
      authority.withServerFallback({
        remoteOperation: async () => {
          throw new Error("server offline");
        },
        localOperation: async () => "local"
      })
    ).rejects.toThrow(
      "Local WraithWalker server is unavailable and no fallback root is ready. server offline"
    );
  });

  it("writes configured site configs locally and reconciles active tabs when local mode is active", async () => {
    const chromeApi = createTestChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return {
          ok: true,
          sentinel: { rootId: "local-root" },
          permission: "granted"
        };
      }
      if (message?.type === "fs.writeConfiguredSiteConfigs") {
        return {
          ok: true,
          siteConfigs: [
            {
              origin: "https://local.example.com",
              createdAt: "2026-04-09T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.js$"]
            }
          ],
          sentinel: { rootId: "local-root" }
        };
      }
      return { ok: true };
    });

    const reconcileTabs = vi.fn().mockResolvedValue(undefined);
    const { authority } = createAuthorityHarness({
      chromeApi,
      stateOverrides: {
        sessionActive: true
      },
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      },
      reconcileTabs
    });

    const result = await authority.writeConfiguredSiteConfigsForAuthority([
      {
        origin: "https://local.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }
    ]);

    expect(result).toEqual({
      ok: true,
      siteConfigs: [
        {
          origin: "https://local.example.com",
          createdAt: "2026-04-09T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }
      ],
      sentinel: { rootId: "local-root" }
    });
    expect(reconcileTabs).toHaveBeenCalled();
  });

  it("falls back to local configured-site writes when a server write fails", async () => {
    const chromeApi = createTestChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return {
          ok: true,
          sentinel: { rootId: "local-root" },
          permission: "granted"
        };
      }
      if (message?.type === "fs.writeConfiguredSiteConfigs") {
        return {
          ok: true,
          siteConfigs: [
            {
              origin: "https://fallback.example.com",
              createdAt: "2026-04-09T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.css$"]
            }
          ],
          sentinel: { rootId: "local-root" }
        };
      }
      return { ok: true };
    });
    const reconcileTabs = vi.fn().mockResolvedValue(undefined);
    const { authority } = createAuthorityHarness({
      chromeApi,
      stateOverrides: {
        sessionActive: true
      },
      serverClientOverrides: {
        writeConfiguredSiteConfigs: vi
          .fn()
          .mockRejectedValue(new Error("server write failed"))
      },
      reconcileTabs
    });

    const result = await authority.writeConfiguredSiteConfigsForAuthority([
      {
        origin: "https://fallback.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.css$"]
      }
    ]);

    expect(result).toEqual({
      ok: true,
      siteConfigs: [
        {
          origin: "https://fallback.example.com",
          createdAt: "2026-04-09T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.css$"]
        }
      ],
      sentinel: { rootId: "local-root" }
    });
    expect(reconcileTabs).toHaveBeenCalled();
  });

  it("writes canonicalized site configs to the local fallback authority", async () => {
    const chromeApi = createTestChromeApi();
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.ensureRoot") {
        return {
          ok: true,
          sentinel: { rootId: "local-root" },
          permission: "granted"
        };
      }
      if (message?.type === "fs.writeConfiguredSiteConfigs") {
        return {
          ok: true,
          siteConfigs: message.payload?.siteConfigs ?? [],
          sentinel: { rootId: "local-root" }
        };
      }
      return { ok: true };
    });

    const { authority } = createAuthorityHarness({
      chromeApi,
      normalizeSiteConfigs,
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      }
    });

    await authority.writeConfiguredSiteConfigsForAuthority([
      {
        origin: "local.example.com",
        createdAt: "2026-04-10T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      },
      {
        origin: "https://local.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.json$", "\\.js$"]
      }
    ]);

    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "fs.writeConfiguredSiteConfigs",
        payload: {
          siteConfigs: [
            {
              origin: "https://local.example.com",
              createdAt: "2026-04-09T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.js$", "\\.json$"]
            }
          ]
        }
      })
    );
  });

  it("writes canonicalized site configs to the server authority", async () => {
    const writeConfiguredSiteConfigs = vi.fn().mockResolvedValue({
      siteConfigs: [],
      sentinel: { rootId: "server-root" }
    });
    const { authority } = createAuthorityHarness({
      normalizeSiteConfigs,
      serverClientOverrides: {
        writeConfiguredSiteConfigs
      }
    });

    await authority.writeConfiguredSiteConfigsForAuthority([
      {
        origin: "server.example.com",
        createdAt: "2026-04-10T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      },
      {
        origin: "https://server.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.json$", "\\.js$"]
      }
    ]);

    expect(writeConfiguredSiteConfigs).toHaveBeenCalledWith([
      {
        origin: "https://server.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$", "\\.json$"]
      }
    ]);
  });

  it("refreshes local state from offscreen storage and preserves the prior version when the manifest omits one", async () => {
    const chromeApi = createTestChromeApi();
    chromeApi.runtime.getManifest = vi.fn(() => ({}));
    chromeApi.runtime.getContexts.mockResolvedValue([{}]);
    chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
      if (message?.type === "fs.readEffectiveSiteConfigs") {
        return {
          ok: true,
          siteConfigs: [
            {
              origin: "https://local.example.com",
              createdAt: "2026-04-09T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.js$"]
            }
          ],
          sentinel: { rootId: "local-root" }
        };
      }
      return { ok: true };
    });
    const state = createBackgroundState({
      extensionVersion: "9.9.9"
    });
    const authority = createBackgroundAuthority({
      state,
      chromeApi,
      serverClient: createMockServerClient(),
      getLegacySiteConfigs: vi.fn().mockResolvedValue([]),
      getLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(true),
      getNativeHostConfig: vi.fn().mockResolvedValue({
        hostName: "",
        launchPath: "",
        editorLaunchOverrides: {}
      }),
      getOrCreateExtensionClientId: vi.fn().mockResolvedValue("client-1"),
      setLegacySiteConfigsMigrated: vi.fn().mockResolvedValue(undefined),
      setLastSessionSnapshot: vi.fn().mockResolvedValue(undefined),
      normalizeSiteConfigs: vi.fn((siteConfigs) => siteConfigs as any),
      setLastError: vi.fn((message) => {
        state.lastError = message;
      }),
      syncTraceBindings: vi.fn().mockResolvedValue(undefined),
      reconcileTabs: vi.fn().mockResolvedValue(undefined)
    });

    await authority.refreshStoredConfig();

    expect(state.localEnabledOrigins).toEqual(["https://local.example.com"]);
    expect(state.extensionVersion).toBe("9.9.9");
  });

  it("refreshStoredConfig collapses duplicate normalized origins into local state", async () => {
    const { authority, state } = createAuthorityHarness({
      getSiteConfigs: vi.fn().mockResolvedValue([
        {
          origin: "local.example.com",
          createdAt: "2026-04-10T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        },
        {
          origin: "https://local.example.com",
          createdAt: "2026-04-09T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.json$", "\\.js$"]
        }
      ]),
      normalizeSiteConfigs
    });

    await authority.refreshStoredConfig();

    expect(state.localEnabledOrigins).toEqual(["https://local.example.com"]);
    expect([...state.localSiteConfigsByOrigin.values()]).toEqual([
      {
        origin: "https://local.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$", "\\.json$"]
      }
    ]);
    expect([...state.siteConfigsByOrigin.values()]).toEqual([
      {
        origin: "https://local.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$", "\\.json$"]
      }
    ]);
  });
});
