import { describe, expect, it } from "vitest";

import { DEFAULT_NATIVE_HOST_CONFIG } from "../src/lib/constants.js";
import { normalizeNativeHostConfig } from "../src/lib/editor-launch.js";
import {
  createMissingLaunchPathAlert,
  deriveCaptureRootState,
  deriveEditorLaunchState,
  resolvePopupAlert
} from "../src/lib/workspace-open-state.js";

describe("workspace open state", () => {
  it("derives all capture root states", () => {
    expect(deriveCaptureRootState({ hasHandle: false, permission: "prompt" })).toEqual({ kind: "missing_handle" });
    expect(deriveCaptureRootState({ hasHandle: true, permission: "prompt" })).toEqual({ kind: "permission_required" });
    expect(deriveCaptureRootState({ hasHandle: true, permission: "granted" })).toEqual({ kind: "ready" });
  });

  it("derives all editor launch states", () => {
    expect(deriveEditorLaunchState({
      ...DEFAULT_NATIVE_HOST_CONFIG,
      launchPath: "/tmp/fixtures"
    }, "cursor")).toMatchObject({
      kind: "ready_via_url_root",
      editorId: "cursor",
      launchPath: "/tmp/fixtures"
    });

    expect(deriveEditorLaunchState(DEFAULT_NATIVE_HOST_CONFIG, "cursor")).toEqual({
      kind: "ready_via_url_app",
      editorId: "cursor",
      editorLabel: "Cursor",
      url: "cursor://"
    });

    expect(deriveEditorLaunchState({
      ...DEFAULT_NATIVE_HOST_CONFIG,
      hostName: "",
      launchPath: "/tmp/fixtures"
    }, "windsurf")).toEqual({
      kind: "missing_native_host",
      editorId: "windsurf",
      editorLabel: "Windsurf"
    });

    expect(deriveEditorLaunchState({
      ...DEFAULT_NATIVE_HOST_CONFIG,
      hostName: "com.example.host",
      launchPath: "/tmp/fixtures"
    }, "windsurf")).toMatchObject({
      kind: "verification_required",
      editorId: "windsurf",
      launchPath: "/tmp/fixtures"
    });

    expect(deriveEditorLaunchState({
      ...DEFAULT_NATIVE_HOST_CONFIG,
      hostName: "com.example.host",
      launchPath: "/tmp/fixtures"
    }, "windsurf", { nativeHostVerified: true })).toMatchObject({
      kind: "ready_via_native",
      editorId: "windsurf",
      launchPath: "/tmp/fixtures"
    });

    expect(deriveEditorLaunchState({
      ...DEFAULT_NATIVE_HOST_CONFIG,
      editorLaunchOverrides: {
        cursor: {
          urlTemplate: "cursor://file/$DIR_URI/"
        }
      }
    }, "cursor")).toEqual({
      kind: "missing_launch_path",
      editorId: "cursor",
      editorLabel: "Cursor"
    });
  });

  it("ignores stale persisted native-host diagnostics and migrates legacy rootPath to launchPath", () => {
    expect(normalizeNativeHostConfig({
      hostName: "com.example.host",
      rootPath: "/tmp/fixtures",
      verifiedAt: "2026-04-07T00:00:00.000Z",
      lastVerificationError: "Host not found.",
      lastOpenError: "Open failed."
    }, "cursor")).toEqual({
      ...DEFAULT_NATIVE_HOST_CONFIG,
      hostName: "com.example.host",
      launchPath: "/tmp/fixtures",
      editorLaunchOverrides: {}
    });
  });

  it("keeps popup launch errors click-driven", () => {
    const snapshot = {
      sessionActive: false,
      attachedTabIds: [],
      enabledOrigins: ["https://app.example.com"],
      rootReady: true,
      lastError: ""
    };
    const editorLaunchState = deriveEditorLaunchState(DEFAULT_NATIVE_HOST_CONFIG, "cursor");

    expect(resolvePopupAlert({
      snapshot,
      captureRootState: { kind: "ready" },
      editorLaunchState
    })).toEqual({
      variant: "default",
      text: "Session is idle. Start it when you want matching tabs to attach automatically."
    });

    expect(resolvePopupAlert({
      snapshot,
      captureRootState: { kind: "ready" },
      editorLaunchState,
      actionDiagnostic: createMissingLaunchPathAlert("Cursor")
    })).toEqual({
      variant: "destructive",
      text: "Set the absolute editor launch path in Settings to open the remembered root in Cursor. Chrome does not expose local folder paths from the directory picker."
    });
  });
});
