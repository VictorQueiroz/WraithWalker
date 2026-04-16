import * as React from "react";

import type {
  BackgroundMessage,
  ErrorResult,
  NativeOpenResult
} from "../lib/messages.js";
import type { PopupRuntimeApi } from "../lib/chrome-api.js";
import type { NativeHostConfig, SessionSnapshot } from "../lib/types.js";
import {
  deriveCaptureRootState,
  deriveEditorLaunchState,
  deriveWorkspaceReadiness,
  deriveWorkspaceStatus,
  resolvePopupAlert,
  type CaptureRootState,
  type PopupAlertState
} from "../lib/workspace-open-state.js";
import {
  DEFAULT_EDITOR_ID,
  DEFAULT_NATIVE_HOST_CONFIG,
  EDITOR_PRESETS,
  POPUP_REFRESH_INTERVAL_MS,
  type EditorPreset
} from "../lib/constants.js";
import { cn } from "./lib/cn.js";
import { Alert, Button } from "./components.js";

export interface PopupAppProps {
  runtime: PopupRuntimeApi;
  getNativeHostConfig: () => Promise<NativeHostConfig>;
  getPreferredEditorId?: () => Promise<string>;
  loadStoredRootHandle: () => Promise<FileSystemDirectoryHandle | undefined>;
  queryRootPermission: (
    rootHandle?: FileSystemDirectoryHandle | null
  ) => Promise<PermissionState>;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  refreshIntervalMs?: number;
  editorPresets?: EditorPreset[];
}

function getErrorMessage(result: { error?: string }): string {
  return result.error || "Unknown error.";
}

function sendMessage<T>(
  runtime: PopupRuntimeApi,
  message: BackgroundMessage
): Promise<T> {
  return runtime.sendMessage(message) as Promise<T>;
}

function resolvePreferredEditor(
  editorId: string,
  editorPresets: EditorPreset[]
): EditorPreset {
  return (
    editorPresets.find((preset) => preset.id === editorId) ??
    editorPresets.find((preset) => preset.id === DEFAULT_EDITOR_ID) ??
    editorPresets[0]
  );
}

function resolvePopupSummaryText({
  snapshot,
  captureRootState,
  startBlockReason
}: {
  snapshot: SessionSnapshot | null;
  captureRootState: CaptureRootState;
  startBlockReason: ReturnType<typeof deriveWorkspaceReadiness>["startBlockReason"];
}): string | null {
  if (!snapshot) {
    return "Checking workspace status...";
  }

  if (snapshot.sessionActive) {
    return "Capture is active.";
  }

  if (startBlockReason === "missing_origins") {
    return "Next: Add your first origin in Settings.";
  }

  if (startBlockReason === "missing_root") {
    return null;
  }

  return "Ready to start capture.";
}

function resolvePopupOpenHint({
  editorLabel,
  startBlockReason
}: {
  editorLabel: string;
  startBlockReason: ReturnType<typeof deriveWorkspaceReadiness>["startBlockReason"];
}): string | null {
  if (startBlockReason === "missing_root") {
    return null;
  }

  return `Open in ${editorLabel} to jump into the workspace.`;
}

export function PopupApp({
  runtime,
  getNativeHostConfig,
  loadStoredRootHandle,
  queryRootPermission,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  refreshIntervalMs = POPUP_REFRESH_INTERVAL_MS,
  editorPresets = EDITOR_PRESETS
}: PopupAppProps) {
  const [snapshot, setSnapshot] = React.useState<SessionSnapshot | null>(null);
  const [nativeHostConfig, setNativeHostConfig] =
    React.useState<NativeHostConfig>(DEFAULT_NATIVE_HOST_CONFIG);
  const [captureRootState, setCaptureRootState] =
    React.useState<CaptureRootState>({ kind: "missing_handle" });
  const [actionAlert, setActionAlert] = React.useState<PopupAlertState | null>(
    null
  );
  const [busyAction, setBusyAction] = React.useState<
    "toggle" | "open" | "reveal" | null
  >(null);
  const preferredEditor = React.useMemo(
    () => resolvePreferredEditor(DEFAULT_EDITOR_ID, editorPresets),
    [editorPresets]
  );
  const editorLaunchState = React.useMemo(
    () => deriveEditorLaunchState(nativeHostConfig, preferredEditor.id),
    [nativeHostConfig, preferredEditor.id]
  );
  const workspaceStatus = React.useMemo(
    () =>
      deriveWorkspaceStatus({
        snapshot,
        captureRootState
      }),
    [captureRootState, snapshot]
  );
  const workspaceReadiness = React.useMemo(
    () =>
      deriveWorkspaceReadiness({
        snapshot,
        workspaceStatus,
        editorLaunchState,
        editorLabel: preferredEditor.label
      }),
    [editorLaunchState, preferredEditor.label, snapshot, workspaceStatus]
  );
  const popupSummaryText = React.useMemo(
    () =>
      resolvePopupSummaryText({
        snapshot,
        captureRootState,
        startBlockReason: workspaceReadiness.startBlockReason
      }),
    [captureRootState, snapshot, workspaceReadiness.startBlockReason]
  );
  const popupOpenHint = React.useMemo(
    () =>
      resolvePopupOpenHint({
        editorLabel: preferredEditor.label,
        startBlockReason: workspaceReadiness.startBlockReason
      }),
    [preferredEditor.label, workspaceReadiness.startBlockReason]
  );

  const refreshEnvironment = React.useCallback(async () => {
    const [nextNativeHostConfig, rootHandle] = await Promise.all([
      getNativeHostConfig(),
      loadStoredRootHandle()
    ]);
    const permission = rootHandle
      ? await queryRootPermission(rootHandle)
      : "prompt";
    const nextCaptureRootState = deriveCaptureRootState({
      hasHandle: Boolean(rootHandle),
      permission
    });

    setNativeHostConfig(nextNativeHostConfig);
    setCaptureRootState(nextCaptureRootState);

    return {
      nativeHostConfig: nextNativeHostConfig,
      captureRootState: nextCaptureRootState
    };
  }, [getNativeHostConfig, loadStoredRootHandle, queryRootPermission]);

  const refreshState = React.useCallback(
    async (clearActionAlert = true) => {
      const nextSnapshot = await sendMessage<SessionSnapshot>(runtime, {
        type: "session.getState"
      });
      setSnapshot(nextSnapshot);
      if (clearActionAlert) {
        setActionAlert(null);
      }
      return nextSnapshot;
    },
    [runtime]
  );

  React.useEffect(() => {
    let active = true;
    void Promise.all([refreshEnvironment(), refreshState()]).then(() => {
      if (!active) {
        return;
      }
    });

    const intervalId = setIntervalFn(() => {
      void refreshState();
    }, refreshIntervalMs);

    return () => {
      active = false;
      clearIntervalFn(intervalId);
    };
  }, [
    clearIntervalFn,
    refreshEnvironment,
    refreshIntervalMs,
    refreshState,
    setIntervalFn
  ]);

  const alert = resolvePopupAlert({
    snapshot,
    captureRootState,
    editorLaunchState,
    actionDiagnostic: actionAlert
  });
  const startButtonDisabled =
    busyAction !== null ||
    (!snapshot?.sessionActive && workspaceReadiness.startBlockReason !== null);

  async function handleToggleSession() {
    setBusyAction("toggle");
    try {
      const currentSnapshot =
        snapshot ??
        (await sendMessage<SessionSnapshot>(runtime, {
          type: "session.getState"
        }));
      const nextSnapshot = await sendMessage<SessionSnapshot>(runtime, {
        type: currentSnapshot.sessionActive ? "session.stop" : "session.start"
      });
      setSnapshot(nextSnapshot);
      setActionAlert(null);
    } catch (error) {
      setActionAlert({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleOpenEditor() {
    setBusyAction("open");
    try {
      await refreshEnvironment();

      const result = await sendMessage<NativeOpenResult>(runtime, {
        type: "native.open",
        editorId: DEFAULT_EDITOR_ID
      });
      await refreshState(false);
      setActionAlert({
        variant: result.ok ? "success" : "destructive",
        text: result.ok
          ? `Opened ${preferredEditor.label} for the current workspace.`
          : getErrorMessage(result as ErrorResult)
      });
    } catch (error) {
      setActionAlert({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRevealFolder() {
    setBusyAction("reveal");
    try {
      const result = await sendMessage<NativeOpenResult>(runtime, {
        type: "native.revealRoot"
      });
      await refreshState(false);
      setActionAlert({
        variant: result.ok ? "success" : "destructive",
        text: result.ok
          ? "Opened the workspace folder in the OS file manager."
          : getErrorMessage(result as ErrorResult)
      });
    } catch (error) {
      setActionAlert({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="w-[380px] p-3">
      <div className="extension-shell">
        <div className="extension-panel grid gap-2.5 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h1 className="text-base font-semibold tracking-tight">
                WraithWalker
              </h1>
              <p className="text-xs leading-5 text-muted-foreground">
                Capture, open the active workspace, or jump to Settings.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
              onClick={() => runtime.openOptionsPage()}
            >
              Settings
            </Button>
          </div>

          <div className="grid gap-2" aria-label="Workspace status">
            <div
              className={cn(
                "flex min-h-12 items-center justify-between rounded-lg border border-border/70 bg-card/70 px-2.5 py-2",
                workspaceStatus.enabledOriginCount === 0 && "text-muted-foreground"
              )}
            >
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Origins
              </span>
              <span className="text-[13px] leading-4 font-medium text-foreground">
                {workspaceStatus.enabledOriginCount} enabled
              </span>
            </div>
            {popupSummaryText ? (
              <div className="flex min-h-12 items-center rounded-lg border border-border/70 bg-card/70 px-2.5 py-2 text-[13px] leading-4 font-medium text-foreground">
                {popupSummaryText}
              </div>
            ) : null}
          </div>

          {alert ? <Alert variant={alert.variant}>{alert.text}</Alert> : null}

          <div className="grid gap-1.5">
            <Button
              type="button"
              disabled={startButtonDisabled}
              className="rounded-lg"
              onClick={handleToggleSession}
            >
              {snapshot?.sessionActive ? "Stop Session" : "Start Session"}
            </Button>
            <div
              className={`grid gap-1.5 ${
                snapshot?.captureDestination === "server"
                  ? "grid-cols-2"
                  : "grid-cols-1"
              }`}
            >
              <Button
                type="button"
                variant="secondary"
                className="rounded-lg"
                disabled={busyAction !== null}
                onClick={handleOpenEditor}
              >
                {busyAction === "open"
                  ? "Opening..."
                  : `Open in ${preferredEditor.label}`}
              </Button>
              {snapshot?.captureDestination === "server" ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="rounded-lg"
                  disabled={busyAction !== null}
                  onClick={handleRevealFolder}
                >
                  {busyAction === "reveal" ? "Opening..." : "Open in folder"}
                </Button>
              ) : null}
            </div>
            {popupOpenHint ? (
              <p className="flex min-h-8 items-center text-[11px] leading-4 text-muted-foreground">
                {popupOpenHint}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
