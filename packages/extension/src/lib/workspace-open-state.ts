import { DEFAULT_EDITOR_ID } from "./constants.js";
import { resolveEditorLaunch } from "./editor-launch.js";
import type { NativeHostConfig, SessionSnapshot } from "./types.js";

export type CaptureRootState =
  | { kind: "missing_handle" }
  | { kind: "permission_required" }
  | { kind: "ready" };

export type EditorLaunchState =
  | {
      kind: "ready_via_url_root";
      editorId: string;
      editorLabel: string;
      urlTemplate: string;
      launchPath: string;
    }
  | {
      kind: "ready_via_url_app";
      editorId: string;
      editorLabel: string;
      url: string;
    }
  | {
      kind: "ready_via_native";
      editorId: string;
      editorLabel: string;
      hostName: string;
      launchPath: string;
      commandTemplate: string;
    }
  | {
      kind: "missing_launch_path";
      editorId: string;
      editorLabel: string;
    }
  | {
      kind: "missing_native_host";
      editorId: string;
      editorLabel: string;
    }
  | {
      kind: "verification_required";
      editorId: string;
      editorLabel: string;
      hostName: string;
      launchPath: string;
      commandTemplate: string;
    };

export interface PopupAlertState {
  variant: "default" | "success" | "destructive";
  text: string;
}

export interface RememberedRootStateInput {
  hasHandle: boolean;
  permission: PermissionState;
}

export interface WorkspaceStatus {
  authority: "server" | "browser_root" | "none";
  authorityLabel: "Server Root" | "Remembered Browser Root" | "No Active Root";
  sessionState: "loading" | "active" | "idle";
  sessionLabel: "Loading…" | "Active" | "Idle";
  enabledOriginCount: number;
  rememberedRootState: CaptureRootState;
  rememberedRootLabel:
    | "Ready"
    | "Choose Root Directory"
    | "Reconnect Root Directory"
    | "Optional fallback";
  activeSnapshotName: string | null;
  activeTraceLabel: string | null;
}

export type PopupStartBlockReason =
  | "loading"
  | "missing_origins"
  | "missing_root"
  | null;

export function deriveCaptureRootState({
  hasHandle,
  permission
}: {
  hasHandle: boolean;
  permission: PermissionState;
}): CaptureRootState {
  if (!hasHandle) {
    return { kind: "missing_handle" };
  }

  if (permission !== "granted") {
    return { kind: "permission_required" };
  }

  return { kind: "ready" };
}

function deriveRememberedRootState(
  captureRootState?: CaptureRootState | null,
  rememberedRootState?: RememberedRootStateInput | null
): CaptureRootState {
  if (captureRootState) {
    return captureRootState;
  }

  if (rememberedRootState) {
    return deriveCaptureRootState(rememberedRootState);
  }

  return { kind: "missing_handle" };
}

export function deriveWorkspaceStatus({
  snapshot,
  captureRootState,
  rememberedRootState,
  activeScenarioName = null,
  activeTrace = null
}: {
  snapshot: SessionSnapshot | null;
  captureRootState?: CaptureRootState | null;
  rememberedRootState?: RememberedRootStateInput | null;
  activeScenarioName?: string | null;
  activeTrace?: { traceId: string; name?: string | null } | null;
}): WorkspaceStatus {
  const authority =
    snapshot?.captureDestination === "server"
      ? "server"
      : snapshot?.captureDestination === "local"
        ? "browser_root"
        : "none";
  const rememberedRoot = deriveRememberedRootState(
    captureRootState,
    rememberedRootState
  );

  return {
    authority,
    authorityLabel:
      authority === "server"
        ? "Server Root"
        : authority === "browser_root"
          ? "Remembered Browser Root"
          : "No Active Root",
    sessionState: !snapshot
      ? "loading"
      : snapshot.sessionActive
        ? "active"
        : "idle",
    sessionLabel: !snapshot
      ? "Loading…"
      : snapshot.sessionActive
        ? "Active"
        : "Idle",
    enabledOriginCount: Array.isArray(snapshot?.enabledOrigins)
      ? snapshot.enabledOrigins.length
      : 0,
    rememberedRootState: rememberedRoot,
    rememberedRootLabel:
      rememberedRoot.kind === "ready"
        ? "Ready"
        : rememberedRoot.kind === "permission_required"
          ? "Reconnect Root Directory"
          : authority === "server"
            ? "Optional fallback"
            : "Choose Root Directory",
    activeSnapshotName: activeScenarioName,
    activeTraceLabel: activeTrace?.name?.trim() || activeTrace?.traceId || null
  };
}

export function derivePopupStartBlockReason({
  snapshot,
  workspaceStatus
}: {
  snapshot: SessionSnapshot | null;
  workspaceStatus: WorkspaceStatus;
}): PopupStartBlockReason {
  if (!snapshot) {
    return null;
  }

  if (snapshot.sessionActive) {
    return null;
  }

  if (!workspaceStatus.enabledOriginCount) {
    return "missing_origins";
  }

  if (workspaceStatus.authority === "none") {
    return "missing_root";
  }

  return null;
}

export function deriveEditorLaunchState(
  nativeHostConfig: NativeHostConfig,
  editorId: string = DEFAULT_EDITOR_ID,
  {
    nativeHostVerified = false
  }: {
    nativeHostVerified?: boolean;
  } = {}
): EditorLaunchState {
  const launch = resolveEditorLaunch(nativeHostConfig, editorId);
  const launchPath =
    typeof nativeHostConfig.launchPath === "string"
      ? nativeHostConfig.launchPath.trim()
      : "";
  const appUrl = launch.appUrl.trim();

  if (launch.urlTemplate.trim()) {
    return launchPath
      ? {
          kind: "ready_via_url_root",
          editorId: launch.editorId,
          editorLabel: launch.preset.label,
          urlTemplate: launch.urlTemplate.trim(),
          launchPath
        }
      : !launch.hasCustomUrlOverride && appUrl
        ? {
            kind: "ready_via_url_app",
            editorId: launch.editorId,
            editorLabel: launch.preset.label,
            url: appUrl
          }
        : {
            kind: "missing_launch_path",
            editorId: launch.editorId,
            editorLabel: launch.preset.label
          };
  }

  if (!launch.hasCustomUrlOverride && appUrl) {
    return {
      kind: "ready_via_url_app",
      editorId: launch.editorId,
      editorLabel: launch.preset.label,
      url: appUrl
    };
  }

  if (!launchPath) {
    return {
      kind: "missing_launch_path",
      editorId: launch.editorId,
      editorLabel: launch.preset.label
    };
  }

  if (
    !(
      typeof nativeHostConfig.hostName === "string" &&
      nativeHostConfig.hostName.trim()
    )
  ) {
    return {
      kind: "missing_native_host",
      editorId: launch.editorId,
      editorLabel: launch.preset.label
    };
  }

  return nativeHostVerified
    ? {
        kind: "ready_via_native",
        editorId: launch.editorId,
        editorLabel: launch.preset.label,
        hostName: nativeHostConfig.hostName.trim(),
        launchPath,
        commandTemplate: launch.commandTemplate
      }
    : {
        kind: "verification_required",
        editorId: launch.editorId,
        editorLabel: launch.preset.label,
        hostName: nativeHostConfig.hostName.trim(),
        launchPath,
        commandTemplate: launch.commandTemplate
      };
}

export function createMissingLaunchPathAlert(
  editorLabel: string
): PopupAlertState {
  return {
    variant: "destructive",
    text: `Set the absolute editor launch path in Settings to open Remembered Browser Root in ${editorLabel}. Chrome does not expose local folder paths from the directory picker.`
  };
}

export function createMissingNativeHostAlert(
  editorLabel: string
): PopupAlertState {
  return {
    variant: "destructive",
    text: `${editorLabel} needs a native host name or a custom URL override in Settings before it can open the root.`
  };
}

export function resolvePopupAlert({
  snapshot,
  captureRootState,
  editorLaunchState,
  actionDiagnostic
}: {
  snapshot: SessionSnapshot | null;
  captureRootState: CaptureRootState;
  editorLaunchState: EditorLaunchState;
  actionDiagnostic?: PopupAlertState | null;
}): PopupAlertState | null {
  void editorLaunchState;

  if (actionDiagnostic) {
    return actionDiagnostic;
  }

  const workspaceStatus = deriveWorkspaceStatus({
    snapshot,
    captureRootState
  });
  const blockReason = derivePopupStartBlockReason({
    snapshot,
    workspaceStatus
  });

  if (!snapshot) {
    return {
      variant: "default",
      text: "Checking workspace status..."
    };
  }

  if (snapshot.lastError) {
    return {
      variant: "destructive",
      text: snapshot.lastError
    };
  }

  if (blockReason === "missing_origins") {
    return {
      variant: "default",
      text: "Add your first origin in Settings before starting capture."
    };
  }

  if (blockReason === "missing_root") {
    return {
      variant:
        captureRootState.kind === "permission_required"
          ? "destructive"
          : "default",
      text:
        captureRootState.kind === "permission_required"
          ? "Reconnect Root Directory in Settings before starting capture."
          : "Choose Root Directory in Settings before starting capture."
    };
  }

  return null;
}
