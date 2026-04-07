import { DEFAULT_EDITOR_ID } from "./constants.js";
import { resolveEditorLaunch } from "./editor-launch.js";
import type { NativeHostConfig, SessionSnapshot } from "./types.js";

export type CaptureRootState =
  | { kind: "missing_handle" }
  | { kind: "permission_required" }
  | { kind: "ready" };

export type EditorLaunchState =
  | {
      kind: "ready_via_url";
      editorId: string;
      editorLabel: string;
      urlTemplate: string;
      launchPath: string;
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
  const launchPath = nativeHostConfig.launchPath.trim();

  if (launch.urlTemplate.trim()) {
    return launchPath
      ? {
          kind: "ready_via_url",
          editorId: launch.editorId,
          editorLabel: launch.preset.label,
          urlTemplate: launch.urlTemplate.trim(),
          launchPath
        }
      : {
          kind: "missing_launch_path",
          editorId: launch.editorId,
          editorLabel: launch.preset.label
        };
  }

  if (!launchPath) {
    return {
      kind: "missing_launch_path",
      editorId: launch.editorId,
      editorLabel: launch.preset.label
    };
  }

  if (!nativeHostConfig.hostName.trim()) {
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

export function createMissingLaunchPathAlert(editorLabel: string): PopupAlertState {
  return {
    variant: "destructive",
    text: `Set the absolute editor launch path in Settings before opening ${editorLabel}. Chrome does not expose local folder paths from the directory picker.`
  };
}

export function createMissingNativeHostAlert(editorLabel: string): PopupAlertState {
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
}): PopupAlertState {
  void editorLaunchState;

  if (actionDiagnostic) {
    return actionDiagnostic;
  }

  if (!snapshot) {
    return {
      variant: "default",
      text: "Loading session state..."
    };
  }

  if (snapshot.lastError) {
    return {
      variant: "destructive",
      text: snapshot.lastError
    };
  }

  if (!snapshot.enabledOrigins.length) {
    return {
      variant: "default",
      text: "Add at least one origin in Settings before starting a capture session."
    };
  }

  if (captureRootState.kind !== "ready") {
    return {
      variant: "destructive",
      text: "Reconnect the capture root in Settings before starting or opening the workspace."
    };
  }

  if (snapshot.sessionActive) {
    return {
      variant: "success",
      text: "Debugger capture and replay are active for all matching tabs."
    };
  }

  return {
    variant: "default",
    text: "Session is idle. Start it when you want matching tabs to attach automatically."
  };
}
