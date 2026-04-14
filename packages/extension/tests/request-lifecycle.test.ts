import { promises as fs } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createRequestLifecycle } from "../src/lib/request-lifecycle.js";
import { createFixtureDescriptor as realCreateFixtureDescriptor } from "../src/lib/fixture-mapper.js";
import type { SiteConfig } from "../src/lib/types.js";
import { createWraithWalkerServerClient } from "../src/lib/wraithwalker-server.js";
import { syncOverridesDirectory } from "../../core/src/overrides-sync.mts";
import { startHttpServer } from "../../mcp-server/src/server.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";
import {
  createFetchPausedParams,
  createServerBackedLifecycleHarness,
  createServerBackedRepository,
  createTempOverridesDir,
  writeOverrideFile
} from "./helpers/request-lifecycle-test-helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("request lifecycle integration", () => {
  it("replays a synced override without .headers using the current live response headers end-to-end", async () => {
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-sync-live-headers-"
    });
    const overridesDir = await createTempOverridesDir();
    const server = await startHttpServer(serverRoot.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const serverClient = createWraithWalkerServerClient(server.trpcUrl, {
      timeoutMs: 2_000
    });
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-09T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.css$"]
    };

    try {
      await writeOverrideFile(overridesDir, "app.example.com/assets/app.css", "body { color: rebeccapurple; }");
      await syncOverridesDirectory({
        dir: overridesDir,
        onEvent: undefined
      });

      await fs.cp(overridesDir, serverRoot.rootPath, { recursive: true });

      const descriptor = await realCreateFixtureDescriptor({
        topOrigin: siteConfig.origin,
        method: "GET",
        url: "https://app.example.com/assets/app.css",
        resourceType: "Stylesheet",
        mimeType: "text/css"
      });
      const syncedMeta = await serverRoot.readJson<{ headerStrategy?: string }>(descriptor.metaPath);
      expect(syncedMeta.headerStrategy).toBe("live");

      const harness = createServerBackedLifecycleHarness({ serverClient, siteConfig });

      await harness.lifecycle.handleFetchRequestPaused(
        { tabId: 1 },
        createFetchPausedParams({
          requestId: "fetch-synced-live",
          networkId: "network-synced-live",
          request: {
            method: "GET",
            url: descriptor.requestUrl,
            headers: {
              Origin: siteConfig.origin,
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
          requestId: "fetch-synced-live",
          interceptResponse: true
        }
      );

      harness.lifecycle.handleNetworkResponseReceived(
        { tabId: 1 },
        {
          requestId: "network-synced-live",
          response: {
            status: 200,
            statusText: "OK",
            headers: {
              "Content-Type": "text/css",
              ETag: "\"live-v1\""
            },
            mimeType: "text/css"
          },
          type: "Stylesheet"
        }
      );

      await harness.lifecycle.handleFetchRequestPaused(
        { tabId: 1 },
        createFetchPausedParams({
          requestId: "fetch-synced-live-response",
          networkId: "network-synced-live",
          request: {
            method: "GET",
            url: descriptor.requestUrl,
            headers: {
              Origin: siteConfig.origin,
              "Sec-Fetch-Mode": "cors"
            }
          },
          resourceType: "Stylesheet",
          responseStatusCode: 200,
          responseHeaders: {
            "Content-Type": "text/css",
            ETag: "\"live-v1\""
          }
        })
      );

      expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
        1,
        "Fetch.fulfillRequest",
        expect.objectContaining({
          requestId: "fetch-synced-live-response",
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "text/css" },
            { name: "ETag", value: "\"live-v1\"" },
            { name: "Access-Control-Allow-Origin", value: siteConfig.origin },
            { name: "Vary", value: "Origin" }
          ]
        })
      );
    } finally {
      await server.close();
    }
  });

  it("replays a synced override with .headers using stored headers without response-stage interception", async () => {
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-sync-stored-headers-"
    });
    const overridesDir = await createTempOverridesDir();
    const server = await startHttpServer(serverRoot.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const serverClient = createWraithWalkerServerClient(server.trpcUrl, {
      timeoutMs: 2_000
    });
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-09T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.js$"]
    };

    try {
      await writeOverrideFile(
        overridesDir,
        "app.example.com/scripts/.headers",
        JSON.stringify([
          {
            applyTo: "*.js",
            headers: [
              { name: "Content-Type", value: "application/x-custom-js" },
              { name: "Cache-Control", value: "no-store" }
            ]
          }
        ], null, 2)
      );
      await writeOverrideFile(overridesDir, "app.example.com/scripts/app.js", "console.log('synced script');");
      await syncOverridesDirectory({
        dir: overridesDir,
        onEvent: undefined
      });

      await fs.cp(overridesDir, serverRoot.rootPath, { recursive: true });

      const descriptor = await realCreateFixtureDescriptor({
        topOrigin: siteConfig.origin,
        method: "GET",
        url: "https://app.example.com/scripts/app.js",
        resourceType: "Script",
        mimeType: "application/javascript"
      });
      const syncedMeta = await serverRoot.readJson<{ headerStrategy?: string }>(descriptor.metaPath);
      expect(syncedMeta.headerStrategy).toBe("stored");

      const harness = createServerBackedLifecycleHarness({ serverClient, siteConfig });

      await harness.lifecycle.handleFetchRequestPaused(
        { tabId: 1 },
        createFetchPausedParams({
          requestId: "fetch-synced-stored",
          networkId: "network-synced-stored",
          request: {
            method: "GET",
            url: descriptor.requestUrl,
            headers: {}
          },
          resourceType: "Script"
        })
      );

      expect(harness.sendDebuggerCommand).not.toHaveBeenCalledWith(
        1,
        "Fetch.continueRequest",
        expect.objectContaining({ interceptResponse: true })
      );
      expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
        1,
        "Fetch.fulfillRequest",
        expect.objectContaining({
          requestId: "fetch-synced-stored",
          responseHeaders: [
            { name: "Content-Type", value: "application/x-custom-js" },
            { name: "Cache-Control", value: "no-store" },
          ]
        })
      );
    } finally {
      await server.close();
    }
  });

  it("writes captured simple-mode assets into the live server root instead of the local fallback root", async () => {
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-live-server-"
    });
    const localRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-local-root-"
    });
    const server = await startHttpServer(serverRoot.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const serverClient = createWraithWalkerServerClient(server.trpcUrl, {
      timeoutMs: 2_000
    });
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-07T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.js$"]
    };
    const state = {
      sessionActive: true,
      attachedTabs: new Map([[1, { topOrigin: "https://app.example.com" }]]),
      requests: new Map<string, any>()
    };
    const sendDebuggerCommandMock = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Network.getResponseBody") {
        return {
          body: "console.log('from live server');",
          base64Encoded: false
        };
      }
      return { method, params };
    });

    const lifecycle = createRequestLifecycle({
      state,
      sendDebuggerCommand: ((tabId, method, params) => sendDebuggerCommandMock(tabId, method, params) as Promise<any>),
      sendOffscreenMessage: vi.fn(async () => ({ ok: true })) as Parameters<typeof createRequestLifecycle>[0]["sendOffscreenMessage"],
      setLastError: vi.fn(),
      repository: createServerBackedRepository(serverClient),
      createFixtureDescriptor: realCreateFixtureDescriptor,
      getSiteConfigForOrigin: vi.fn((topOrigin) => (
        topOrigin === "https://app.example.com"
          ? siteConfig
          : undefined
      ))
    });
    const descriptor = await realCreateFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/app.js",
      resourceType: "Script",
      mimeType: "application/javascript"
    });

    try {
      lifecycle.handleNetworkRequestWillBeSent(
        { tabId: 1 },
        {
          requestId: "req-live-server",
          request: {
            method: "GET",
            url: descriptor.requestUrl,
            headers: {}
          },
          type: "Script"
        }
      );
      lifecycle.handleNetworkResponseReceived(
        { tabId: 1 },
        {
          requestId: "req-live-server",
          response: {
            status: 200,
            statusText: "OK",
            headers: { "Content-Type": "application/javascript" },
            mimeType: "application/javascript"
          },
          type: "Script"
        }
      );

      await lifecycle.handleNetworkLoadingFinished({ tabId: 1 }, { requestId: "req-live-server" });

      expect(await fs.readFile(serverRoot.resolve(descriptor.bodyPath), "utf8")).toBe("console.log('from live server');");
      expect(await serverRoot.readJson(descriptor.requestPath)).toEqual(expect.objectContaining({
        topOrigin: "https://app.example.com",
        url: descriptor.requestUrl,
        method: "GET"
      }));
      expect(await serverRoot.readJson(descriptor.metaPath)).toEqual(expect.objectContaining({
        status: 200,
        mimeType: "application/javascript",
        resourceType: "Script"
      }));
      expect(await serverClient.hasFixture(descriptor)).toEqual(expect.objectContaining({
        exists: true
      }));
      await expect(fs.access(localRoot.resolve(descriptor.bodyPath))).rejects.toThrow();
      await expect(fs.access(localRoot.resolve(descriptor.requestPath))).rejects.toThrow();
      await expect(fs.access(localRoot.resolve(descriptor.metaPath))).rejects.toThrow();
      if (descriptor.manifestPath) {
        await expect(fs.access(localRoot.resolve(descriptor.manifestPath))).rejects.toThrow();
      }
      expect(state.requests.size).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("captures using server-provided site config from .wraithwalker/config.json before any fixtures exist", async () => {
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-server-config-"
    });
    await serverRoot.writeProjectConfig({
      schemaVersion: 1,
      sites: [{
        origin: "https://app.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.svg$"]
      }]
    });
    const server = await startHttpServer(serverRoot.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const serverClient = createWraithWalkerServerClient(server.trpcUrl, {
      timeoutMs: 2_000
    });
    const state = {
      sessionActive: true,
      attachedTabs: new Map([[1, { topOrigin: "https://app.example.com" }]]),
      requests: new Map<string, any>()
    };
    const sendDebuggerCommandMock = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Network.getResponseBody") {
        return {
          body: "<svg viewBox=\"0 0 10 10\"></svg>",
          base64Encoded: false
        };
      }
      return { method, params };
    });
    const systemInfo = await serverClient.getSystemInfo();
    const serverSiteConfig = systemInfo.siteConfigs.find((siteConfig) => siteConfig.origin === "https://app.example.com");

    expect(systemInfo.siteConfigs).toEqual([
      expect.objectContaining({
        origin: "https://app.example.com",
        dumpAllowlistPatterns: ["\\.svg$"]
      })
    ]);
    expect(serverSiteConfig).toBeTruthy();

    const lifecycle = createRequestLifecycle({
      state,
      sendDebuggerCommand: ((tabId, method, params) => sendDebuggerCommandMock(tabId, method, params) as Promise<any>),
      sendOffscreenMessage: vi.fn(async () => ({ ok: true })) as Parameters<typeof createRequestLifecycle>[0]["sendOffscreenMessage"],
      setLastError: vi.fn(),
      repository: createServerBackedRepository(serverClient),
      createFixtureDescriptor: realCreateFixtureDescriptor,
      getSiteConfigForOrigin: vi.fn((topOrigin) => (
        topOrigin === "https://app.example.com"
          ? serverSiteConfig
          : undefined
      ))
    });
    const descriptor = await realCreateFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/logo.svg",
      resourceType: "Image",
      mimeType: "image/svg+xml"
    });

    try {
      lifecycle.handleNetworkRequestWillBeSent(
        { tabId: 1 },
        {
          requestId: "req-server-config",
          request: {
            method: "GET",
            url: descriptor.requestUrl,
            headers: {}
          },
          type: "Image"
        }
      );
      lifecycle.handleNetworkResponseReceived(
        { tabId: 1 },
        {
          requestId: "req-server-config",
          response: {
            status: 200,
            statusText: "OK",
            headers: { "Content-Type": "image/svg+xml" },
            mimeType: "image/svg+xml"
          },
          type: "Image"
        }
      );

      await lifecycle.handleNetworkLoadingFinished({ tabId: 1 }, { requestId: "req-server-config" });

      expect(await fs.readFile(serverRoot.resolve(descriptor.bodyPath), "utf8")).toBe("<svg viewBox=\"0 0 10 10\"></svg>");
      expect(await serverRoot.readJson(descriptor.requestPath)).toEqual(expect.objectContaining({
        topOrigin: "https://app.example.com",
        url: descriptor.requestUrl
      }));
      expect(await serverRoot.readJson(descriptor.metaPath)).toEqual(expect.objectContaining({
        mimeType: "image/svg+xml",
        resourceType: "Image"
      }));
    } finally {
      await server.close();
    }
  });

  it("replays the human-facing projection for a live tRPC-backed asset fixture through Fetch.fulfillRequest with sanitized headers", async () => {
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-live-replay-asset-"
    });
    const server = await startHttpServer(serverRoot.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const serverClient = createWraithWalkerServerClient(server.trpcUrl, {
      timeoutMs: 2_000
    });
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.js$"]
    };
    const descriptor = await realCreateFixtureDescriptor({
      topOrigin: siteConfig.origin,
      method: "GET",
      url: "https://cdn.example.com/assets/app.js",
      resourceType: "Script",
      mimeType: "application/javascript"
    });
    const body = "console.log('server replay');";

    try {
      await serverClient.writeFixtureIfAbsent({
        descriptor,
        request: {
          topOrigin: descriptor.topOrigin,
          url: descriptor.requestUrl,
          method: descriptor.method,
          headers: [],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: descriptor.bodyHash,
          queryHash: descriptor.queryHash,
          capturedAt: "2026-04-08T00:00:00.000Z"
        },
        response: {
          body,
          bodyEncoding: "utf8",
          meta: {
            status: 203,
            statusText: "Non-Authoritative Information",
            headers: [
              { name: "Content-Type", value: "application/javascript" },
              { name: "Content-Length", value: String(body.length) },
              { name: "Connection", value: "keep-alive" },
              { name: "Set-Cookie", value: "a=b" }
            ],
            mimeType: "application/javascript",
            resourceType: "Script",
            url: descriptor.requestUrl,
            method: descriptor.method,
            capturedAt: "2026-04-08T00:00:00.000Z",
            bodyEncoding: "utf8",
            bodySuggestedExtension: "js"
          }
        }
      });
      const harness = createServerBackedLifecycleHarness({ serverClient, siteConfig });

      await harness.lifecycle.handleFetchRequestPaused(
        { tabId: 1 },
        createFetchPausedParams({
          requestId: "fetch-live-server-asset",
          networkId: "network-live-server-asset",
          request: {
            method: "GET",
            url: descriptor.requestUrl,
            headers: {}
          },
          resourceType: "Script"
        })
      );

      expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
        1,
        "Fetch.fulfillRequest",
        {
          requestId: "fetch-live-server-asset",
          responseCode: 203,
          responsePhrase: "Non-Authoritative Information",
          responseHeaders: [
            { name: "Content-Type", value: "application/javascript" },
            { name: "Set-Cookie", value: "a=b" }
          ],
          body: Buffer.from("console.log(\"server replay\");", "utf8").toString("base64")
        }
      );
      expect(harness.state.requests.get("1:network-live-server-asset")).toMatchObject({
        replayed: true,
        topOrigin: siteConfig.origin,
        url: descriptor.requestUrl
      });
    } finally {
      await server.close();
    }
  });

  it("serves an edited human-facing projection body for a live tRPC-backed asset fixture", async () => {
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-live-replay-edited-projection-"
    });
    const server = await startHttpServer(serverRoot.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const serverClient = createWraithWalkerServerClient(server.trpcUrl, {
      timeoutMs: 2_000
    });
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.js$"]
    };
    const descriptor = await realCreateFixtureDescriptor({
      topOrigin: siteConfig.origin,
      method: "GET",
      url: "https://cdn.example.com/assets/app.js",
      resourceType: "Script",
      mimeType: "application/javascript"
    });

    try {
      await serverClient.writeFixtureIfAbsent({
        descriptor,
        request: {
          topOrigin: descriptor.topOrigin,
          url: descriptor.requestUrl,
          method: descriptor.method,
          headers: [],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: descriptor.bodyHash,
          queryHash: descriptor.queryHash,
          capturedAt: "2026-04-08T00:00:00.000Z"
        },
        response: {
          body: "console.log('canonical');",
          bodyEncoding: "utf8",
          meta: {
            status: 200,
            statusText: "OK",
            headers: [{ name: "Content-Type", value: "application/javascript" }],
            mimeType: "application/javascript",
            resourceType: "Script",
            url: descriptor.requestUrl,
            method: descriptor.method,
            capturedAt: "2026-04-08T00:00:00.000Z",
            bodyEncoding: "utf8",
            bodySuggestedExtension: "js"
          }
        }
      });
      await fs.writeFile(serverRoot.resolve(descriptor.projectionPath!), "window.__FROM_PROJECTION__ = true;\n");
      const harness = createServerBackedLifecycleHarness({ serverClient, siteConfig });

      await harness.lifecycle.handleFetchRequestPaused(
        { tabId: 1 },
        createFetchPausedParams({
          requestId: "fetch-live-server-edited-projection",
          networkId: "network-live-server-edited-projection",
          request: {
            method: "GET",
            url: descriptor.requestUrl,
            headers: {}
          },
          resourceType: "Script"
        })
      );

      expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
        1,
        "Fetch.fulfillRequest",
        expect.objectContaining({
          requestId: "fetch-live-server-edited-projection",
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/javascript" }],
          body: Buffer.from("window.__FROM_PROJECTION__ = true;\n", "utf8").toString("base64")
        })
      );
    } finally {
      await server.close();
    }
  });

  it("replays an edited shared human-facing projection while keeping query-variant CORS headers", async () => {
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-live-replay-query-edited-projection-"
    });
    const server = await startHttpServer(serverRoot.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const serverClient = createWraithWalkerServerClient(server.trpcUrl, {
      timeoutMs: 2_000
    });
    const siteConfig: SiteConfig = {
      origin: "https://domain-b.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.js$"]
    };
    const firstDescriptor = await realCreateFixtureDescriptor({
      topOrigin: siteConfig.origin,
      method: "GET",
      url: "https://domain-a.example.com/a.js?prop1=&prop2=B",
      resourceType: "Script",
      mimeType: "application/javascript"
    });
    const secondDescriptor = await realCreateFixtureDescriptor({
      topOrigin: siteConfig.origin,
      method: "GET",
      url: "https://domain-a.example.com/a.js?cache-bust=true&retry-attempt=2",
      resourceType: "Script",
      mimeType: "application/javascript"
    });

    try {
      await serverClient.writeFixtureIfAbsent({
        descriptor: firstDescriptor,
        request: {
          topOrigin: firstDescriptor.topOrigin,
          url: firstDescriptor.requestUrl,
          method: firstDescriptor.method,
          headers: [],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: firstDescriptor.bodyHash,
          queryHash: firstDescriptor.queryHash,
          capturedAt: "2026-04-08T00:00:00.000Z"
        },
        response: {
          body: "console.log('canonical first');",
          bodyEncoding: "utf8",
          meta: {
            status: 200,
            statusText: "OK",
            headers: [{ name: "Content-Type", value: "application/javascript" }],
            mimeType: "application/javascript",
            resourceType: "Script",
            url: firstDescriptor.requestUrl,
            method: firstDescriptor.method,
            capturedAt: "2026-04-08T00:00:00.000Z",
            bodyEncoding: "utf8",
            bodySuggestedExtension: "js"
          }
        }
      });
      await serverClient.writeFixtureIfAbsent({
        descriptor: secondDescriptor,
        request: {
          topOrigin: secondDescriptor.topOrigin,
          url: secondDescriptor.requestUrl,
          method: secondDescriptor.method,
          headers: [],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: secondDescriptor.bodyHash,
          queryHash: secondDescriptor.queryHash,
          capturedAt: "2026-04-08T00:00:01.000Z"
        },
        response: {
          body: "console.log('canonical second');",
          bodyEncoding: "utf8",
          meta: {
            status: 200,
            statusText: "OK",
            headers: [
              { name: "Content-Type", value: "application/javascript" },
              { name: "Access-Control-Allow-Origin", value: "https://domain-b.example.com" },
              { name: "Vary", value: "Origin" }
            ],
            mimeType: "application/javascript",
            resourceType: "Script",
            url: secondDescriptor.requestUrl,
            method: secondDescriptor.method,
            capturedAt: "2026-04-08T00:00:01.000Z",
            bodyEncoding: "utf8",
            bodySuggestedExtension: "js"
          }
        }
      });
      await fs.writeFile(serverRoot.resolve(firstDescriptor.projectionPath!), "window.__QUERY_EDIT__ = true;\n");
      const harness = createServerBackedLifecycleHarness({ serverClient, siteConfig });

      await harness.lifecycle.handleFetchRequestPaused(
        { tabId: 1 },
        createFetchPausedParams({
          requestId: "fetch-live-server-query-edited-projection",
          networkId: "network-live-server-query-edited-projection",
          request: {
            method: "GET",
            url: secondDescriptor.requestUrl,
            headers: {}
          },
          resourceType: "Script"
        })
      );

      expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
        1,
        "Fetch.fulfillRequest",
        expect.objectContaining({
          requestId: "fetch-live-server-query-edited-projection",
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "application/javascript" },
            { name: "Access-Control-Allow-Origin", value: "https://domain-b.example.com" },
            { name: "Vary", value: "Origin" }
          ],
          body: Buffer.from("window.__QUERY_EDIT__ = true;\n", "utf8").toString("base64")
        })
      );
    } finally {
      await server.close();
    }
  });

  it("replays a live tRPC-backed simple-mode GET API fixture through Fetch.fulfillRequest", async () => {
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-extension-live-replay-api-"
    });
    const server = await startHttpServer(serverRoot.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const serverClient = createWraithWalkerServerClient(server.trpcUrl, {
      timeoutMs: 2_000
    });
    const siteConfig: SiteConfig = {
      origin: "https://app.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.json$"]
    };
    const descriptor = await realCreateFixtureDescriptor({
      topOrigin: siteConfig.origin,
      method: "GET",
      url: "https://api.example.com/state",
      resourceType: "XHR"
    });
    const body = JSON.stringify({ ready: true });

    expect(descriptor.storageMode).toBe("api");

    try {
      await serverClient.writeFixtureIfAbsent({
        descriptor,
        request: {
          topOrigin: descriptor.topOrigin,
          url: descriptor.requestUrl,
          method: descriptor.method,
          headers: [{ name: "Accept", value: "application/json" }],
          body: "",
          bodyEncoding: "utf8",
          bodyHash: descriptor.bodyHash,
          queryHash: descriptor.queryHash,
          capturedAt: "2026-04-08T00:00:00.000Z"
        },
        response: {
          body,
          bodyEncoding: "utf8",
          meta: {
            status: 200,
            statusText: "OK",
            headers: [
              { name: "Content-Type", value: "application/json" },
              { name: "X-Trace", value: "server" }
            ],
            mimeType: "application/json",
            resourceType: "XHR",
            url: descriptor.requestUrl,
            method: descriptor.method,
            capturedAt: "2026-04-08T00:00:00.000Z",
            bodyEncoding: "utf8",
            bodySuggestedExtension: "json"
          }
        }
      });
      const harness = createServerBackedLifecycleHarness({ serverClient, siteConfig });

      await harness.lifecycle.handleFetchRequestPaused(
        { tabId: 1 },
        createFetchPausedParams({
          requestId: "fetch-live-server-api",
          networkId: "network-live-server-api",
          request: {
            method: "GET",
            url: descriptor.requestUrl,
            headers: {
              Accept: "application/json"
            }
          },
          resourceType: "XHR"
        })
      );

      expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
        1,
        "Fetch.fulfillRequest",
        {
          requestId: "fetch-live-server-api",
          responseCode: 200,
          responsePhrase: "OK",
          responseHeaders: [
            { name: "Content-Type", value: "application/json" },
            { name: "X-Trace", value: "server" }
          ],
          body: Buffer.from(body, "utf8").toString("base64")
        }
      );
      expect(harness.state.requests.get("1:network-live-server-api")).toMatchObject({
        replayed: true,
        resourceType: "XHR",
        url: descriptor.requestUrl
      });
    } finally {
      await server.close();
    }
  });
});
