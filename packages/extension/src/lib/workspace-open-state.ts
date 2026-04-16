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

export type PrimaryNextAction =
  | "checking"
  | "choose_root"
  | "reconnect_root"
  | "add_origin"
  | "start_session"
  | "session_active";

export interface WorkspaceReadinessItem {
  id: "active_root" | "enabled_origins" | "open_in_editor" | "current_session";
  label: string;
  value: string;
  state: "ready" | "needs_attention" | "info";
  text: string;
}

export interface WorkspaceReadiness {
  canStartCapture: boolean;
  startBlockReason: PopupStartBlockReason;
  primaryNextAction: PrimaryNextAction;
  primaryNextActionLabel: string;
  primaryNextActionText: string;
  primaryNextActionVariant: PopupAlertState["variant"];
  summaryText: string;
  openActionHint: string;
  items: WorkspaceReadinessItem[];
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

  if (workspaceStatus.authority === "none") {
    return "missing_root";
  }

  if (!workspaceStatus.enabledOriginCount) {
    return "missing_origins";
  }

  return null;
}

function buildRootReadinessItem(
  workspaceStatus: WorkspaceStatus
): WorkspaceReadinessItem {
  if (workspaceStatus.authority === "server") {
    return {
      id: "active_root",
      label: "Active Root",
      value: "Server Root",
      state: "ready",
      text: "Capture is using Server Root right now."
    };
  }

  if (workspaceStatus.authority === "browser_root") {
    return {
      id: "active_root",
      label: "Active Root",
      value: "Remembered Browser Root",
      state: "ready",
      text: "Capture is using Remembered Browser Root right now."
    };
  }

  return {
    id: "active_root",
    label: "Active Root",
    value: "No Active Root",
    state: "needs_attention",
    text:
      workspaceStatus.rememberedRootState.kind === "permission_required"
        ? "Reconnect Root Directory to restore Remembered Browser Root."
        : "Choose Root Directory to set Remembered Browser Root."
  };
}

function buildOriginReadinessItem(
  workspaceStatus: WorkspaceStatus
): WorkspaceReadinessItem {
  return workspaceStatus.enabledOriginCount > 0
    ? {
        id: "enabled_origins",
        label: "Enabled Origins",
        value: `${workspaceStatus.enabledOriginCount} enabled`,
        state: "ready",
        text:
          workspaceStatus.enabledOriginCount === 1
            ? "Capture can use this origin right now."
            : "Capture can use these origins right now."
      }
    : {
        id: "enabled_origins",
        label: "Enabled Origins",
        value: "0 enabled",
        state: "needs_attention",
        text: "Add your first origin below."
      };
}

function buildEditorReadinessItem({
  workspaceStatus,
  editorLaunchState,
  editorLabel
}: {
  workspaceStatus: WorkspaceStatus;
  editorLaunchState?: EditorLaunchState | null;
  editorLabel: string;
}): WorkspaceReadinessItem {
  if (workspaceStatus.authority === "none") {
    return {
      id: "open_in_editor",
      label: `Open in ${editorLabel}`,
      value: "Waiting on root",
      state: "needs_attention",
      text: `Choose or reconnect a root before opening it in ${editorLabel}.`
    };
  }

  if (workspaceStatus.authority === "server") {
    return {
      id: "open_in_editor",
      label: `Open in ${editorLabel}`,
      value: "Uses Server Root",
      state: "ready",
      text: `Open in ${editorLabel} will target Server Root.`
    };
  }

  if (!editorLaunchState) {
    return {
      id: "open_in_editor",
      label: `Open in ${editorLabel}`,
      value: "Checking…",
      state: "info",
      text: "Loading launch settings."
    };
  }

  if (editorLaunchState.kind === "missing_launch_path") {
    return {
      id: "open_in_editor",
      label: `Open in ${editorLabel}`,
      value: "Needs launch path",
      state: "needs_attention",
      text: "Set Shared Editor Launch Path in Advanced Native Host to open Remembered Browser Root directly."
    };
  }

  if (editorLaunchState.kind === "missing_native_host") {
    return {
      id: "open_in_editor",
      label: `Open in ${editorLabel}`,
      value: "Needs host or URL override",
      state: "needs_attention",
      text: "Add a native host name or a custom URL override in Advanced Native Host."
    };
  }

  if (editorLaunchState.kind === "ready_via_url_app") {
    return {
      id: "open_in_editor",
      label: `Open in ${editorLabel}`,
      value: "Prompt handoff",
      state: "ready",
      text: `Open in ${editorLabel} can launch and send the workspace brief even without a direct local-folder path.`
    };
  }

  if (editorLaunchState.kind === "verification_required") {
    return {
      id: "open_in_editor",
      label: `Open in ${editorLabel}`,
      value: "Ready",
      state: "ready",
      text: `Open in ${editorLabel} will verify the helper on first use if needed.`
    };
  }

  return {
    id: "open_in_editor",
    label: `Open in ${editorLabel}`,
    value: "Uses Remembered Browser Root",
    state: "ready",
    text: `Open in ${editorLabel} will use Remembered Browser Root.`
  };
}

function buildSessionReadinessItem({
  snapshot,
  workspaceStatus,
  startBlockReason
}: {
  snapshot: SessionSnapshot | null;
  workspaceStatus: WorkspaceStatus;
  startBlockReason: PopupStartBlockReason;
}): WorkspaceReadinessItem {
  if (!snapshot) {
    return {
      id: "current_session",
      label: "Current Session",
      value: "Loading…",
      state: "info",
      text: "Checking workspace status."
    };
  }

  if (snapshot.sessionActive) {
    return {
      id: "current_session",
      label: "Current Session",
      value: "Active",
      state: "ready",
      text: `Capture is active in ${workspaceStatus.authorityLabel}.`
    };
  }

  if (startBlockReason === "missing_origins") {
    return {
      id: "current_session",
      label: "Current Session",
      value: "Idle",
      state: "needs_attention",
      text: "Add your first origin before starting capture."
    };
  }

  if (startBlockReason === "missing_root") {
    return {
      id: "current_session",
      label: "Current Session",
      value: "Idle",
      state: "needs_attention",
      text:
        workspaceStatus.rememberedRootState.kind === "permission_required"
          ? "Reconnect Root Directory before starting capture."
          : "Choose Root Directory before starting capture."
    };
  }

  return {
    id: "current_session",
    label: "Current Session",
    value: "Idle",
    state: "ready",
    text: "Start Session from the popup when you're ready."
  };
}

export function deriveWorkspaceReadiness({
  snapshot,
  workspaceStatus,
  editorLaunchState,
  editorLabel = "Cursor"
}: {
  snapshot: SessionSnapshot | null;
  workspaceStatus: WorkspaceStatus;
  editorLaunchState?: EditorLaunchState | null;
  editorLabel?: string;
}): WorkspaceReadiness {
  const startBlockReason = derivePopupStartBlockReason({
    snapshot,
    workspaceStatus
  });
  const openActionHint =
    workspaceStatus.authority === "server"
      ? `Open in ${editorLabel} uses Server Root.`
      : workspaceStatus.authority === "browser_root"
        ? `Open in ${editorLabel} uses Remembered Browser Root.`
        : "Choose Root Directory in Settings to give WraithWalker a remembered workspace.";

  let primaryNextAction: PrimaryNextAction;
  let primaryNextActionLabel: string;
  let primaryNextActionText: string;
  let primaryNextActionVariant: PopupAlertState["variant"];
  let summaryText: string;

  if (!snapshot) {
    primaryNextAction = "checking";
    primaryNextActionLabel = "Checking";
    primaryNextActionText = "Checking which workspace is active right now.";
    primaryNextActionVariant = "default";
    summaryText = "Checking workspace status...";
  } else if (snapshot.sessionActive) {
    primaryNextAction = "session_active";
    primaryNextActionLabel = "Live";
    primaryNextActionText = `Capture is active in ${workspaceStatus.authorityLabel}.`;
    primaryNextActionVariant = "success";
    summaryText = `Capture is active in ${workspaceStatus.authorityLabel}.`;
  } else if (startBlockReason === "missing_origins") {
    primaryNextAction = "add_origin";
    primaryNextActionLabel = "Next";
    primaryNextActionText = "Add your first origin so capture can start.";
    primaryNextActionVariant = "default";
    summaryText = "Next: Add your first origin in Settings.";
  } else if (startBlockReason === "missing_root") {
    const permissionRequired =
      workspaceStatus.rememberedRootState.kind === "permission_required";
    primaryNextAction = permissionRequired ? "reconnect_root" : "choose_root";
    primaryNextActionLabel = "Next";
    primaryNextActionText = permissionRequired
      ? "Reconnect Root Directory so the Remembered Browser Root can be used again."
      : "Choose Root Directory so WraithWalker has a remembered browser workspace.";
    primaryNextActionVariant = permissionRequired ? "destructive" : "default";
    summaryText = permissionRequired
      ? "Next: Reconnect Root Directory in Settings."
      : "Next: Choose Root Directory in Settings.";
  } else {
    primaryNextAction = "start_session";
    primaryNextActionLabel = "Ready";
    primaryNextActionText = `Capture is ready in ${workspaceStatus.authorityLabel}. Start Session from the popup when you're ready.`;
    primaryNextActionVariant = "success";
    summaryText = `Ready to start capture in ${workspaceStatus.authorityLabel}.`;
  }

  return {
    canStartCapture:
      snapshot !== null && !snapshot.sessionActive && startBlockReason === null,
    startBlockReason,
    primaryNextAction,
    primaryNextActionLabel,
    primaryNextActionText,
    primaryNextActionVariant,
    summaryText,
    openActionHint,
    items: [
      buildRootReadinessItem(workspaceStatus),
      buildOriginReadinessItem(workspaceStatus),
      buildEditorReadinessItem({
        workspaceStatus,
        editorLaunchState,
        editorLabel
      }),
      buildSessionReadinessItem({
        snapshot,
        workspaceStatus,
        startBlockReason
      })
    ]
  };
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
  if (actionDiagnostic) {
    return actionDiagnostic;
  }

  const workspaceStatus = deriveWorkspaceStatus({
    snapshot,
    captureRootState
  });
  const readiness = deriveWorkspaceReadiness({
    snapshot,
    workspaceStatus,
    editorLaunchState,
    editorLabel: editorLaunchState.editorLabel
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

  if (readiness.startBlockReason === "missing_origins") {
    return {
      variant: "default",
      text: "Add your first origin in Settings before starting capture."
    };
  }

  if (readiness.startBlockReason === "missing_root") {
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
