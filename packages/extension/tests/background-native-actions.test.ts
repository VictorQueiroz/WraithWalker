import { describe, expect, it, vi } from "vitest";

import { createBackgroundNativeActions } from "../src/lib/background-native-actions.js";
import type { BackgroundAuthorityApi } from "../src/lib/background-authority.js";
import { getRequiredRootId } from "../src/lib/background-authority.js";
import { createBackgroundState, createChromeApi, createMockServerClient } from "./helpers/background-service-test-helpers.js";

function createAuthorityStub(
  overrides: Partial<Pick<
    BackgroundAuthorityApi,
    "refreshStoredConfig" | "refreshServerInfo" | "ensureLocalRootReady" | "sendOffscreenMessage" | "withServerFallback"
  >> = {}
): Pick<
  BackgroundAuthorityApi,
  "refreshStoredConfig" | "refreshServerInfo" | "ensureLocalRootReady" | "sendOffscreenMessage" | "withServerFallback"
> {
  return {
    refreshStoredConfig: vi.fn().mockResolvedValue(undefined),
    refreshServerInfo: vi.fn().mockResolvedValue(null),
    ensureLocalRootReady: vi.fn().mockResolvedValue({
      ok: true,
      sentinel: { rootId: "local-root" },
      permission: "granted"
    }),
    sendOffscreenMessage: vi.fn().mockResolvedValue({ ok: true }),
    withServerFallback: vi.fn(
      async <T>({ localOperation }: {
        remoteOperation: (info: any) => Promise<T>;
        localOperation: () => Promise<T>;
      }) => localOperation()
    ) as BackgroundAuthorityApi["withServerFallback"],
    ...overrides
  };
}

function createNativeHarness({
  stateOverrides = {},
  chromeApi = createChromeApi(),
  authorityOverrides = {},
  serverClientOverrides = {}
}: {
  stateOverrides?: Record<string, unknown>;
  chromeApi?: ReturnType<typeof createChromeApi>;
  authorityOverrides?: Record<string, unknown>;
  serverClientOverrides?: Record<string, unknown>;
} = {}) {
  const state = createBackgroundState(stateOverrides as Parameters<typeof createBackgroundState>[0]);
  const authority = createAuthorityStub(authorityOverrides);
  const serverClient = createMockServerClient(serverClientOverrides as Parameters<typeof createMockServerClient>[0]);
  const nativeActions = createBackgroundNativeActions({
    state,
    chromeApi,
    serverClient,
    authority,
    getRequiredRootId
  });

  return {
    state,
    chromeApi,
    authority,
    serverClient,
    nativeActions
  };
}

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

  it("returns root-id validation errors for server and explicit root targets", async () => {
    const serverHarness = createNativeHarness({
      authorityOverrides: {
        refreshServerInfo: vi.fn().mockResolvedValue({
          rootPath: "/tmp/server-root",
          sentinel: {},
          baseUrl: "http://127.0.0.1:4319",
          mcpUrl: "http://127.0.0.1:4319/mcp",
          trpcUrl: "http://127.0.0.1:4319/trpc"
        })
      }
    });

    await expect(serverHarness.nativeActions.openDirectoryInEditor(undefined, "vscode")).resolves.toEqual({
      ok: false,
      error: "Root sentinel is missing a rootId."
    });

    const localHarness = createNativeHarness({
      stateOverrides: {
        nativeHostConfig: {
          hostName: "com.wraithwalker.host",
          launchPath: "/tmp/local-root",
          editorLaunchOverrides: {}
        }
      }
    });

    await expect(localHarness.nativeActions.verifyNativeHostRoot({
      rootResult: {
        ok: true,
        sentinel: {} as any,
        permission: "granted"
      }
    })).resolves.toEqual({
      ok: false,
      error: "Root sentinel is missing a rootId."
    });
  });

  it("keeps editor launches working when context generation fails and surfaces URL-launch errors", async () => {
    const serverInfo = {
      rootPath: "/tmp/server-root",
      sentinel: { rootId: "server-root" },
      baseUrl: "http://127.0.0.1:4319",
      mcpUrl: "http://127.0.0.1:4319/mcp",
      trpcUrl: "http://127.0.0.1:4319/trpc"
    };
    const successHarness = createNativeHarness({
      stateOverrides: {
        enabledOrigins: ["https://app.example.com"]
      },
      authorityOverrides: {
        refreshServerInfo: vi.fn().mockResolvedValue(serverInfo),
        withServerFallback: vi.fn().mockRejectedValue(new Error("context offline"))
      }
    });

    await expect(successHarness.nativeActions.openDirectoryInEditor(undefined, "cursor")).resolves.toEqual({ ok: true });
    expect(successHarness.chromeApi.tabs.create).toHaveBeenCalledWith({
      url: "cursor://file//tmp/server-root/"
    });

    const failureChromeApi = createChromeApi();
    failureChromeApi.tabs.create.mockRejectedValue("tab creation blocked");
    const failureHarness = createNativeHarness({
      chromeApi: failureChromeApi,
      stateOverrides: {
        enabledOrigins: ["https://app.example.com"]
      },
      authorityOverrides: {
        refreshServerInfo: vi.fn().mockResolvedValue(serverInfo)
      }
    });

    await expect(failureHarness.nativeActions.openDirectoryInEditor(undefined, "cursor")).resolves.toEqual({
      ok: false,
      error: "tab creation blocked"
    });
  });

  it("returns editor-launch guidance when a URL editor has no remembered local root", async () => {
    const { nativeActions } = createNativeHarness({
      stateOverrides: {
        nativeHostConfig: {
          hostName: "com.wraithwalker.host",
          launchPath: "",
          editorLaunchOverrides: {}
        }
      },
      authorityOverrides: {
        refreshServerInfo: vi.fn().mockResolvedValue(null),
        ensureLocalRootReady: vi.fn().mockResolvedValue({
          ok: true,
          sentinel: { rootId: "local-root" },
          permission: "granted"
        })
      }
    });

    await expect(nativeActions.openDirectoryInEditor(undefined, "vscode")).resolves.toEqual({
      ok: false,
      error: "Set the absolute editor launch path in Settings to open the remembered root in VS Code. Chrome does not expose local folder paths from the directory picker."
    });
  });

  it("surfaces launch-path validation and native verification failures", async () => {
    const missingPathHarness = createNativeHarness({
      stateOverrides: {
        nativeHostConfig: {
          hostName: "com.wraithwalker.host",
          launchPath: "",
          editorLaunchOverrides: {}
        }
      }
    });

    await expect(missingPathHarness.nativeActions.verifyNativeHostRoot({
      rootResult: {
        ok: true,
        sentinel: { rootId: "local-root" },
        permission: "granted"
      }
    })).resolves.toEqual({
      ok: false,
      error: "Configure the shared editor launch path in the options page first."
    });

    const rejectedChromeApi = createChromeApi();
    rejectedChromeApi.runtime.sendNativeMessage.mockResolvedValue({
      ok: false,
      error: "native root mismatch"
    });
    const rejectedHarness = createNativeHarness({
      chromeApi: rejectedChromeApi,
      stateOverrides: {
        nativeHostConfig: {
          hostName: "com.wraithwalker.host",
          launchPath: "/tmp/local-root",
          editorLaunchOverrides: {}
        }
      }
    });

    await expect(rejectedHarness.nativeActions.verifyNativeHostRoot({
      rootResult: {
        ok: true,
        sentinel: { rootId: "local-root" },
        permission: "granted"
      }
    })).resolves.toEqual({
      ok: false,
      error: "native root mismatch"
    });
  });

  it("surfaces native open and local reveal failures", async () => {
    const chromeApi = createChromeApi();
    chromeApi.runtime.sendNativeMessage.mockImplementation(async (_hostName, message) => {
      if (message.type === "verifyRoot") {
        return { ok: true };
      }
      if (message.type === "openDirectory") {
        return { ok: false, error: "open failed" };
      }
      if (message.type === "revealDirectory") {
        throw "native reveal unavailable";
      }
      return { ok: true };
    });
    const harness = createNativeHarness({
      chromeApi,
      stateOverrides: {
        nativeHostConfig: {
          hostName: "com.wraithwalker.host",
          launchPath: "/tmp/local-root",
          editorLaunchOverrides: {}
        },
        rootSentinel: { rootId: "local-root" }
      },
      authorityOverrides: {
        refreshServerInfo: vi.fn().mockResolvedValue(null),
        ensureLocalRootReady: vi.fn().mockResolvedValue({
          ok: true,
          sentinel: { rootId: "local-root" },
          permission: "granted"
        })
      }
    });

    await expect(harness.nativeActions.openDirectoryInEditor(undefined, "antigravity")).resolves.toEqual({
      ok: false,
      error: "open failed"
    });
    await expect(harness.nativeActions.revealRootInOs()).resolves.toEqual({
      ok: false,
      error: "native reveal unavailable"
    });
  });

  it("returns launch-target errors before opening non-URL editors", async () => {
    const { nativeActions } = createNativeHarness({
      stateOverrides: {
        nativeHostConfig: {
          hostName: "com.wraithwalker.host",
          launchPath: "/tmp/local-root",
          editorLaunchOverrides: {}
        }
      },
      authorityOverrides: {
        refreshServerInfo: vi.fn().mockResolvedValue(null),
        ensureLocalRootReady: vi.fn().mockResolvedValue({
          ok: false,
          error: "Permission denied."
        })
      }
    });

    await expect(nativeActions.openDirectoryInEditor(undefined, "antigravity")).resolves.toEqual({
      ok: false,
      error: "Permission denied."
    });
  });

  it("surfaces server-backed action failures", async () => {
    const serverInfo = {
      rootPath: "/tmp/server-root",
      sentinel: { rootId: "server-root" },
      baseUrl: "http://127.0.0.1:4319",
      mcpUrl: "http://127.0.0.1:4319/mcp",
      trpcUrl: "http://127.0.0.1:4319/trpc"
    };
    const harness = createNativeHarness({
      authorityOverrides: {
        refreshServerInfo: vi.fn().mockResolvedValue(serverInfo)
      },
      serverClientOverrides: {
        revealRoot: vi.fn().mockRejectedValue(new Error("server reveal failed")),
        listScenarios: vi.fn().mockRejectedValue(new Error("server list failed")),
        saveScenario: vi.fn().mockRejectedValue(new Error("server save failed")),
        switchScenario: vi.fn().mockRejectedValue(new Error("server switch failed"))
      }
    });

    await expect(harness.nativeActions.revealRootInOs()).resolves.toEqual({
      ok: false,
      error: "server reveal failed"
    });
    await expect(harness.nativeActions.listScenariosForActiveTarget()).resolves.toEqual({
      ok: false,
      error: "server list failed"
    });
    await expect(harness.nativeActions.saveScenarioForActiveTarget("smoke")).resolves.toEqual({
      ok: false,
      error: "server save failed"
    });
    await expect(harness.nativeActions.switchScenarioForActiveTarget("smoke")).resolves.toEqual({
      ok: false,
      error: "server switch failed"
    });
  });

  it("rejects local scenario operations when the native host is not configured", async () => {
    const { nativeActions } = createNativeHarness({
      stateOverrides: {
        localRootReady: true,
        localRootSentinel: { rootId: "local-root" },
        nativeHostConfig: {
          hostName: "",
          launchPath: "/tmp/local-root",
          editorLaunchOverrides: {}
        }
      },
      authorityOverrides: {
        refreshServerInfo: vi.fn().mockResolvedValue(null)
      }
    });

    await expect(nativeActions.listScenariosForActiveTarget()).resolves.toEqual({
      ok: false,
      error: "Configure the native host name and shared editor launch path in the options page first."
    });
    await expect(nativeActions.saveScenarioForActiveTarget("smoke")).resolves.toEqual({
      ok: false,
      error: "Configure the native host name and shared editor launch path in the options page first."
    });
    await expect(nativeActions.switchScenarioForActiveTarget("smoke")).resolves.toEqual({
      ok: false,
      error: "Configure the native host name and shared editor launch path in the options page first."
    });
  });
});
