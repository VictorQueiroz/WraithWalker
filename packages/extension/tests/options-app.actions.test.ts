import { describe, expect, it, vi } from "vitest";

import type { MessageRuntimeApi } from "../src/lib/chrome-api.js";
import type { NativeHostConfig, SiteConfig } from "../src/lib/types.js";
import {
  addSiteAction,
  chooseOrReconnectRootAction,
  confirmSwitchScenarioAction,
  copyDiagnosticsAction,
  openLaunchFolderAction,
  prepareSwitchScenarioAction,
  removeSiteAction,
  saveLaunchSettingsAction,
  saveScenarioAction,
  saveScenarioFromTraceAction,
  updateSiteAction,
  verifyHelperAction
} from "../src/ui/options-app.actions.js";
import { DEFAULT_NATIVE_HOST_CONFIG } from "../src/lib/constants.js";

function createRuntime(
  sendMessage: ReturnType<typeof vi.fn> = vi.fn()
): MessageRuntimeApi {
  return {
    sendMessage: sendMessage as MessageRuntimeApi["sendMessage"]
  };
}

function createSite(overrides: Partial<SiteConfig> = {}): SiteConfig {
  return {
    origin: "https://app.example.com",
    createdAt: "2026-04-18T00:00:00.000Z",
    dumpAllowlistPatterns: ["\\.js$"],
    ...overrides
  };
}

function createNativeHostConfig(
  overrides: Partial<NativeHostConfig> = {}
): NativeHostConfig {
  return {
    ...DEFAULT_NATIVE_HOST_CONFIG,
    ...overrides,
    editorLaunchOverrides: {
      ...DEFAULT_NATIVE_HOST_CONFIG.editorLaunchOverrides,
      ...overrides.editorLaunchOverrides
    }
  };
}

describe("options app actions", () => {
  it("blocks adding an origin when site editing is unavailable", async () => {
    const permissions = {
      request: vi.fn(),
      remove: vi.fn()
    };

    const result = await addSiteAction({
      originInput: "https://app.example.com",
      canEditSites: false,
      originsBlockedMessage:
        "Choose Root Directory above before adding origins.",
      permissions,
      sites: [],
      setSiteConfigs: vi.fn(),
      setSiteConfigsCache: vi.fn(),
      refetchSessionSnapshot: vi.fn()
    });

    expect(result).toEqual({
      kind: "blocked",
      flash: {
        variant: "destructive",
        text: "Choose Root Directory above before adding origins."
      },
      nextSiteOriginInput: "https://app.example.com"
    });
    expect(permissions.request).not.toHaveBeenCalled();
  });

  it("adds a new origin, syncs the cache, and refreshes the session snapshot", async () => {
    const permissions = {
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn()
    };
    const setSiteConfigs = vi.fn().mockResolvedValue(undefined);
    const setSiteConfigsCache = vi.fn();
    const refetchSessionSnapshot = vi.fn().mockResolvedValue(undefined);

    const result = await addSiteAction({
      originInput: "app.example.com",
      canEditSites: true,
      originsBlockedMessage: "blocked",
      permissions,
      sites: [],
      setSiteConfigs,
      setSiteConfigsCache,
      refetchSessionSnapshot
    });

    expect(result).toEqual({
      kind: "added",
      flash: {
        variant: "success",
        text: "Origin added and host access granted."
      },
      nextSiteOriginInput: ""
    });
    expect(permissions.request).toHaveBeenCalledWith({
      origins: ["https://app.example.com/*"]
    });
    expect(setSiteConfigs).toHaveBeenCalledWith([
      expect.objectContaining({
        origin: "https://app.example.com",
        createdAt: expect.any(String),
        dumpAllowlistPatterns: expect.arrayContaining(["\\.m?(js|ts)x?$"])
      })
    ]);
    expect(setSiteConfigsCache).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          origin: "https://app.example.com"
        })
      ])
    );
    expect(refetchSessionSnapshot).toHaveBeenCalledTimes(1);
  });

  it("treats a normalized duplicate origin as already enabled without writing config", async () => {
    const permissions = {
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn()
    };
    const existingSite = createSite();
    const setSiteConfigs = vi.fn();
    const setSiteConfigsCache = vi.fn();
    const refetchSessionSnapshot = vi.fn();

    const result = await addSiteAction({
      originInput: "app.example.com",
      canEditSites: true,
      originsBlockedMessage: "blocked",
      permissions,
      sites: [existingSite],
      setSiteConfigs,
      setSiteConfigsCache,
      refetchSessionSnapshot
    });

    expect(result).toEqual({
      kind: "already_enabled",
      flash: {
        variant: "default",
        text: "Origin https://app.example.com is already enabled."
      },
      nextSiteOriginInput: "app.example.com"
    });
    expect(setSiteConfigs).not.toHaveBeenCalled();
    expect(setSiteConfigsCache).toHaveBeenCalledWith([existingSite]);
    expect(refetchSessionSnapshot).not.toHaveBeenCalled();
  });

  it("surfaces add-origin failures as destructive flashes", async () => {
    const result = await addSiteAction({
      originInput: "https://app.example.com",
      canEditSites: true,
      originsBlockedMessage: "blocked",
      permissions: {
        request: vi.fn().mockRejectedValue("Permission lost"),
        remove: vi.fn()
      },
      sites: [],
      setSiteConfigs: vi.fn(),
      setSiteConfigsCache: vi.fn(),
      refetchSessionSnapshot: vi.fn()
    });

    expect(result).toEqual({
      kind: "error",
      flash: {
        variant: "destructive",
        text: "Permission lost"
      },
      nextSiteOriginInput: "https://app.example.com"
    });
  });

  it("returns a validation error for invalid dump allowlist patterns", async () => {
    const result = await updateSiteAction({
      origin: "https://app.example.com",
      dumpAllowlistPatterns: ["["],
      canEditSites: true,
      originsBlockedMessage: "blocked",
      sites: [createSite()],
      setSiteConfigs: vi.fn(),
      setSiteConfigsCache: vi.fn(),
      refetchSessionSnapshot: vi.fn()
    });

    expect(result).toEqual({
      kind: "validation_error",
      flash: {
        variant: "destructive",
        text: "One or more dump allowlist patterns are invalid."
      }
    });
  });

  it("blocks site updates when origin editing is unavailable", async () => {
    const result = await updateSiteAction({
      origin: "https://app.example.com",
      dumpAllowlistPatterns: ["\\.tsx$"],
      canEditSites: false,
      originsBlockedMessage:
        "Reconnect Root Directory above before adding origins.",
      sites: [createSite()],
      setSiteConfigs: vi.fn(),
      setSiteConfigsCache: vi.fn(),
      refetchSessionSnapshot: vi.fn()
    });

    expect(result).toEqual({
      kind: "blocked",
      flash: {
        variant: "destructive",
        text: "Reconnect Root Directory above before adding origins."
      }
    });
  });

  it("updates a site, syncs the cache, and refreshes the session snapshot", async () => {
    const setSiteConfigs = vi.fn().mockResolvedValue(undefined);
    const setSiteConfigsCache = vi.fn();
    const refetchSessionSnapshot = vi.fn().mockResolvedValue(undefined);
    const untouchedSite = createSite({
      origin: "https://docs.example.com",
      createdAt: "2026-04-19T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.json$"]
    });

    const result = await updateSiteAction({
      origin: "https://app.example.com",
      dumpAllowlistPatterns: ["\\.tsx$"],
      canEditSites: true,
      originsBlockedMessage: "blocked",
      sites: [createSite(), untouchedSite],
      setSiteConfigs,
      setSiteConfigsCache,
      refetchSessionSnapshot
    });

    expect(result).toEqual({
      kind: "success",
      flash: {
        variant: "success",
        text: "Updated https://app.example.com."
      }
    });
    expect(setSiteConfigs).toHaveBeenCalledWith([
      createSite({
        dumpAllowlistPatterns: ["\\.tsx$"]
      }),
      untouchedSite
    ]);
    expect(setSiteConfigsCache).toHaveBeenCalledWith([
      createSite({
        dumpAllowlistPatterns: ["\\.tsx$"]
      }),
      untouchedSite
    ]);
    expect(refetchSessionSnapshot).toHaveBeenCalledTimes(1);
  });

  it("surfaces site update write failures", async () => {
    const result = await updateSiteAction({
      origin: "https://app.example.com",
      dumpAllowlistPatterns: ["\\.tsx$"],
      canEditSites: true,
      originsBlockedMessage: "blocked",
      sites: [createSite()],
      setSiteConfigs: vi.fn().mockRejectedValue(new Error("Write failed.")),
      setSiteConfigsCache: vi.fn(),
      refetchSessionSnapshot: vi.fn()
    });

    expect(result).toEqual({
      kind: "error",
      flash: {
        variant: "destructive",
        text: "Write failed."
      }
    });
  });

  it("blocks site removal when origin editing is unavailable", async () => {
    const result = await removeSiteAction({
      origin: "https://app.example.com",
      canEditSites: false,
      originsBlockedMessage:
        "Choose Root Directory above before adding origins.",
      permissions: {
        request: vi.fn(),
        remove: vi.fn()
      },
      sites: [createSite()],
      setSiteConfigs: vi.fn(),
      setSiteConfigsCache: vi.fn(),
      refetchSessionSnapshot: vi.fn()
    });

    expect(result).toEqual({
      kind: "blocked",
      flash: {
        variant: "destructive",
        text: "Choose Root Directory above before adding origins."
      }
    });
  });

  it("removes a site even if host-permission cleanup rejects", async () => {
    const setSiteConfigs = vi.fn().mockResolvedValue(undefined);
    const setSiteConfigsCache = vi.fn();
    const refetchSessionSnapshot = vi.fn().mockResolvedValue(undefined);
    const permissions = {
      request: vi.fn(),
      remove: vi.fn().mockRejectedValue(new Error("cleanup failed"))
    };

    const result = await removeSiteAction({
      origin: "https://app.example.com",
      canEditSites: true,
      originsBlockedMessage: "blocked",
      permissions,
      sites: [createSite()],
      setSiteConfigs,
      setSiteConfigsCache,
      refetchSessionSnapshot
    });

    expect(result).toEqual({
      kind: "success",
      flash: {
        variant: "success",
        text: "Removed https://app.example.com."
      }
    });
    expect(setSiteConfigs).toHaveBeenCalledWith([]);
    expect(permissions.remove).toHaveBeenCalledWith({
      origins: ["https://app.example.com/*"]
    });
    expect(refetchSessionSnapshot).toHaveBeenCalledTimes(1);
  });

  it("saves a new root handle through the picker flow", async () => {
    const rootHandle = { kind: "directory" } as FileSystemDirectoryHandle;
    const result = await chooseOrReconnectRootAction({
      rootState: null,
      windowRef: {
        showDirectoryPicker: vi.fn().mockResolvedValue(rootHandle)
      } as Pick<Window, "showDirectoryPicker">,
      loadStoredRootHandle: vi.fn(),
      requestRootPermission: vi.fn(),
      storeRootHandleWithSentinel: vi.fn().mockResolvedValue({
        rootId: "root-1"
      }),
      refetchRememberedRootState: vi.fn().mockResolvedValue(undefined)
    });

    expect(result).toEqual({
      kind: "saved",
      flash: {
        variant: "success",
        text: "Root directory saved. Root ID: root-1."
      }
    });
  });

  it("reconnects root permissions when a stored handle exists", async () => {
    const rootHandle = { kind: "directory" } as FileSystemDirectoryHandle;
    const refetchRememberedRootState = vi.fn().mockResolvedValue(undefined);

    const result = await chooseOrReconnectRootAction({
      rootState: {
        hasHandle: true,
        permission: "prompt"
      },
      windowRef: {
        showDirectoryPicker: vi.fn()
      } as Pick<Window, "showDirectoryPicker">,
      loadStoredRootHandle: vi.fn().mockResolvedValue(rootHandle),
      requestRootPermission: vi.fn().mockResolvedValue("granted"),
      storeRootHandleWithSentinel: vi.fn(),
      refetchRememberedRootState
    });

    expect(result).toEqual({
      kind: "permission_status",
      flash: {
        variant: "success",
        text: "Root permission status: granted."
      }
    });
    expect(refetchRememberedRootState).toHaveBeenCalledTimes(1);
  });

  it("surfaces a clear reconnect error when the stored root handle is gone", async () => {
    const result = await chooseOrReconnectRootAction({
      rootState: {
        hasHandle: true,
        permission: "prompt"
      },
      windowRef: {
        showDirectoryPicker: vi.fn()
      } as Pick<Window, "showDirectoryPicker">,
      loadStoredRootHandle: vi.fn().mockResolvedValue(undefined),
      requestRootPermission: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      refetchRememberedRootState: vi.fn()
    });

    expect(result).toEqual({
      kind: "error",
      flash: {
        variant: "destructive",
        text: "Choose a root directory first."
      }
    });
  });

  it("treats an aborted root-directory picker as a no-op", async () => {
    const result = await chooseOrReconnectRootAction({
      rootState: null,
      windowRef: {
        showDirectoryPicker: vi
          .fn()
          .mockRejectedValue(new DOMException("Canceled", "AbortError"))
      } as Pick<Window, "showDirectoryPicker">,
      loadStoredRootHandle: vi.fn(),
      requestRootPermission: vi.fn(),
      storeRootHandleWithSentinel: vi.fn(),
      refetchRememberedRootState: vi.fn()
    });

    expect(result).toEqual({
      kind: "noop"
    });
  });

  it("saves launch settings and refreshes native host config", async () => {
    const nativeHostConfig = createNativeHostConfig({
      launchPath: "/tmp/fixtures"
    });
    const setNativeHostConfig = vi.fn().mockResolvedValue(undefined);
    const refetchNativeHostConfig = vi.fn().mockResolvedValue(undefined);

    const result = await saveLaunchSettingsAction({
      nativeHostConfig,
      setNativeHostConfig,
      refetchNativeHostConfig
    });

    expect(result).toEqual({
      kind: "success",
      flash: {
        variant: "success",
        text: "Launch settings saved."
      }
    });
    expect(setNativeHostConfig).toHaveBeenCalledWith(nativeHostConfig);
    expect(refetchNativeHostConfig).toHaveBeenCalledTimes(1);
  });

  it("treats missing launch settings as a no-op", async () => {
    const result = await saveLaunchSettingsAction({
      nativeHostConfig: null,
      setNativeHostConfig: vi.fn(),
      refetchNativeHostConfig: vi.fn()
    });

    expect(result).toEqual({
      kind: "noop"
    });
  });

  it("verifies the native helper and refreshes host config", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      verifiedAt: "2026-04-18T01:00:00.000Z"
    });
    const refetchNativeHostConfig = vi.fn().mockResolvedValue(undefined);

    const result = await verifyHelperAction({
      runtime: createRuntime(sendMessage),
      refetchNativeHostConfig
    });

    expect(result).toEqual({
      kind: "success",
      flash: {
        variant: "success",
        text: "Helper verified at 2026-04-18T01:00:00.000Z."
      }
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: "native.verify"
    });
    expect(refetchNativeHostConfig).toHaveBeenCalledTimes(1);
  });

  it("surfaces helper verification failures", async () => {
    const result = await verifyHelperAction({
      runtime: createRuntime(
        vi.fn().mockResolvedValue({
          ok: false,
          error: "Native helper is unavailable."
        })
      ),
      refetchNativeHostConfig: vi.fn().mockResolvedValue(undefined)
    });

    expect(result).toEqual({
      kind: "error",
      flash: {
        variant: "destructive",
        text: "Native helper is unavailable."
      }
    });
  });

  it('falls back to "Unknown error." when a helper verification failure omits an error message', async () => {
    const result = await verifyHelperAction({
      runtime: createRuntime(
        vi.fn().mockResolvedValue({
          ok: false
        })
      ),
      refetchNativeHostConfig: vi.fn().mockResolvedValue(undefined)
    });

    expect(result).toEqual({
      kind: "error",
      flash: {
        variant: "destructive",
        text: "Unknown error."
      }
    });
  });

  it.each([
    {
      authority: "none" as const,
      authorityLabel: "No Active Root" as const,
      expectedText: "Opened the active root in the OS file manager."
    },
    {
      authority: "server" as const,
      authorityLabel: "Server Root" as const,
      expectedText: "Opened Server Root in the OS file manager."
    }
  ])(
    "opens the launch folder with the right success message for $authority",
    async ({ authority, authorityLabel, expectedText }) => {
      const result = await openLaunchFolderAction({
        runtime: createRuntime(
          vi.fn().mockResolvedValue({
            ok: true
          })
        ),
        workspaceStatus: {
          authority,
          authorityLabel
        }
      });

      expect(result).toEqual({
        kind: "success",
        flash: {
          variant: "success",
          text: expectedText
        }
      });
    }
  );

  it("copies support diagnostics to the clipboard", async () => {
    const report = {
      generatedAt: "2026-04-18T01:00:00.000Z"
    };
    const writeClipboardText = vi.fn().mockResolvedValue(undefined);

    const result = await copyDiagnosticsAction({
      runtime: createRuntime(
        vi.fn().mockResolvedValue({
          ok: true,
          report
        })
      ),
      writeClipboardText
    });

    expect(result).toEqual({
      kind: "success",
      flash: {
        variant: "success",
        text: "Support diagnostics copied to clipboard."
      }
    });
    expect(writeClipboardText).toHaveBeenCalledWith(
      JSON.stringify(report, null, 2)
    );
  });

  it("surfaces diagnostics result failures", async () => {
    const result = await copyDiagnosticsAction({
      runtime: createRuntime(
        vi.fn().mockResolvedValue({
          ok: false,
          error: "No root directory selected."
        })
      ),
      writeClipboardText: vi.fn()
    });

    expect(result).toEqual({
      kind: "error",
      flash: {
        variant: "destructive",
        text: "No root directory selected."
      }
    });
  });

  it("surfaces clipboard failures while copying diagnostics", async () => {
    const result = await copyDiagnosticsAction({
      runtime: createRuntime(
        vi.fn().mockResolvedValue({
          ok: true,
          report: { generatedAt: "2026-04-18T01:00:00.000Z" }
        })
      ),
      writeClipboardText: vi.fn().mockRejectedValue("Clipboard denied")
    });

    expect(result).toEqual({
      kind: "error",
      flash: {
        variant: "destructive",
        text: "Clipboard denied"
      }
    });
  });

  it("validates manual scenario names before saving", async () => {
    const result = await saveScenarioAction({
      runtime: createRuntime(),
      nameInput: "",
      descriptionInput: "",
      refetchScenarioPanel: vi.fn()
    });

    expect(result).toEqual({
      kind: "validation_error",
      errorText: "Enter a scenario name."
    });
  });

  it("saves a manual scenario and trims/omits optional fields correctly", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      name: "baseline"
    });
    const refetchScenarioPanel = vi.fn().mockResolvedValue(undefined);

    const result = await saveScenarioAction({
      runtime: createRuntime(sendMessage),
      nameInput: " baseline ",
      descriptionInput: "   ",
      refetchScenarioPanel
    });

    expect(result).toEqual({
      kind: "success",
      flash: {
        variant: "success",
        text: 'Scenario "baseline" saved.'
      },
      nextName: "",
      nextDescription: ""
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: "scenario.save",
      name: "baseline"
    });
    expect(refetchScenarioPanel).toHaveBeenCalledTimes(1);
  });

  it("surfaces manual scenario save failures", async () => {
    const result = await saveScenarioAction({
      runtime: createRuntime(
        vi.fn().mockResolvedValue({
          ok: false,
          error: "Scenario save failed."
        })
      ),
      nameInput: "baseline",
      descriptionInput: "",
      refetchScenarioPanel: vi.fn()
    });

    expect(result).toEqual({
      kind: "error",
      flash: {
        variant: "destructive",
        text: "Scenario save failed."
      }
    });
  });

  it("validates trace scenario names before saving", async () => {
    const result = await saveScenarioFromTraceAction({
      runtime: createRuntime(),
      nameInput: "",
      descriptionInput: "",
      refetchScenarioPanel: vi.fn()
    });

    expect(result).toEqual({
      kind: "validation_error",
      errorText: "Enter a scenario name."
    });
  });

  it("saves a trace-backed scenario and preserves optional description shaping", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      name: "trace_snapshot"
    });
    const refetchScenarioPanel = vi.fn().mockResolvedValue(undefined);

    const result = await saveScenarioFromTraceAction({
      runtime: createRuntime(sendMessage),
      nameInput: "trace_snapshot",
      descriptionInput: "Saved from active trace",
      refetchScenarioPanel
    });

    expect(result).toEqual({
      kind: "success",
      flash: {
        variant: "success",
        text: 'Scenario "trace_snapshot" saved from the active trace.'
      }
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: "scenario.saveFromTrace",
      name: "trace_snapshot",
      description: "Saved from active trace"
    });
    expect(refetchScenarioPanel).toHaveBeenCalledTimes(1);
  });

  it("surfaces trace-backed scenario save failures", async () => {
    const result = await saveScenarioFromTraceAction({
      runtime: createRuntime(
        vi.fn().mockResolvedValue({
          ok: false,
          error: "Trace snapshot failed."
        })
      ),
      nameInput: "trace_snapshot",
      descriptionInput: "",
      refetchScenarioPanel: vi.fn()
    });

    expect(result).toEqual({
      kind: "error",
      flash: {
        variant: "destructive",
        text: "Trace snapshot failed."
      }
    });
  });

  it("prepares a diff-backed switch dialog when there is an active baseline", async () => {
    const diff = {
      scenarioA: "baseline",
      scenarioB: "candidate",
      added: [],
      removed: [],
      changed: []
    };

    const result = await prepareSwitchScenarioAction({
      runtime: createRuntime(
        vi.fn().mockResolvedValue({
          ok: true,
          diff
        })
      ),
      targetName: "candidate",
      activeScenarioName: "baseline",
      activeScenarioMissing: false
    });

    expect(result).toEqual({
      kind: "diff_dialog",
      dialog: {
        targetName: "candidate",
        diff
      }
    });
  });

  it("prepares a plain confirmation dialog when no active baseline is available", async () => {
    const sendMessage = vi.fn();

    const result = await prepareSwitchScenarioAction({
      runtime: createRuntime(sendMessage),
      targetName: "candidate",
      activeScenarioName: null,
      activeScenarioMissing: false
    });

    expect(result).toEqual({
      kind: "plain_dialog",
      dialog: {
        targetName: "candidate",
        diff: null
      }
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("surfaces diff lookup failures while preparing a switch", async () => {
    const result = await prepareSwitchScenarioAction({
      runtime: createRuntime(
        vi.fn().mockResolvedValue({
          ok: false,
          error: "Diff failed."
        })
      ),
      targetName: "candidate",
      activeScenarioName: "baseline",
      activeScenarioMissing: false
    });

    expect(result).toEqual({
      kind: "error",
      flash: {
        variant: "destructive",
        text: "Diff failed."
      }
    });
  });

  it("confirms a switch, refreshes the scenario panel, and returns a success flash", async () => {
    const refetchScenarioPanel = vi.fn().mockResolvedValue(undefined);

    const result = await confirmSwitchScenarioAction({
      runtime: createRuntime(
        vi.fn().mockResolvedValue({
          ok: true,
          name: "candidate"
        })
      ),
      switchDialog: {
        targetName: "candidate",
        diff: null
      },
      refetchScenarioPanel
    });

    expect(result).toEqual({
      kind: "success",
      flash: {
        variant: "success",
        text: 'Switched to "candidate".'
      }
    });
    expect(refetchScenarioPanel).toHaveBeenCalledTimes(1);
  });

  it("surfaces switch confirmation failures", async () => {
    const result = await confirmSwitchScenarioAction({
      runtime: createRuntime(
        vi.fn().mockResolvedValue({
          ok: false,
          error: "Switch failed."
        })
      ),
      switchDialog: {
        targetName: "candidate",
        diff: null
      },
      refetchScenarioPanel: vi.fn()
    });

    expect(result).toEqual({
      kind: "error",
      flash: {
        variant: "destructive",
        text: "Switch failed."
      }
    });
  });

  it("treats a missing switch dialog as a no-op", async () => {
    const result = await confirmSwitchScenarioAction({
      runtime: createRuntime(),
      switchDialog: null,
      refetchScenarioPanel: vi.fn()
    });

    expect(result).toEqual({
      kind: "noop"
    });
  });
});
