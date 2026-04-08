// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { DEFAULT_DUMP_ALLOWLIST_PATTERNS, DEFAULT_NATIVE_HOST_CONFIG, ROOT_DIRECTORY_PICKER_ID } from "../src/lib/constants.js";
import type { NativeHostConfig, SessionSnapshot, SiteConfig } from "../src/lib/types.js";
import { createWraithWalkerServerClient } from "../src/lib/wraithwalker-server.js";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

function renderRoot() {
  document.body.innerHTML = "<div id=\"root\"></div>";
}

function createWindowWithDirectoryPicker(
  showDirectoryPicker: (options?: { mode?: "read" | "readwrite"; id?: string; startIn?: FileSystemDirectoryHandle }) => Promise<FileSystemDirectoryHandle>
): Window {
  const windowRef = window as Window & {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; id?: string; startIn?: FileSystemDirectoryHandle }) => Promise<unknown>;
  };
  windowRef.showDirectoryPicker = showDirectoryPicker;
  return windowRef;
}

function createStoredSite(overrides: Partial<SiteConfig> = {}): SiteConfig {
  return {
    origin: "https://app.example.com",
    createdAt: "2026-04-03T00:00:00.000Z",
    dumpAllowlistPatterns: [...DEFAULT_DUMP_ALLOWLIST_PATTERNS],
    ...overrides
  };
}

function createNativeHostConfig(overrides: Partial<NativeHostConfig> = {}): NativeHostConfig {
  return {
    ...DEFAULT_NATIVE_HOST_CONFIG,
    ...overrides,
    editorLaunchOverrides: {
      ...DEFAULT_NATIVE_HOST_CONFIG.editorLaunchOverrides,
      ...overrides.editorLaunchOverrides
    }
  };
}

async function loadOptionsModule() {
  vi.resetModules();
  globalThis.__WRAITHWALKER_TEST__ = true;
  return import("../src/options.ts");
}

async function loadRootConfigModule() {
  globalThis.__WRAITHWALKER_TEST__ = true;
  return import("../src/lib/root-config.ts");
}

async function loadOptionsModuleOutsideTestMode() {
  vi.resetModules();
  delete globalThis.__WRAITHWALKER_TEST__;
  return import("../src/options.ts");
}

function createRuntimeSendMessage({
  sessionSnapshot
}: {
  sessionSnapshot?: SessionSnapshot;
} = {}) {
  return vi.fn(async (message: { type: string; name?: string }) => {
    switch (message.type) {
      case "session.getState":
        return sessionSnapshot ?? {
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: [],
          rootReady: false,
          captureDestination: "none",
          captureRootPath: "",
          lastError: ""
        };
      case "scenario.list":
        return { ok: true, scenarios: ["baseline"] };
      case "scenario.switch":
        return { ok: true, name: message.name ?? "" };
      case "scenario.save":
        return { ok: true, name: message.name ?? "" };
      case "native.verify":
        return { ok: true, verifiedAt: "2026-04-03T12:00:00.000Z" };
      default:
        return { ok: true };
    }
  });
}

function createLiveServerRuntimeApi({
  sessionSnapshot,
  serverClient
}: {
  sessionSnapshot: SessionSnapshot;
  serverClient: ReturnType<typeof createWraithWalkerServerClient>;
}) {
  return {
    sendMessage: vi.fn(async (message: { type: string; siteConfigs?: SiteConfig[]; name?: string }) => {
      switch (message.type) {
        case "session.getState":
          return sessionSnapshot;
        case "config.readConfiguredSiteConfigs": {
          const result = await serverClient.readConfiguredSiteConfigs();
          return {
            ok: true,
            siteConfigs: result.siteConfigs,
            sentinel: result.sentinel
          };
        }
        case "config.readEffectiveSiteConfigs": {
          const result = await serverClient.readEffectiveSiteConfigs();
          return {
            ok: true,
            siteConfigs: result.siteConfigs,
            sentinel: result.sentinel
          };
        }
        case "config.writeConfiguredSiteConfigs": {
          const result = await serverClient.writeConfiguredSiteConfigs(message.siteConfigs ?? []);
          return {
            ok: true,
            siteConfigs: result.siteConfigs,
            sentinel: result.sentinel
          };
        }
        case "scenario.list":
          return { ok: true, scenarios: ["baseline"] };
        case "scenario.switch":
          return { ok: true, name: message.name ?? "" };
        case "scenario.save":
          return { ok: true, name: message.name ?? "" };
        case "native.verify":
          return { ok: true, verifiedAt: "2026-04-03T12:00:00.000Z" };
        default:
          return { ok: true };
      }
    })
  };
}

function createLiveServerClient(serverUrl: string) {
  return createWraithWalkerServerClient(serverUrl, {
    timeoutMs: 2_000,
    fetchImpl: (input, init) => fetch(input, {
      ...init,
      signal: undefined
    })
  });
}

async function startExternalHttpServer(rootPath: string) {
  const candidatePaths = [
    path.resolve(process.cwd(), "packages/mcp-server/src/server.mts"),
    path.resolve(process.cwd(), "../mcp-server/src/server.mts")
  ];
  const serverModulePath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
  if (!serverModulePath) {
    throw new Error(`Unable to locate mcp-server entrypoint from ${process.cwd()}.`);
  }

  const serverModuleUrl = pathToFileURL(serverModulePath).href;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "-e",
      `
        const { startHttpServer } = await import(${JSON.stringify(serverModuleUrl)});
        const server = await startHttpServer(${JSON.stringify(rootPath)}, { host: "127.0.0.1", port: 0 });
        console.log(JSON.stringify({ trpcUrl: server.trpcUrl, rootPath: server.rootPath }));
        const shutdown = async () => {
          try {
            await server.close();
          } finally {
            process.exit(0);
          }
        };
        process.on("SIGTERM", shutdown);
        process.on("SIGINT", shutdown);
        setInterval(() => {}, 1 << 30);
      `
    ],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const started = await new Promise<{ trpcUrl: string; rootPath: string }>((resolve, reject) => {
    const onExit = (code: number | null) => {
      reject(new Error(`External test server exited before startup (${code ?? "signal"}): ${stderr || stdout}`));
    };

    child.once("exit", onExit);
    const poll = () => {
      const lineBreakIndex = stdout.indexOf("\n");
      if (lineBreakIndex === -1) {
        setTimeout(poll, 10);
        return;
      }

      child.off("exit", onExit);
      try {
        resolve(JSON.parse(stdout.slice(0, lineBreakIndex)));
      } catch (error) {
        reject(error);
      }
    };

    poll();
  });

  return {
    ...started,
    async close() {
      if (child.exitCode !== null || child.killed) {
        return;
      }

      child.kill("SIGTERM");
      await once(child, "exit");
    }
  };
}

function createReadyRootDeps() {
  const rootHandle = { kind: "directory" } as FileSystemDirectoryHandle;

  return {
    rootHandle,
    loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
    queryRootPermission: vi.fn().mockResolvedValue("granted"),
    requestRootPermission: vi.fn().mockResolvedValue("granted"),
    ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-ready" }),
    storeRootHandleWithSentinel: vi.fn().mockResolvedValue({ rootId: "root-ready" })
  };
}

afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  delete globalThis.__WRAITHWALKER_TEST__;
  delete globalThis.chrome;
  vi.doUnmock("../src/lib/chrome-storage.js");
  vi.doUnmock("../src/lib/root-handle.js");
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("options entrypoint", () => {
  it("throws when the options root container is missing", async () => {
    document.body.innerHTML = "";
    const { initOptions } = await loadOptionsModule();

    await expect(initOptions({
      document,
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: vi.fn()
        }
      }
    })).rejects.toThrow("Options root container not found.");
  });

  it("renders stored sites and updates or removes them", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    let sites = [createStoredSite()];
    const setSiteConfigs = vi.fn(async (nextSites: SiteConfig[]) => {
      sites = nextSites;
    });
    const readyRoot = createReadyRootDeps();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn().mockResolvedValue(true),
          remove: vi.fn().mockResolvedValue(true)
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn(async () => [...sites]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      ...readyRoot,
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      expect(await screen.findByText("Enabled Origins")).toBeTruthy();
      expect(await screen.findByText("https://app.example.com")).toBeTruthy();

      const patterns = await screen.findByLabelText("Dump Allowlist Patterns");
      await user.clear(patterns);
      await user.type(patterns, "\\.json$");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(setSiteConfigs).toHaveBeenCalledWith([
        expect.objectContaining({
          origin: "https://app.example.com",
          dumpAllowlistPatterns: ["\\.json$"]
        })
      ]);
      expect(await screen.findByText("Updated https://app.example.com.")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Remove" }));
      expect(setSiteConfigs).toHaveBeenLastCalledWith([]);
      expect(await screen.findByText("Removed https://app.example.com.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("shows a validation error for invalid dump allowlist patterns", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const setSiteConfigs = vi.fn();
    const readyRoot = createReadyRootDeps();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn().mockResolvedValue(true),
          remove: vi.fn().mockResolvedValue(true)
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([createStoredSite()]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      ...readyRoot,
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      const patterns = await screen.findByLabelText("Dump Allowlist Patterns");
      fireEvent.change(patterns, { target: { value: "[" } });
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(setSiteConfigs).not.toHaveBeenCalled();
      expect(await screen.findByText("One or more dump allowlist patterns are invalid.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("falls back to the shared default dump patterns when a site is saved with an empty allowlist", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    let sites = [createStoredSite({
      dumpAllowlistPatterns: ["\\.svg$"]
    })];
    const setSiteConfigs = vi.fn(async (nextSites: SiteConfig[]) => {
      sites = nextSites;
    });
    const readyRoot = createReadyRootDeps();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn().mockResolvedValue(true),
          remove: vi.fn().mockResolvedValue(true)
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn(async () => [...sites]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      ...readyRoot,
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      const patterns = await screen.findByLabelText("Dump Allowlist Patterns");
      await user.clear(patterns);
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(setSiteConfigs).toHaveBeenCalledWith([
        expect.objectContaining({
          origin: "https://app.example.com",
          dumpAllowlistPatterns: DEFAULT_DUMP_ALLOWLIST_PATTERNS
        })
      ]);
      expect(await screen.findByText("Updated https://app.example.com.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("adds an origin after host permission is granted", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    let sites: SiteConfig[] = [];
    const setSiteConfigs = vi.fn(async (nextSites: SiteConfig[]) => {
      sites = nextSites;
    });
    const permissions = {
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn()
    };
    const readyRoot = createReadyRootDeps();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions,
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn(async () => [...sites]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      ...readyRoot,
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await screen.findByText(/WraithWalker root access is ready\./);
      await user.type(await screen.findByLabelText("Exact origin"), "app.example.com");
      await user.click(screen.getByRole("button", { name: "Add Origin" }));

      expect(permissions.request).toHaveBeenCalledWith({ origins: ["https://app.example.com/*"] });
      expect(setSiteConfigs).toHaveBeenCalledWith([
        expect.objectContaining({
          origin: "https://app.example.com",
          dumpAllowlistPatterns: [...DEFAULT_DUMP_ALLOWLIST_PATTERNS, "\\.json$"]
        })
      ]);
      expect(await screen.findByText("Origin added and host access granted.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("uses the connected server root for config editing even without a local root", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    let sites: SiteConfig[] = [];
    const setSiteConfigs = vi.fn(async (nextSites: SiteConfig[]) => {
      sites = nextSites;
    });
    const permissions = {
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true)
    };

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions,
        runtime: {
          sendMessage: createRuntimeSendMessage({
            sessionSnapshot: {
              sessionActive: false,
              attachedTabIds: [],
              enabledOrigins: ["https://app.example.com"],
              rootReady: true,
              captureDestination: "server",
              captureRootPath: "/tmp/server-root",
              lastError: ""
            }
          })
        }
      },
      getSiteConfigs: vi.fn(async () => [...sites]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      expect(await screen.findByText(/Settings changes are using \/tmp\/server-root\./)).toBeTruthy();
      expect(screen.getByText(/Editing \/tmp\/server-root\./)).toBeTruthy();
      expect((screen.getByRole("button", { name: "Add Origin" }) as HTMLButtonElement).disabled).toBe(false);

      await user.type(await screen.findByLabelText("Exact origin"), "app.example.com");
      await user.click(screen.getByRole("button", { name: "Add Origin" }));

      expect(permissions.request).toHaveBeenCalledWith({ origins: ["https://app.example.com/*"] });
      expect(setSiteConfigs).toHaveBeenCalledWith([
        expect.objectContaining({
          origin: "https://app.example.com",
          dumpAllowlistPatterns: [...DEFAULT_DUMP_ALLOWLIST_PATTERNS, "\\.json$"]
        })
      ]);
      expect(await screen.findByText("Origin added and host access granted.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("shows the generic server-root indicator when the capture path is unavailable", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn().mockResolvedValue(true),
          remove: vi.fn().mockResolvedValue(true)
        },
        runtime: {
          sendMessage: createRuntimeSendMessage({
            sessionSnapshot: {
              sessionActive: false,
              attachedTabIds: [],
              enabledOrigins: [],
              rootReady: true,
              captureDestination: "server",
              captureRootPath: "",
              lastError: ""
            }
          })
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      expect(await screen.findByText(/Settings changes are using the server root\./)).toBeTruthy();
      expect(screen.getByText(/Editing the server root\./)).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("writes a Settings-added origin into the live server root config file", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const { getConfiguredSiteConfigs, setConfiguredSiteConfigs } = await loadRootConfigModule();
    const user = userEvent.setup();
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-options-live-server-config-"
    });
    const server = await startExternalHttpServer(serverRoot.rootPath);
    const serverClient = createLiveServerClient(server.trpcUrl);
    const sessionSnapshot: SessionSnapshot = {
      sessionActive: false,
      attachedTabIds: [],
      enabledOrigins: [],
      rootReady: true,
      captureDestination: "server",
      captureRootPath: serverRoot.rootPath,
      lastError: ""
    };
    const runtimeApi = createLiveServerRuntimeApi({
      sessionSnapshot,
      serverClient
    });
    const permissions = {
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true)
    };

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions,
        runtime: runtimeApi
      },
      getSiteConfigs: () => getConfiguredSiteConfigs(runtimeApi),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: (siteConfigs) => setConfiguredSiteConfigs(siteConfigs, runtimeApi),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      const escapedRootPath = serverRoot.rootPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      await screen.findByText(new RegExp(`Editing ${escapedRootPath}\\.`));
      await user.type(await screen.findByLabelText("Exact origin"), "app.example.com");
      await user.click(screen.getByRole("button", { name: "Add Origin" }));

      expect(permissions.request).toHaveBeenCalledWith({ origins: ["https://app.example.com/*"] });
      const writeCallIndex = runtimeApi.sendMessage.mock.calls.findIndex(
        ([message]) => message.type === "config.writeConfiguredSiteConfigs"
      );
      expect(writeCallIndex).toBeGreaterThan(-1);
      expect(permissions.request.mock.invocationCallOrder[0]).toBeLessThan(
        runtimeApi.sendMessage.mock.invocationCallOrder[writeCallIndex]
      );
      expect(await screen.findByText("Origin added and host access granted.")).toBeTruthy();

      const config = await serverRoot.readJson<{
        schemaVersion: number;
        sites: Array<{
          origin: string;
          createdAt: string;
          mode: string;
          dumpAllowlistPatterns: string[];
        }>;
      }>(serverRoot.projectConfigRelativePath());

      expect(config).toEqual({
        schemaVersion: 1,
        sites: [{
          origin: "https://app.example.com",
          createdAt: expect.any(String),
          dumpAllowlistPatterns: [...DEFAULT_DUMP_ALLOWLIST_PATTERNS, "\\.json$"]
        }]
      });
    } finally {
      options.unmount();
      await server.close();
    }
  });

  it("writes updates for an existing server-backed origin into the live server root config file", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const { getConfiguredSiteConfigs, setConfiguredSiteConfigs } = await loadRootConfigModule();
    const user = userEvent.setup();
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-options-live-server-update-"
    });
    await serverRoot.writeProjectConfig({
      schemaVersion: 1,
      sites: [{
        origin: "https://app.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }]
    });
    const server = await startExternalHttpServer(serverRoot.rootPath);
    const serverClient = createLiveServerClient(server.trpcUrl);
    const runtimeApi = createLiveServerRuntimeApi({
      sessionSnapshot: {
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: ["https://app.example.com"],
        rootReady: true,
        captureDestination: "server",
        captureRootPath: serverRoot.rootPath,
        lastError: ""
      },
      serverClient
    });

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn().mockResolvedValue(true),
          remove: vi.fn().mockResolvedValue(true)
        },
        runtime: runtimeApi
      },
      getSiteConfigs: () => getConfiguredSiteConfigs(runtimeApi),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: (siteConfigs) => setConfiguredSiteConfigs(siteConfigs, runtimeApi),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await screen.findByText("https://app.example.com");
      const patterns = await screen.findByLabelText("Dump Allowlist Patterns");
      await user.clear(patterns);
      await user.type(patterns, "\\.css$\n\\.json$");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByText("Updated https://app.example.com.")).toBeTruthy();
      expect(await serverRoot.readJson(serverRoot.projectConfigRelativePath())).toEqual({
        schemaVersion: 1,
        sites: [{
          origin: "https://app.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.css$", "\\.json$"]
        }]
      });
    } finally {
      options.unmount();
      await server.close();
    }
  });

  it("keeps origin editing blocked without a local root when the server is disconnected", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const setSiteConfigs = vi.fn();
    const permissions = {
      request: vi.fn(),
      remove: vi.fn()
    };

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions,
        runtime: {
          sendMessage: createRuntimeSendMessage({
            sessionSnapshot: {
              sessionActive: false,
              attachedTabIds: [],
              enabledOrigins: [],
              rootReady: false,
              captureDestination: "none",
              captureRootPath: "",
              lastError: ""
            }
          })
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      expect(await screen.findByText(/No WraithWalker root directory is connected yet/i)).toBeTruthy();
      expect((screen.getByRole("button", { name: "Add Origin" }) as HTMLButtonElement).disabled).toBe(true);

      expect(setSiteConfigs).not.toHaveBeenCalled();
      expect(permissions.request).not.toHaveBeenCalled();
      expect(screen.getByText(/Choose and connect a WraithWalker root directory, or connect the local WraithWalker server/i)).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("removes a server-backed origin even if permission cleanup fails", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    let sites = [createStoredSite()];
    const permissions = {
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockRejectedValue(new Error("cleanup failed"))
    };

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions,
        runtime: {
          sendMessage: createRuntimeSendMessage({
            sessionSnapshot: {
              sessionActive: false,
              attachedTabIds: [],
              enabledOrigins: ["https://app.example.com"],
              rootReady: true,
              captureDestination: "server",
              captureRootPath: "/tmp/server-root",
              lastError: ""
            }
          })
        }
      },
      getSiteConfigs: vi.fn(async () => [...sites]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(async (nextSites: SiteConfig[]) => {
        sites = nextSites;
      }),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await screen.findByText("https://app.example.com");
      await user.click(screen.getByRole("button", { name: "Remove" }));

      expect(permissions.remove).toHaveBeenCalledWith({ origins: ["https://app.example.com/*"] });
      expect(await screen.findByText("Removed https://app.example.com.")).toBeTruthy();
      expect(sites).toEqual([]);
    } finally {
      options.unmount();
    }
  });

  it("reloads explicit site config from the server root after an external change", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const { getConfiguredSiteConfigs, setConfiguredSiteConfigs } = await loadRootConfigModule();
    const serverRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-options-server-refresh-"
    });
    await serverRoot.writeProjectConfig({
      schemaVersion: 1,
      sites: [{
        origin: "https://before.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.svg$"]
      }]
    });
    const server = await startExternalHttpServer(serverRoot.rootPath);
    const serverClient = createLiveServerClient(server.trpcUrl);
    const runtimeApi = createLiveServerRuntimeApi({
      sessionSnapshot: {
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: ["https://before.example.com"],
        rootReady: true,
        captureDestination: "server",
        captureRootPath: serverRoot.rootPath,
        lastError: ""
      },
      serverClient
    });

    const createOptions = () => initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn().mockResolvedValue(true),
          remove: vi.fn().mockResolvedValue(true)
        },
        runtime: runtimeApi
      },
      getSiteConfigs: () => getConfiguredSiteConfigs(runtimeApi),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: (siteConfigs) => setConfiguredSiteConfigs(siteConfigs, runtimeApi),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    const firstOptions = await createOptions();

    try {
      await screen.findByText("https://before.example.com");
      await serverRoot.writeProjectConfig({
        schemaVersion: 1,
        sites: [{
          origin: "https://after.example.com",
          createdAt: "2026-04-08T12:00:00.000Z",
          dumpAllowlistPatterns: ["\\.json$"]
        }]
      });

      firstOptions.unmount();
      renderRoot();

      const secondOptions = await createOptions();
      try {
        expect(await screen.findByText("https://after.example.com")).toBeTruthy();
        expect(screen.queryByText("https://before.example.com")).toBeNull();
      } finally {
        secondOptions.unmount();
      }
    } finally {
      await server.close();
    }
  });

  it("shows a helpful error when host permission is denied", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const permissions = {
      request: vi.fn().mockResolvedValue(false),
      remove: vi.fn()
    };
    const readyRoot = createReadyRootDeps();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions,
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      ...readyRoot,
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await screen.findByText(/WraithWalker root access is ready\./);
      await user.type(await screen.findByLabelText("Exact origin"), "app.example.com");
      await user.click(screen.getByRole("button", { name: "Add Origin" }));

      expect(permissions.request).toHaveBeenCalledWith({ origins: ["https://app.example.com/*"] });
      expect(await screen.findByText("Host access was not granted for https://app.example.com/*." )).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("surfaces site-save failures without mutating the current site list", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    let sites = [createStoredSite()];
    const setSiteConfigs = vi.fn().mockRejectedValue(new Error("Save failed."));
    const readyRoot = createReadyRootDeps();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn().mockResolvedValue(true),
          remove: vi.fn().mockResolvedValue(true)
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn(async () => [...sites]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      ...readyRoot,
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await screen.findByText("https://app.example.com");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(setSiteConfigs).toHaveBeenCalledTimes(1);
      expect(await screen.findByText("Save failed.")).toBeTruthy();
      expect(sites).toEqual([createStoredSite()]);
    } finally {
      options.unmount();
    }
  });

  it("surfaces site-remove failures before permission cleanup runs", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    let sites = [createStoredSite()];
    const permissions = {
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true)
    };
    const setSiteConfigs = vi.fn().mockRejectedValue(new Error("Remove failed."));
    const readyRoot = createReadyRootDeps();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions,
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn(async () => [...sites]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs,
      ...readyRoot,
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await screen.findByText("https://app.example.com");
      await user.click(screen.getByRole("button", { name: "Remove" }));

      expect(setSiteConfigs).toHaveBeenCalledTimes(1);
      expect(permissions.remove).not.toHaveBeenCalled();
      expect(await screen.findByText("Remove failed.")).toBeTruthy();
      expect(sites).toEqual([createStoredSite()]);
    } finally {
      options.unmount();
    }
  });

  it("shows the choose-root action when no root is connected and stores the selection", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const rootHandle = { kind: "directory" } as FileSystemDirectoryHandle;
    const showDirectoryPicker = vi.fn().mockResolvedValue(rootHandle);
    const loadStoredRootHandle = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(rootHandle);
    const ensureRootSentinel = vi.fn().mockResolvedValue({ rootId: "root-123" });
    const storeRootHandleWithSentinel = vi.fn().mockResolvedValue({ rootId: "root-123" });

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(showDirectoryPicker),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle,
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn(),
      ensureRootSentinel,
      storeRootHandleWithSentinel,
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      const button = await screen.findByRole("button", { name: "Choose Root Directory" });
      await user.click(button);

      expect(showDirectoryPicker).toHaveBeenCalledWith({
        mode: "readwrite",
        id: ROOT_DIRECTORY_PICKER_ID
      });
      expect(storeRootHandleWithSentinel).toHaveBeenCalledWith(rootHandle);
      expect(await screen.findByText(/Root directory saved\. Root ID: root-123\./)).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("ignores aborted root-directory picks without surfacing an error", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const showDirectoryPicker = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(showDirectoryPicker),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await user.click(await screen.findByRole("button", { name: "Choose Root Directory" }));
      expect(showDirectoryPicker).toHaveBeenCalledWith({
        mode: "readwrite",
        id: ROOT_DIRECTORY_PICKER_ID
      });
      expect(screen.queryByText(/Aborted/i)).toBeNull();
      expect(screen.getByText(/No WraithWalker root directory is connected yet/i)).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("shows the reconnect action when root permission is revoked", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const rootHandle = {};
    const queryRootPermission = vi.fn()
      .mockResolvedValueOnce("prompt")
      .mockResolvedValueOnce("granted");
    const requestRootPermission = vi.fn().mockResolvedValue("granted");

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      queryRootPermission,
      requestRootPermission,
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-1" }),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      const button = await screen.findByRole("button", { name: "Reconnect Root Directory" });
      await user.click(button);
      expect(requestRootPermission).toHaveBeenCalledWith(rootHandle);
      expect(await screen.findByText("Root permission status: granted.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("shows a destructive flash when reconnecting root permission is denied", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const rootHandle = {} as FileSystemDirectoryHandle;

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      queryRootPermission: vi.fn().mockResolvedValue("prompt"),
      requestRootPermission: vi.fn().mockResolvedValue("denied"),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-1" }),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await user.click(await screen.findByRole("button", { name: "Reconnect Root Directory" }));
      expect(await screen.findByText("Root permission status: denied.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("surfaces a clear error when reconnecting root permission but the stored handle is gone", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn()
        .mockResolvedValueOnce({} as FileSystemDirectoryHandle)
        .mockResolvedValueOnce(undefined),
      queryRootPermission: vi.fn().mockResolvedValue("prompt"),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-1" }),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await user.click(await screen.findByRole("button", { name: "Reconnect Root Directory" }));
      expect(await screen.findByText("Choose a root directory first.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("keeps the settings flow Cursor-first without a preferred-editor picker", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn()
    });

    try {
      expect(await screen.findByText("WraithWalker Root")).toBeTruthy();
      expect(screen.queryByText("Preferred Editor")).toBeNull();
      await userEvent.setup().click(screen.getByRole("button", { name: "Show" }));
      expect(await screen.findByLabelText("Custom URL Override For Cursor")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("shows the change-root action and sentinel when the root is ready", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const currentRootHandle = { kind: "directory" } as FileSystemDirectoryHandle;
    const showDirectoryPicker = vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle);

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(showDirectoryPicker),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(currentRootHandle),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-ready" }),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      expect(await screen.findByRole("button", { name: "Change Root Directory" })).toBeTruthy();
      expect(screen.getByText("WraithWalker root access is ready. Root ID: root-ready.")).toBeTruthy();
      expect(screen.getByText("root-ready")).toBeTruthy();
      expect(screen.getByText("WraithWalker Root")).toBeTruthy();
      expect(screen.getByText("Enabled Origins")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open Launch Folder" })).toBeTruthy();
      expect(screen.queryByText("Default root path")).toBeNull();

      await userEvent.setup().click(screen.getByRole("button", { name: "Change Root Directory" }));
      expect(showDirectoryPicker).toHaveBeenCalledWith({
        mode: "readwrite",
        id: ROOT_DIRECTORY_PICKER_ID,
        startIn: currentRootHandle
      });
    } finally {
      options.unmount();
    }
  });

  it("saves Cursor launch overrides from the collapsed advanced section", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const setNativeHostConfig = vi.fn().mockResolvedValue(undefined);
    const getNativeHostConfig = vi.fn()
      .mockResolvedValueOnce(createNativeHostConfig())
      .mockResolvedValueOnce(createNativeHostConfig({
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures",
        editorLaunchOverrides: {
          cursor: {
            urlTemplate: "cursor://workspace?folder=$DIR_COMPONENT",
            commandTemplate: 'cursor "$DIR"'
          }
        }
      }))
      .mockResolvedValueOnce(createNativeHostConfig({
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures",
        editorLaunchOverrides: {
          cursor: {
            urlTemplate: "cursor://workspace?folder=$DIR_COMPONENT",
            commandTemplate: 'cursor "$DIR"'
          }
        }
      }));
    const runtimeSendMessage = createRuntimeSendMessage();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: runtimeSendMessage
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig,
      setNativeHostConfig,
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn()
    });

    try {
      expect(await screen.findByText(/Hidden by default so the common flow stays simple/i)).toBeTruthy();
      expect(screen.queryByLabelText("Native Host Name")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Show" }));
      fireEvent.change(await screen.findByLabelText("Native Host Name"), {
        target: { value: "com.example.host" }
      });
      fireEvent.change(screen.getByLabelText("Shared Editor Launch Path"), {
        target: { value: "/tmp/fixtures" }
      });
      fireEvent.change(screen.getByLabelText("Custom URL Override For Cursor"), {
        target: { value: "cursor://workspace?folder=$DIR_COMPONENT" }
      });
      fireEvent.change(screen.getByLabelText("Custom Command Override For Cursor"), {
        target: { value: 'cursor "$DIR"' }
      });
      await user.click(screen.getByRole("button", { name: "Save Launch Settings" }));

      expect(setNativeHostConfig).toHaveBeenCalledWith(createNativeHostConfig({
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures",
        editorLaunchOverrides: {
          cursor: {
            urlTemplate: "cursor://workspace?folder=$DIR_COMPONENT",
            commandTemplate: 'cursor "$DIR"'
          }
        }
      }));
      expect(await screen.findByText("Launch settings saved.")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Verify Helper" }));
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "native.verify" });
      expect(await screen.findByText("Helper verified at 2026-04-03T12:00:00.000Z.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("hides advanced native-host controls again after they are expanded", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: createRuntimeSendMessage()
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn()
    });

    try {
      expect(await screen.findByText(/Hidden by default so the common flow stays simple/i)).toBeTruthy();
      expect(screen.queryByLabelText("Native Host Name")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Show" }));
      expect(await screen.findByLabelText("Native Host Name")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Hide" }));
      expect(screen.queryByLabelText("Native Host Name")).toBeNull();
      expect(screen.getByText(/Hidden by default so the common flow stays simple/i)).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("opens the configured launch folder through the OS handler", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const runtimeSendMessage = vi.fn(async (message: { type: string }) => {
      switch (message.type) {
        case "scenario.list":
          return { ok: true, scenarios: ["baseline"] };
        case "native.revealRoot":
          return { ok: true };
        default:
          return { ok: true };
      }
    });

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: runtimeSendMessage
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      })),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-ready" }),
      storeRootHandleWithSentinel: vi.fn()
    });

    try {
      await user.click(await screen.findByRole("button", { name: "Open Launch Folder" }));
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "native.revealRoot" });
      expect(await screen.findByText("Opened the launch folder in the OS file manager.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("surfaces launch-folder failures as a destructive flash message", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const runtimeSendMessage = vi.fn(async (message: { type: string }) => {
      switch (message.type) {
        case "scenario.list":
          return { ok: true, scenarios: ["baseline"] };
        case "native.revealRoot":
          return { ok: false, error: "Reveal failed." };
        default:
          return { ok: true };
      }
    });

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: runtimeSendMessage
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig({
        hostName: "com.example.host",
        launchPath: "/tmp/fixtures"
      })),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle),
      queryRootPermission: vi.fn().mockResolvedValue("granted"),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-ready" }),
      storeRootHandleWithSentinel: vi.fn()
    });

    try {
      await user.click(await screen.findByRole("button", { name: "Open Launch Folder" }));
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "native.revealRoot" });
      expect(await screen.findByText("Reveal failed.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("moves scenario save and switch controls into settings", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const runtimeSendMessage = createRuntimeSendMessage();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: runtimeSendMessage
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      expect(await screen.findByText("baseline")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Switch" }));
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "scenario.switch", name: "baseline" });
      expect(await screen.findByText('Switched to "baseline".')).toBeTruthy();

      await user.type(screen.getByLabelText("Scenario name"), "release");
      await user.click(screen.getByRole("button", { name: "Save Scenario" }));
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "scenario.save", name: "release" });
      expect(await screen.findByText('Scenario "release" saved.')).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("ignores blank scenario saves", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const runtimeSendMessage = createRuntimeSendMessage();

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: runtimeSendMessage
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await user.type(await screen.findByLabelText("Scenario name"), "   ");
      await user.click(screen.getByRole("button", { name: "Save Scenario" }));
      expect(runtimeSendMessage).toHaveBeenCalledTimes(2);
      expect(runtimeSendMessage).toHaveBeenNthCalledWith(1, { type: "session.getState" });
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "scenario.list" });
    } finally {
      options.unmount();
    }
  });

  it("surfaces scenario list failures without crashing the page", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const runtimeSendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === "scenario.list") {
        return { ok: false, error: "Scenario listing failed." };
      }
      return { ok: true };
    });

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: runtimeSendMessage
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      expect(await screen.findByText("Scenario listing failed.")).toBeTruthy();
      expect(screen.getByText("No scenarios saved yet.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("surfaces helper verification and scenario action failures", async () => {
    renderRoot();
    const { initOptions } = await loadOptionsModule();
    const user = userEvent.setup();
    const runtimeSendMessage = vi.fn(async (message: { type: string; name?: string }) => {
      switch (message.type) {
        case "scenario.list":
          return { ok: true, scenarios: ["baseline"] };
        case "native.verify":
          return { ok: false, error: "Helper unavailable." };
        case "scenario.switch":
          return { ok: false, error: "Switch failed." };
        case "scenario.save":
          return { ok: false, error: "Save failed." };
        default:
          return { ok: true };
      }
    });

    const options = await initOptions({
      document,
      windowRef: createWindowWithDirectoryPicker(
        vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
      ),
      chromeApi: {
        permissions: {
          request: vi.fn(),
          remove: vi.fn()
        },
        runtime: {
          sendMessage: runtimeSendMessage
        }
      },
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      setNativeHostConfig: vi.fn(),
      setSiteConfigs: vi.fn(),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn(),
      requestRootPermission: vi.fn(),
      ensureRootSentinel: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      getPreferredEditorId: vi.fn().mockResolvedValue("vscode")
    });

    try {
      await user.click(await screen.findByRole("button", { name: "Show" }));
      await user.click(screen.getByRole("button", { name: "Verify Helper" }));
      expect(await screen.findByText("Helper unavailable.")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Switch" }));
      expect(await screen.findByText("Switch failed.")).toBeTruthy();

      await user.type(screen.getByLabelText("Scenario name"), "release");
      await user.click(screen.getByRole("button", { name: "Save Scenario" }));
      expect(await screen.findByText("Save failed.")).toBeTruthy();
    } finally {
      options.unmount();
    }
  });

  it("bootstraps automatically outside test mode", async () => {
    renderRoot();
    vi.doMock("../src/lib/chrome-storage.js", () => ({
      getNativeHostConfig: vi.fn().mockResolvedValue(createNativeHostConfig()),
      getPreferredEditorId: vi.fn().mockResolvedValue("cursor"),
      getSiteConfigs: vi.fn().mockResolvedValue([]),
      setNativeHostConfig: vi.fn().mockResolvedValue(undefined),
      setPreferredEditorId: vi.fn().mockResolvedValue(undefined),
      setSiteConfigs: vi.fn().mockResolvedValue(undefined)
    }));
    vi.doMock("../src/lib/root-handle.js", () => ({
      ensureRootSentinel: vi.fn().mockResolvedValue({ rootId: "root-auto" }),
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      queryRootPermission: vi.fn().mockResolvedValue("prompt"),
      requestRootPermission: vi.fn().mockResolvedValue("granted"),
      storeRootHandleWithSentinel: vi.fn().mockResolvedValue({ rootId: "root-auto" })
    }));
    globalThis.chrome = {
      permissions: {
        request: vi.fn().mockResolvedValue(true),
        remove: vi.fn().mockResolvedValue(true)
      },
      runtime: {
        sendMessage: vi.fn(async (message: { type: string }) => {
          if (message.type === "scenario.list") {
            return { ok: true, scenarios: [] };
          }
          if (message.type === "native.verify") {
            return { ok: true, verifiedAt: "2026-04-03T12:00:00.000Z" };
          }
          return { ok: true };
        })
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined)
        }
      }
    } as any;
    createWindowWithDirectoryPicker(
      vi.fn().mockResolvedValue({ kind: "directory" } as FileSystemDirectoryHandle)
    );

    await loadOptionsModuleOutsideTestMode();

    expect(await screen.findByText("Enabled Origins")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose Root Directory" })).toBeTruthy();
  });
});
