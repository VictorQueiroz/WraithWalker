import * as React from "react";

import type {
  BackgroundMessage,
  ErrorResult,
  NativeOpenResult
} from "../lib/messages.js";
import type { NativeHostConfig, SessionSnapshot } from "../lib/types.js";
import {
  deriveCaptureRootState,
  deriveEditorLaunchState,
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
import { Alert, Button } from "./components.js";

interface RuntimeApi {
  sendMessage(message: BackgroundMessage): Promise<unknown>;
  openOptionsPage(): void;
}

export interface PopupAppProps {
  runtime: RuntimeApi;
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
  runtime: RuntimeApi,
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
      const nextSnapshot = await refreshState(false);
      const openedServerRoot =
        nextSnapshot?.captureDestination === "server" ||
        snapshot?.captureDestination === "server";
      setActionAlert({
        variant: result.ok ? "success" : "destructive",
        text: result.ok
          ? openedServerRoot
            ? `Opened ${preferredEditor.label} at the server root.`
            : `Opened ${preferredEditor.label} and sent the fixture brief to Cursor Chat.`
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
          ? "Opened the server root in the OS file manager."
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
    <main className="min-w-[360px] p-4">
      <div className="extension-shell">
        <div className="extension-panel grid gap-4 p-5">
          <div className="space-y-2">
            <h1 className="text-lg font-semibold tracking-tight">
              WraithWalker
            </h1>
            <p className="text-sm text-muted-foreground">
              Start capture, open the remembered root, or jump straight to
              Settings.
            </p>
            {snapshot?.captureDestination === "server" ? (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-emerald-600">
                    Connected.
                  </span>{" "}
                  Using local WraithWalker server root.
                </p>
                <p className="text-xs break-all text-muted-foreground">
                  {snapshot.captureRootPath}
                </p>
              </div>
            ) : null}
          </div>

          <Alert variant={alert.variant}>{alert.text}</Alert>

          <div className="grid gap-3">
            <Button
              type="button"
              disabled={busyAction !== null}
              onClick={handleToggleSession}
            >
              {snapshot?.sessionActive ? "Stop Session" : "Start Session"}
            </Button>
            <Button
              type="button"
              variant="secondary"
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
                disabled={busyAction !== null}
                onClick={handleRevealFolder}
              >
                {busyAction === "reveal" ? "Opening..." : "Open in folder"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              onClick={() => runtime.openOptionsPage()}
            >
              Settings
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
