import { promises as fs } from "node:fs";

import { vi } from "vitest";

import { createRequestLifecycle } from "../../src/lib/request-lifecycle.js";
import { createFixtureDescriptor as realCreateFixtureDescriptor } from "../../src/lib/fixture-mapper.js";
import type { SiteConfig } from "../../src/lib/types.js";
import { createWraithWalkerServerClient } from "../../src/lib/wraithwalker-server.js";

export interface LifecycleHarnessOptions {
  siteConfig?: SiteConfig;
  createFixtureDescriptor?: typeof realCreateFixtureDescriptor;
}

export function createServerBackedRepository(
  serverClient: ReturnType<typeof createWraithWalkerServerClient>
) {
  return {
    exists: async (
      descriptor: Awaited<ReturnType<typeof realCreateFixtureDescriptor>>
    ) => (await serverClient.hasFixture(descriptor)).exists,
    read: async (
      descriptor: Awaited<ReturnType<typeof realCreateFixtureDescriptor>>
    ) => {
      const fixture = await serverClient.readFixture(descriptor);
      if (!fixture.exists) {
        return null;
      }

      return {
        request: fixture.request,
        meta: fixture.meta,
        bodyBase64: fixture.bodyBase64,
        size: fixture.size
      };
    },
    writeIfAbsent: (
      payload: Parameters<
        NonNullable<
          Parameters<typeof createRequestLifecycle>[0]["repository"]
        >["writeIfAbsent"]
      >[0]
    ) => serverClient.writeFixtureIfAbsent(payload)
  };
}

export function createServerBackedLifecycleHarness({
  serverClient,
  siteConfig,
  responseBodies = {}
}: {
  serverClient: ReturnType<typeof createWraithWalkerServerClient>;
  siteConfig: SiteConfig;
  responseBodies?: Record<string, { body: string; base64Encoded: boolean }>;
}) {
  const state = {
    sessionActive: true,
    attachedTabs: new Map([[1, { topOrigin: siteConfig.origin }]]),
    requests: new Map<string, any>()
  };
  const sendDebuggerCommandMock = vi.fn(
    async (
      _tabId: number,
      method: string,
      params?: Record<string, unknown>
    ) => {
      if (method === "Network.getResponseBody") {
        const requestId = String(params?.requestId ?? "");
        return responseBodies[requestId] ?? { body: "", base64Encoded: false };
      }
      return { method, params };
    }
  );
  const sendDebuggerCommand: Parameters<
    typeof createRequestLifecycle
  >[0]["sendDebuggerCommand"] = (tabId, method, params) =>
    sendDebuggerCommandMock(tabId, method, params) as Promise<any>;
  const lifecycle = createRequestLifecycle({
    state,
    sendDebuggerCommand,
    sendOffscreenMessage: vi.fn(async () => ({ ok: true })) as Parameters<
      typeof createRequestLifecycle
    >[0]["sendOffscreenMessage"],
    setLastError: vi.fn(),
    repository: createServerBackedRepository(serverClient),
    createFixtureDescriptor: realCreateFixtureDescriptor,
    getSiteConfigForOrigin: vi.fn((topOrigin) =>
      topOrigin === siteConfig.origin ? siteConfig : undefined
    )
  });

  return {
    state,
    lifecycle,
    sendDebuggerCommand: sendDebuggerCommandMock
  };
}

export function createLifecycleHarness({
  siteConfig,
  createFixtureDescriptor
}: LifecycleHarnessOptions = {}) {
  const state = {
    sessionActive: true,
    attachedTabs: new Map([[1, { topOrigin: "https://app.example.com" }]]),
    requests: new Map<string, any>()
  };

  const sendDebuggerCommandMock = vi.fn(
    async (
      _tabId: number,
      method: string,
      params?: Record<string, unknown>
    ) => {
      if (method === "Network.getRequestPostData") {
        return { postData: '{"seed":"one"}', base64Encoded: false };
      }
      if (method === "Network.getResponseBody") {
        return { body: '{"ok":true}', base64Encoded: false };
      }
      return { method, params };
    }
  );
  const sendDebuggerCommand: Parameters<
    typeof createRequestLifecycle
  >[0]["sendDebuggerCommand"] = (tabId, method, params) =>
    sendDebuggerCommandMock(tabId, method, params) as Promise<any>;
  const sendOffscreenMessageMock = vi.fn(
    async (type: string, _payload?: Record<string, unknown>) => {
      if (type === "fs.hasFixture") {
        return { ok: true, exists: false };
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
    }
  );
  const sendOffscreenMessage: Parameters<
    typeof createRequestLifecycle
  >[0]["sendOffscreenMessage"] = (type, payload) =>
    sendOffscreenMessageMock(type, payload) as Promise<any>;
  const setLastError = vi.fn();
  const fixtureDescriptorFactory =
    createFixtureDescriptor ||
    vi.fn(
      async ({ method, url }) =>
        ({
          method,
          requestUrl: url,
          bodyPath: "body",
          requestPath: "request.json",
          metaPath: "response.meta.json",
          topOrigin: "https://app.example.com",
          topOriginKey: "https__app.example.com",
          requestOrigin: "https://cdn.example.com",
          requestOriginKey: "https__cdn.example.com",
          postDataEncoding: "utf8",
          queryHash: "",
          bodyHash: "",
          manifestPath: null,
          metadataOptional: false,
          slug: "body",
          assetLike: true,
          storageMode: "asset"
        }) as any
    );

  const lifecycle = createRequestLifecycle({
    state,
    sendDebuggerCommand,
    sendOffscreenMessage,
    setLastError,
    createFixtureDescriptor: fixtureDescriptorFactory,
    getSiteConfigForOrigin: siteConfig
      ? vi.fn((topOrigin) =>
          topOrigin === "https://app.example.com" ? siteConfig : undefined
        )
      : undefined
  });

  return {
    state,
    lifecycle,
    sendDebuggerCommand: sendDebuggerCommandMock,
    sendOffscreenMessage: sendOffscreenMessageMock,
    setLastError,
    createFixtureDescriptor: fixtureDescriptorFactory
  };
}

export async function createTempOverridesDir(
  prefix = "wraithwalker-extension-overrides-"
): Promise<string> {
  return fs.mkdtemp(`/tmp/${prefix}`);
}

export async function writeOverrideFile(
  root: string,
  relativePath: string,
  content: string | Uint8Array
): Promise<void> {
  const filePath = `${root}/${relativePath}`;
  await fs.mkdir(filePath.slice(0, Math.max(0, filePath.lastIndexOf("/"))), {
    recursive: true
  });
  await fs.writeFile(filePath, content);
}

export function createFetchPausedParams(
  overrides: { request?: Record<string, unknown> } & Record<
    string,
    unknown
  > = {}
) {
  const { request: requestOverrides = {}, ...restOverrides } = overrides;
  const baseRequest = {
    method: "GET",
    url: "https://cdn.example.com/app.js",
    headers: {}
  };

  return {
    requestId: "fetch-1",
    networkId: "network-1",
    request: {
      ...baseRequest,
      ...requestOverrides
    },
    resourceType: "Script",
    ...restOverrides
  };
}
