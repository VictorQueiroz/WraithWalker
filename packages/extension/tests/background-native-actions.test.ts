import { describe, expect, it, vi } from "vitest";

import { createBackgroundNativeActions } from "../src/lib/background-native-actions.js";
import { getRequiredRootId } from "../src/lib/background-authority.js";
import { createBackgroundState, createChromeApi, createMockServerClient } from "./helpers/background-service-test-helpers.js";

describe("background native actions", () => {
  it("opens the server root through the editor URL when a server capture root is active", async () => {
    const chromeApi = createChromeApi();
    const state = createBackgroundState({
      enabledOrigins: ["https://app.example.com"]
    });
    const serverInfo = {
      rootPath: "/tmp/server-root",
      sentinel: { rootId: "server-root" },
      baseUrl: "http://127.0.0.1:4319",
      mcpUrl: "http://127.0.0.1:4319/mcp",
      trpcUrl: "http://127.0.0.1:4319/trpc"
    };

    const nativeActions = createBackgroundNativeActions({
      state,
      chromeApi,
      serverClient: createMockServerClient(),
      authority: {
        refreshStoredConfig: vi.fn().mockResolvedValue(undefined),
        refreshServerInfo: vi.fn().mockResolvedValue(serverInfo),
        ensureLocalRootReady: vi.fn().mockResolvedValue({ ok: true, sentinel: { rootId: "local-root" }, permission: "granted" }),
        sendOffscreenMessage: vi.fn().mockResolvedValue({ ok: true }),
        withServerFallback: vi.fn(async ({ remoteOperation }) => remoteOperation(serverInfo))
      },
      getRequiredRootId
    });

    const result = await nativeActions.openDirectoryInEditor(undefined, "cursor");

    expect(result).toEqual({ ok: true });
    expect(chromeApi.tabs.create).toHaveBeenCalledWith({
      url: "cursor://file//tmp/server-root/"
    });
    expect(chromeApi.runtime.sendNativeMessage).not.toHaveBeenCalled();
  });

  it("reveals the active server root through the server client when connected", async () => {
    const serverClient = createMockServerClient();
    const serverInfo = {
      rootPath: "/tmp/server-root",
      sentinel: { rootId: "server-root" },
      baseUrl: "http://127.0.0.1:4319",
      mcpUrl: "http://127.0.0.1:4319/mcp",
      trpcUrl: "http://127.0.0.1:4319/trpc"
    };
    const nativeActions = createBackgroundNativeActions({
      state: createBackgroundState(),
      chromeApi: createChromeApi(),
      serverClient,
      authority: {
        refreshStoredConfig: vi.fn().mockResolvedValue(undefined),
        refreshServerInfo: vi.fn().mockResolvedValue(serverInfo),
        ensureLocalRootReady: vi.fn().mockResolvedValue({ ok: true, sentinel: { rootId: "local-root" }, permission: "granted" }),
        sendOffscreenMessage: vi.fn().mockResolvedValue({ ok: true }),
        withServerFallback: vi.fn(async ({ remoteOperation }) => remoteOperation(serverInfo))
      },
      getRequiredRootId
    });

    const result = await nativeActions.revealRootInOs();

    expect(result).toEqual({ ok: true });
    expect(serverClient.revealRoot).toHaveBeenCalled();
  });

  it("routes scenario actions through the native host when only a local root is available", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendNativeMessage.mockResolvedValue({ ok: true, name: "smoke" });
    const state = createBackgroundState({
      localRootReady: true,
      localRootSentinel: { rootId: "local-root" },
      nativeHostConfig: {
        hostName: "com.wraithwalker.host",
        launchPath: "/tmp/local-root",
        editorLaunchOverrides: {}
      }
    });

    const nativeActions = createBackgroundNativeActions({
      state,
      chromeApi,
      serverClient: createMockServerClient(),
      authority: {
        refreshStoredConfig: vi.fn().mockResolvedValue(undefined),
        refreshServerInfo: vi.fn().mockResolvedValue(null),
        ensureLocalRootReady: vi.fn().mockResolvedValue({ ok: true, sentinel: { rootId: "local-root" }, permission: "granted" }),
        sendOffscreenMessage: vi.fn().mockResolvedValue({ ok: true }),
        withServerFallback: vi.fn(async ({ localOperation }) => localOperation())
      },
      getRequiredRootId
    });

    const result = await nativeActions.saveScenarioForActiveTarget("smoke");

    expect(result).toEqual({ ok: true, name: "smoke" });
    expect(chromeApi.runtime.sendNativeMessage).toHaveBeenCalledWith("com.wraithwalker.host", {
      type: "saveScenario",
      path: "/tmp/local-root",
      expectedRootId: "local-root",
      name: "smoke"
    });
  });
});
