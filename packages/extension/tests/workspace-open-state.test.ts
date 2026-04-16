import { describe, expect, it, vi } from "vitest";

import { DEFAULT_NATIVE_HOST_CONFIG } from "../src/lib/constants.js";
import { normalizeNativeHostConfig } from "../src/lib/editor-launch.js";
import {
  createMissingLaunchPathAlert,
  createMissingNativeHostAlert,
  deriveCaptureRootState,
  deriveEditorLaunchState,
  derivePopupStartBlockReason,
  deriveWorkspaceReadiness,
  deriveWorkspaceStatus,
  resolvePopupAlert
} from "../src/lib/workspace-open-state.js";

describe("workspace open state", () => {
  it("derives all capture root states", () => {
    expect(
      deriveCaptureRootState({ hasHandle: false, permission: "prompt" })
    ).toEqual({ kind: "missing_handle" });
    expect(
      deriveCaptureRootState({ hasHandle: true, permission: "prompt" })
    ).toEqual({ kind: "permission_required" });
    expect(
      deriveCaptureRootState({ hasHandle: true, permission: "granted" })
    ).toEqual({ kind: "ready" });
  });

  it("derives all editor launch states", () => {
    expect(
      deriveEditorLaunchState(
        {
          ...DEFAULT_NATIVE_HOST_CONFIG,
          launchPath: "/tmp/fixtures"
        },
        "cursor"
      )
    ).toMatchObject({
      kind: "ready_via_url_root",
      editorId: "cursor",
      launchPath: "/tmp/fixtures"
    });

    expect(
      deriveEditorLaunchState(DEFAULT_NATIVE_HOST_CONFIG, "cursor")
    ).toEqual({
      kind: "ready_via_url_app",
      editorId: "cursor",
      editorLabel: "Cursor",
      url: "cursor://"
    });

    expect(
      deriveEditorLaunchState(
        {
          ...DEFAULT_NATIVE_HOST_CONFIG,
          hostName: "",
          launchPath: "/tmp/fixtures"
        },
        "windsurf"
      )
    ).toEqual({
      kind: "missing_native_host",
      editorId: "windsurf",
      editorLabel: "Windsurf"
    });

    expect(
      deriveEditorLaunchState(
        {
          ...DEFAULT_NATIVE_HOST_CONFIG,
          hostName: "com.example.host",
          launchPath: "/tmp/fixtures"
        },
        "windsurf"
      )
    ).toMatchObject({
      kind: "verification_required",
      editorId: "windsurf",
      launchPath: "/tmp/fixtures"
    });

    expect(
      deriveEditorLaunchState(
        {
          ...DEFAULT_NATIVE_HOST_CONFIG,
          hostName: "com.example.host",
          launchPath: "/tmp/fixtures"
        },
        "windsurf",
        { nativeHostVerified: true }
      )
    ).toMatchObject({
      kind: "ready_via_native",
      editorId: "windsurf",
      launchPath: "/tmp/fixtures"
    });

    expect(
      deriveEditorLaunchState(
        {
          ...DEFAULT_NATIVE_HOST_CONFIG,
          editorLaunchOverrides: {
            cursor: {
              urlTemplate: "cursor://file/$DIR_URI/"
            }
          }
        },
        "cursor"
      )
    ).toEqual({
      kind: "missing_launch_path",
      editorId: "cursor",
      editorLabel: "Cursor"
    });
  });

  it("falls back from a URL-template editor to the app URL when launchPath is missing", () => {
    expect(
      deriveEditorLaunchState(
        {
          ...DEFAULT_NATIVE_HOST_CONFIG,
          editorLaunchOverrides: {
            cursor: {
              urlTemplate: "cursor://file/$DIR_URI/"
            }
          }
        },
        "cursor"
      )
    ).toEqual({
      kind: "missing_launch_path",
      editorId: "cursor",
      editorLabel: "Cursor"
    });

    expect(
      deriveEditorLaunchState(DEFAULT_NATIVE_HOST_CONFIG, "cursor")
    ).toEqual({
      kind: "ready_via_url_app",
      editorId: "cursor",
      editorLabel: "Cursor",
      url: "cursor://"
    });
  });

  it("falls back to the app URL when the resolved editor has no URL template", async () => {
    vi.resetModules();
    vi.doMock("../src/lib/editor-launch.js", async () => {
      const actual = await vi.importActual<
        typeof import("../src/lib/editor-launch.js")
      >("../src/lib/editor-launch.js");

      return {
        ...actual,
        resolveEditorLaunch: vi.fn().mockReturnValue({
          editorId: "cursor",
          preset: {
            id: "cursor",
            label: "Cursor",
            commandTemplate: 'cursor "$DIR"',
            appUrl: "cursor://"
          },
          override: {},
          urlTemplate: "",
          appUrl: "cursor://",
          commandTemplate: 'cursor "$DIR"',
          hasBuiltInUrlTemplate: false,
          hasBuiltInAppUrl: true,
          hasCustomUrlOverride: false,
          hasCustomCommandOverride: false
        })
      };
    });

    try {
      const { deriveEditorLaunchState: deriveEditorLaunchStateWithMock } =
        await import("../src/lib/workspace-open-state.js");

      expect(
        deriveEditorLaunchStateWithMock(
          {
            ...DEFAULT_NATIVE_HOST_CONFIG,
            launchPath: 42 as never
          },
          "cursor"
        )
      ).toEqual({
        kind: "ready_via_url_app",
        editorId: "cursor",
        editorLabel: "Cursor",
        url: "cursor://"
      });
    } finally {
      vi.doUnmock("../src/lib/editor-launch.js");
      vi.resetModules();
    }
  });

  it("reports a missing launch path when no URL or app fallback exists", () => {
    expect(
      deriveEditorLaunchState(DEFAULT_NATIVE_HOST_CONFIG, "antigravity")
    ).toEqual({
      kind: "missing_launch_path",
      editorId: "antigravity",
      editorLabel: "Antigravity"
    });
  });

  it("ignores stale persisted native-host diagnostics and migrates legacy rootPath to launchPath", () => {
    expect(
      normalizeNativeHostConfig(
        {
          hostName: "com.example.host",
          rootPath: "/tmp/fixtures",
          verifiedAt: "2026-04-07T00:00:00.000Z",
          lastVerificationError: "Host not found.",
          lastOpenError: "Open failed."
        },
        "cursor"
      )
    ).toEqual({
      ...DEFAULT_NATIVE_HOST_CONFIG,
      hostName: "com.example.host",
      launchPath: "/tmp/fixtures",
      editorLaunchOverrides: {}
    });
  });

  it("builds missing native host alerts", () => {
    expect(createMissingNativeHostAlert("Windsurf")).toEqual({
      variant: "destructive",
      text: "Windsurf needs a native host name or a custom URL override in Settings before it can open the root."
    });
  });

  it("derives workspace status for server, local, and disconnected roots", () => {
    expect(
      deriveWorkspaceStatus({
        snapshot: {
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: true,
          captureDestination: "server",
          captureRootPath: "/tmp/server-root",
          lastError: ""
        },
        rememberedRootState: {
          hasHandle: false,
          permission: "prompt"
        },
        activeScenarioName: "baseline",
        activeTrace: {
          traceId: "trace-server",
          name: "Checkout"
        }
      })
    ).toEqual({
      authority: "server",
      authorityLabel: "Server Root",
      sessionState: "idle",
      sessionLabel: "Idle",
      enabledOriginCount: 1,
      rememberedRootState: { kind: "missing_handle" },
      rememberedRootLabel: "Optional fallback",
      activeSnapshotName: "baseline",
      activeTraceLabel: "Checkout"
    });

    expect(
      deriveWorkspaceStatus({
        snapshot: {
          sessionActive: true,
          attachedTabIds: [4],
          enabledOrigins: [
            "https://app.example.com",
            "https://admin.example.com"
          ],
          rootReady: true,
          captureDestination: "local",
          captureRootPath: "/tmp/local-root",
          lastError: ""
        },
        rememberedRootState: {
          hasHandle: true,
          permission: "granted"
        }
      })
    ).toEqual({
      authority: "browser_root",
      authorityLabel: "Remembered Browser Root",
      sessionState: "active",
      sessionLabel: "Active",
      enabledOriginCount: 2,
      rememberedRootState: { kind: "ready" },
      rememberedRootLabel: "Ready",
      activeSnapshotName: null,
      activeTraceLabel: null
    });

    expect(
      deriveWorkspaceStatus({
        snapshot: {
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: [],
          rootReady: false,
          captureDestination: "none",
          captureRootPath: "",
          lastError: ""
        },
        rememberedRootState: {
          hasHandle: true,
          permission: "prompt"
        },
        activeTrace: {
          traceId: "trace-fallback"
        }
      })
    ).toEqual({
      authority: "none",
      authorityLabel: "No Active Root",
      sessionState: "idle",
      sessionLabel: "Idle",
      enabledOriginCount: 0,
      rememberedRootState: { kind: "permission_required" },
      rememberedRootLabel: "Reconnect Root Directory",
      activeSnapshotName: null,
      activeTraceLabel: "trace-fallback"
    });
  });

  it("derives popup start blocking reasons from workspace status", () => {
    const loadingStatus = deriveWorkspaceStatus({
      snapshot: null,
      captureRootState: { kind: "missing_handle" }
    });
    expect(
      derivePopupStartBlockReason({
        snapshot: null,
        workspaceStatus: loadingStatus
      })
    ).toBeNull();

    const activeStatus = deriveWorkspaceStatus({
      snapshot: {
        sessionActive: true,
        attachedTabIds: [4],
        enabledOrigins: [],
        rootReady: true,
        captureDestination: "local",
        captureRootPath: "/tmp/local-root",
        lastError: ""
      },
      captureRootState: { kind: "ready" }
    });
    expect(
      derivePopupStartBlockReason({
        snapshot: {
          sessionActive: true,
          attachedTabIds: [4],
          enabledOrigins: [],
          rootReady: true,
          captureDestination: "local",
          captureRootPath: "/tmp/local-root",
          lastError: ""
        },
        workspaceStatus: activeStatus
      })
    ).toBeNull();

    const missingOriginsStatus = deriveWorkspaceStatus({
      snapshot: {
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: [],
        rootReady: true,
        captureDestination: "local",
        captureRootPath: "/tmp/local-root",
        lastError: ""
      },
      captureRootState: { kind: "ready" }
    });
    expect(
      derivePopupStartBlockReason({
        snapshot: {
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: [],
          rootReady: true,
          captureDestination: "local",
          captureRootPath: "/tmp/local-root",
          lastError: ""
        },
        workspaceStatus: missingOriginsStatus
      })
    ).toBe("missing_origins");

    const missingRootStatus = deriveWorkspaceStatus({
      snapshot: {
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: ["https://app.example.com"],
        rootReady: false,
        captureDestination: "none",
        captureRootPath: "",
        lastError: ""
      },
      captureRootState: { kind: "permission_required" }
    });
    expect(
      derivePopupStartBlockReason({
        snapshot: {
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: false,
          captureDestination: "none",
          captureRootPath: "",
          lastError: ""
        },
        workspaceStatus: missingRootStatus
      })
    ).toBe("missing_root");

    const missingRootAndOriginsStatus = deriveWorkspaceStatus({
      snapshot: {
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: [],
        rootReady: false,
        captureDestination: "none",
        captureRootPath: "",
        lastError: ""
      },
      captureRootState: { kind: "missing_handle" }
    });
    expect(
      derivePopupStartBlockReason({
        snapshot: {
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: [],
          rootReady: false,
          captureDestination: "none",
          captureRootPath: "",
          lastError: ""
        },
        workspaceStatus: missingRootAndOriginsStatus
      })
    ).toBe("missing_root");
  });

  it("derives readiness for ready, blocked, and live workspace states", () => {
    const readyServerStatus = deriveWorkspaceStatus({
      snapshot: {
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: ["https://app.example.com"],
        rootReady: true,
        captureDestination: "server",
        captureRootPath: "/tmp/server-root",
        lastError: ""
      },
      rememberedRootState: {
        hasHandle: false,
        permission: "prompt"
      }
    });
    expect(
      deriveWorkspaceReadiness({
        snapshot: {
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: true,
          captureDestination: "server",
          captureRootPath: "/tmp/server-root",
          lastError: ""
        },
        workspaceStatus: readyServerStatus,
        editorLaunchState: deriveEditorLaunchState(
          DEFAULT_NATIVE_HOST_CONFIG,
          "cursor"
        ),
        editorLabel: "Cursor"
      })
    ).toMatchObject({
      canStartCapture: true,
      startBlockReason: null,
      primaryNextAction: "start_session",
      primaryNextActionLabel: "Ready",
      primaryNextActionVariant: "success",
      summaryText: "Ready to start capture in Server Root.",
      openActionHint: "Open in Cursor uses Server Root."
    });

    const localStatus = deriveWorkspaceStatus({
      snapshot: {
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: ["https://app.example.com"],
        rootReady: true,
        captureDestination: "local",
        captureRootPath: "/tmp/local-root",
        lastError: ""
      },
      rememberedRootState: {
        hasHandle: true,
        permission: "granted"
      }
    });
    expect(
      deriveWorkspaceReadiness({
        snapshot: {
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: true,
          captureDestination: "local",
          captureRootPath: "/tmp/local-root",
          lastError: ""
        },
        workspaceStatus: localStatus,
        editorLaunchState: deriveEditorLaunchState(
          DEFAULT_NATIVE_HOST_CONFIG,
          "cursor"
        ),
        editorLabel: "Cursor"
      })
    ).toMatchObject({
      canStartCapture: true,
      primaryNextAction: "start_session",
      summaryText: "Ready to start capture in Remembered Browser Root.",
      openActionHint: "Open in Cursor uses Remembered Browser Root."
    });

    const missingRootStatus = deriveWorkspaceStatus({
      snapshot: {
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: [],
        rootReady: false,
        captureDestination: "none",
        captureRootPath: "",
        lastError: ""
      },
      rememberedRootState: {
        hasHandle: true,
        permission: "prompt"
      }
    });
    expect(
      deriveWorkspaceReadiness({
        snapshot: {
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: [],
          rootReady: false,
          captureDestination: "none",
          captureRootPath: "",
          lastError: ""
        },
        workspaceStatus: missingRootStatus,
        editorLaunchState: deriveEditorLaunchState(
          DEFAULT_NATIVE_HOST_CONFIG,
          "cursor"
        ),
        editorLabel: "Cursor"
      })
    ).toMatchObject({
      canStartCapture: false,
      startBlockReason: "missing_root",
      primaryNextAction: "reconnect_root",
      primaryNextActionLabel: "Next",
      primaryNextActionVariant: "destructive",
      summaryText: "Next: Reconnect Root Directory in Settings."
    });

    const missingOriginsStatus = deriveWorkspaceStatus({
      snapshot: {
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: [],
        rootReady: true,
        captureDestination: "local",
        captureRootPath: "/tmp/local-root",
        lastError: ""
      },
      rememberedRootState: {
        hasHandle: true,
        permission: "granted"
      }
    });
    expect(
      deriveWorkspaceReadiness({
        snapshot: {
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: [],
          rootReady: true,
          captureDestination: "local",
          captureRootPath: "/tmp/local-root",
          lastError: ""
        },
        workspaceStatus: missingOriginsStatus,
        editorLaunchState: deriveEditorLaunchState(
          DEFAULT_NATIVE_HOST_CONFIG,
          "cursor"
        ),
        editorLabel: "Cursor"
      })
    ).toMatchObject({
      canStartCapture: false,
      startBlockReason: "missing_origins",
      primaryNextAction: "add_origin",
      summaryText: "Next: Add your first origin in Settings."
    });

    const activeStatus = deriveWorkspaceStatus({
      snapshot: {
        sessionActive: true,
        attachedTabIds: [4],
        enabledOrigins: ["https://app.example.com"],
        rootReady: true,
        captureDestination: "local",
        captureRootPath: "/tmp/local-root",
        lastError: ""
      },
      rememberedRootState: {
        hasHandle: true,
        permission: "granted"
      }
    });
    expect(
      deriveWorkspaceReadiness({
        snapshot: {
          sessionActive: true,
          attachedTabIds: [4],
          enabledOrigins: ["https://app.example.com"],
          rootReady: true,
          captureDestination: "local",
          captureRootPath: "/tmp/local-root",
          lastError: ""
        },
        workspaceStatus: activeStatus,
        editorLaunchState: deriveEditorLaunchState(
          DEFAULT_NATIVE_HOST_CONFIG,
          "cursor"
        ),
        editorLabel: "Cursor"
      })
    ).toMatchObject({
      canStartCapture: false,
      primaryNextAction: "session_active",
      primaryNextActionLabel: "Live",
      primaryNextActionVariant: "success",
      summaryText: "Capture is active in Remembered Browser Root."
    });
  });

  it("derives editor readiness items for server, local, and no-root contexts", () => {
    const serverReadiness = deriveWorkspaceReadiness({
      snapshot: {
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: ["https://app.example.com"],
        rootReady: true,
        captureDestination: "server",
        captureRootPath: "/tmp/server-root",
        lastError: ""
      },
      workspaceStatus: deriveWorkspaceStatus({
        snapshot: {
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: true,
          captureDestination: "server",
          captureRootPath: "/tmp/server-root",
          lastError: ""
        },
        rememberedRootState: {
          hasHandle: false,
          permission: "prompt"
        }
      }),
      editorLaunchState: deriveEditorLaunchState(
        DEFAULT_NATIVE_HOST_CONFIG,
        "cursor"
      ),
      editorLabel: "Cursor"
    });
    expect(serverReadiness.items[2]).toMatchObject({
      label: "Open in Cursor",
      value: "Uses Server Root",
      state: "ready"
    });

    const promptReadiness = deriveWorkspaceReadiness({
      snapshot: {
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: ["https://app.example.com"],
        rootReady: true,
        captureDestination: "local",
        captureRootPath: "/tmp/local-root",
        lastError: ""
      },
      workspaceStatus: deriveWorkspaceStatus({
        snapshot: {
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: true,
          captureDestination: "local",
          captureRootPath: "/tmp/local-root",
          lastError: ""
        },
        rememberedRootState: {
          hasHandle: true,
          permission: "granted"
        }
      }),
      editorLaunchState: deriveEditorLaunchState(
        DEFAULT_NATIVE_HOST_CONFIG,
        "cursor"
      ),
      editorLabel: "Cursor"
    });
    expect(promptReadiness.items[2]).toMatchObject({
      value: "Prompt handoff",
      state: "ready"
    });

    const missingRootReadiness = deriveWorkspaceReadiness({
      snapshot: {
        sessionActive: false,
        attachedTabIds: [],
        enabledOrigins: ["https://app.example.com"],
        rootReady: false,
        captureDestination: "none",
        captureRootPath: "",
        lastError: ""
      },
      workspaceStatus: deriveWorkspaceStatus({
        snapshot: {
          sessionActive: false,
          attachedTabIds: [],
          enabledOrigins: ["https://app.example.com"],
          rootReady: false,
          captureDestination: "none",
          captureRootPath: "",
          lastError: ""
        },
        rememberedRootState: {
          hasHandle: false,
          permission: "prompt"
        }
      }),
      editorLaunchState: deriveEditorLaunchState(
        DEFAULT_NATIVE_HOST_CONFIG,
        "cursor"
      ),
      editorLabel: "Cursor"
    });
    expect(missingRootReadiness.items[2]).toMatchObject({
      value: "Waiting on root",
      state: "needs_attention"
    });
  });

  it("resolves popup alerts by precedence", () => {
    const editorLaunchState = deriveEditorLaunchState(
      DEFAULT_NATIVE_HOST_CONFIG,
      "cursor"
    );
    const baseSnapshot = {
      sessionActive: false,
      attachedTabIds: [],
      enabledOrigins: ["https://app.example.com"],
      rootReady: true,
      captureDestination: "local" as const,
      captureRootPath: "/tmp/fixtures",
      lastError: ""
    };

    const cases = [
      {
        name: "loading state without a snapshot",
        input: {
          snapshot: null,
          captureRootState: { kind: "ready" as const },
          editorLaunchState
        },
        expected: {
          variant: "default" as const,
          text: "Checking workspace status..."
        }
      },
      {
        name: "last error before other idle states",
        input: {
          snapshot: {
            ...baseSnapshot,
            lastError: "Debugger attach failed."
          },
          captureRootState: { kind: "ready" as const },
          editorLaunchState
        },
        expected: {
          variant: "destructive" as const,
          text: "Debugger attach failed."
        }
      },
      {
        name: "missing enabled origins",
        input: {
          snapshot: {
            ...baseSnapshot,
            enabledOrigins: []
          },
          captureRootState: { kind: "ready" as const },
          editorLaunchState
        },
        expected: {
          variant: "default" as const,
          text: "Add your first origin in Settings before starting capture."
        }
      },
      {
        name: "missing root access before idle state",
        input: {
          snapshot: {
            ...baseSnapshot,
            rootReady: false,
            captureDestination: "none" as const
          },
          captureRootState: { kind: "permission_required" as const },
          editorLaunchState
        },
        expected: {
          variant: "destructive" as const,
          text: "Reconnect Root Directory in Settings before starting capture."
        }
      }
    ];

    for (const testCase of cases) {
      expect(resolvePopupAlert(testCase.input)).toEqual(testCase.expected);
    }
  });

  it("returns no popup alert when the status strip is enough", () => {
    const snapshot = {
      sessionActive: false,
      attachedTabIds: [],
      enabledOrigins: ["https://app.example.com"],
      rootReady: true,
      captureDestination: "local" as const,
      captureRootPath: "/tmp/fixtures",
      lastError: ""
    };
    const editorLaunchState = deriveEditorLaunchState(
      DEFAULT_NATIVE_HOST_CONFIG,
      "cursor"
    );

    expect(
      resolvePopupAlert({
        snapshot,
        captureRootState: { kind: "ready" },
        editorLaunchState
      })
    ).toBeNull();

    expect(
      resolvePopupAlert({
        snapshot: {
          ...snapshot,
          captureDestination: "server"
        },
        captureRootState: { kind: "missing_handle" },
        editorLaunchState
      })
    ).toBeNull();
  });

  it("keeps popup launch errors click-driven", () => {
    const snapshot = {
      sessionActive: false,
      attachedTabIds: [],
      enabledOrigins: ["https://app.example.com"],
      rootReady: true,
      captureDestination: "local" as const,
      captureRootPath: "/tmp/fixtures",
      lastError: ""
    };
    const editorLaunchState = deriveEditorLaunchState(
      DEFAULT_NATIVE_HOST_CONFIG,
      "cursor"
    );

    expect(
      resolvePopupAlert({
        snapshot,
        captureRootState: { kind: "ready" },
        editorLaunchState
      })
    ).toBeNull();

    expect(
      resolvePopupAlert({
        snapshot,
        captureRootState: { kind: "ready" },
        editorLaunchState,
        actionDiagnostic: createMissingLaunchPathAlert("Cursor")
      })
    ).toEqual({
      variant: "destructive",
      text: "Set the absolute editor launch path in Settings to open Remembered Browser Root in Cursor. Chrome does not expose local folder paths from the directory picker."
    });
  });
});
