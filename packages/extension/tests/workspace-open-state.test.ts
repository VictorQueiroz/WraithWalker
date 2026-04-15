import { describe, expect, it, vi } from "vitest";

import { DEFAULT_NATIVE_HOST_CONFIG } from "../src/lib/constants.js";
import { normalizeNativeHostConfig } from "../src/lib/editor-launch.js";
import {
  createMissingLaunchPathAlert,
  createMissingNativeHostAlert,
  deriveCaptureRootState,
  deriveEditorLaunchState,
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
          text: "Loading session state..."
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
          text: "Add at least one origin in Settings before starting a capture session."
        }
      },
      {
        name: "missing root access before idle state",
        input: {
          snapshot: {
            ...baseSnapshot,
            rootReady: false
          },
          captureRootState: { kind: "permission_required" as const },
          editorLaunchState
        },
        expected: {
          variant: "destructive" as const,
          text: "Reconnect the WraithWalker root directory in Settings before starting or opening the workspace."
        }
      },
      {
        name: "active capture success",
        input: {
          snapshot: {
            ...baseSnapshot,
            sessionActive: true
          },
          captureRootState: { kind: "ready" as const },
          editorLaunchState
        },
        expected: {
          variant: "success" as const,
          text: "Debugger capture and replay are active for all matching tabs."
        }
      },
      {
        name: "idle server-backed state",
        input: {
          snapshot: {
            ...baseSnapshot,
            captureDestination: "server" as const
          },
          captureRootState: { kind: "ready" as const },
          editorLaunchState
        },
        expected: {
          variant: "default" as const,
          text: "Session is idle. Start it when you want matching tabs to capture into the local WraithWalker server root."
        }
      }
    ];

    for (const testCase of cases) {
      expect(resolvePopupAlert(testCase.input)).toEqual(testCase.expected);
    }
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
    ).toEqual({
      variant: "default",
      text: "Session is idle. Start it when you want matching tabs to attach automatically."
    });

    expect(
      resolvePopupAlert({
        snapshot,
        captureRootState: { kind: "ready" },
        editorLaunchState,
        actionDiagnostic: createMissingLaunchPathAlert("Cursor")
      })
    ).toEqual({
      variant: "destructive",
      text: "Set the absolute editor launch path in Settings to open the remembered root in Cursor. Chrome does not expose local folder paths from the directory picker."
    });
  });
});
