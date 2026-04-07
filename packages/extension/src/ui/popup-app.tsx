import * as React from "react";

import { DEFAULT_EDITOR_ID, EDITOR_PRESETS, POPUP_REFRESH_INTERVAL_MS, type EditorPreset } from "../lib/constants.js";
import type { BackgroundMessage, ErrorResult, NativeOpenResult } from "../lib/messages.js";
import type { SessionSnapshot } from "../lib/types.js";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components.js";

interface RuntimeApi {
  sendMessage(message: BackgroundMessage): Promise<unknown>;
  openOptionsPage(): void;
}

interface PopupAlert {
  variant: "default" | "success" | "destructive";
  text: string;
}

export interface PopupAppProps {
  runtime: RuntimeApi;
  getPreferredEditorId: () => Promise<string>;
  setIntervalFn?: typeof setInterval;
  refreshIntervalMs?: number;
  editorPresets?: EditorPreset[];
}

function getErrorMessage(result: { error?: string }): string {
  return result.error || "Unknown error.";
}

function sendMessage<T>(runtime: RuntimeApi, message: BackgroundMessage): Promise<T> {
  return runtime.sendMessage(message) as Promise<T>;
}

function resolvePreferredEditor(editorId: string, editorPresets: EditorPreset[]): EditorPreset {
  return editorPresets.find((preset) => preset.id === editorId)
    ?? editorPresets.find((preset) => preset.id === DEFAULT_EDITOR_ID)
    ?? editorPresets[0];
}

function deriveDefaultAlert(snapshot: SessionSnapshot | null, preferredEditor: EditorPreset): PopupAlert {
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

  if (!snapshot.rootReady) {
    return {
      variant: "destructive",
      text: "Reconnect the capture root in Settings before starting or opening the workspace."
    };
  }

  if (!snapshot.helperReady && !preferredEditor.urlTemplate) {
    return {
      variant: "destructive",
      text: `${preferredEditor.label} needs a custom URL override or a verified native host in Settings before it can open the root.`
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

function StatusTile({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "destructive";
}) {
  return (
    <div className="metric-tile">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-lg font-semibold">
        {tone === "success" && <span className="text-emerald-700">{value}</span>}
        {tone === "destructive" && <span className="text-destructive">{value}</span>}
        {tone === "default" && value}
      </div>
    </div>
  );
}

export function PopupApp({
  runtime,
  getPreferredEditorId,
  setIntervalFn = setInterval,
  refreshIntervalMs = POPUP_REFRESH_INTERVAL_MS,
  editorPresets = EDITOR_PRESETS
}: PopupAppProps) {
  const [snapshot, setSnapshot] = React.useState<SessionSnapshot | null>(null);
  const [preferredEditorId, setPreferredEditorId] = React.useState(DEFAULT_EDITOR_ID);
  const [actionAlert, setActionAlert] = React.useState<PopupAlert | null>(null);
  const [busyAction, setBusyAction] = React.useState<"toggle" | "open" | null>(null);
  const preferredEditor = React.useMemo(
    () => resolvePreferredEditor(preferredEditorId, editorPresets),
    [editorPresets, preferredEditorId]
  );

  const refreshState = React.useCallback(async (clearActionAlert = true) => {
    const nextSnapshot = await sendMessage<SessionSnapshot>(runtime, { type: "session.getState" });
    setSnapshot(nextSnapshot);
    if (clearActionAlert) {
      setActionAlert(null);
    }
    return nextSnapshot;
  }, [runtime]);

  React.useEffect(() => {
    let active = true;
    void getPreferredEditorId().then((editorId) => {
      if (!active) {
        return;
      }
      setPreferredEditorId(editorId);
    });
    void refreshState();

    const intervalId = setIntervalFn(() => {
      void refreshState();
    }, refreshIntervalMs);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [getPreferredEditorId, refreshIntervalMs, refreshState, setIntervalFn]);

  const alert = actionAlert ?? deriveDefaultAlert(snapshot, preferredEditor);
  const managedOrigins = snapshot?.enabledOrigins ?? [];
  const visibleOrigins = managedOrigins.slice(0, 3);
  const hiddenOriginsCount = Math.max(0, managedOrigins.length - visibleOrigins.length);

  async function handleToggleSession() {
    setBusyAction("toggle");
    try {
      const currentSnapshot = snapshot ?? await sendMessage<SessionSnapshot>(runtime, { type: "session.getState" });
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
      const result = await sendMessage<NativeOpenResult>(runtime, {
        type: "native.open",
        editorId: preferredEditor.id
      });
      await refreshState(false);
      setActionAlert({
        variant: result.ok ? "success" : "destructive",
        text: result.ok
          ? `Opened the capture root in ${preferredEditor.label}.`
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
        <div className="extension-panel grid gap-4 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <Badge variant={snapshot?.sessionActive ? "success" : "destructive"}>
                {snapshot?.sessionActive ? "Session Active" : "Session Inactive"}
              </Badge>
              <div>
                <h1 className="text-lg font-semibold tracking-tight">WraithWalker</h1>
                <p className="text-sm text-muted-foreground">
                  One-click fixture capture and workspace access.
                </p>
              </div>
            </div>
            <Button type="button" variant="ghost" onClick={() => runtime.openOptionsPage()}>
              Settings
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatusTile label="Attached Tabs" value={String(snapshot?.attachedTabIds.length ?? 0)} />
            <StatusTile label="Origins" value={String(snapshot?.enabledOrigins.length ?? 0)} />
            <StatusTile
              label="Root Access"
              value={snapshot?.rootReady ? "Ready" : "Blocked"}
              tone={snapshot?.rootReady ? "success" : "destructive"}
            />
            <StatusTile
              label="Editor Launch"
              value={snapshot?.helperReady || preferredEditor.urlTemplate ? "Ready" : "Needs Setup"}
              tone={snapshot?.helperReady || preferredEditor.urlTemplate ? "success" : "destructive"}
            />
          </div>

          <Alert variant={alert.variant}>{alert.text}</Alert>

          <div className="flex gap-3">
            <Button
              className="flex-1"
              type="button"
              disabled={busyAction !== null}
              onClick={handleToggleSession}
            >
              {snapshot?.sessionActive ? "Stop Session" : "Start Session"}
            </Button>
            <Button
              className="flex-1"
              type="button"
              variant="secondary"
              disabled={busyAction !== null}
              onClick={handleOpenEditor}
            >
              {busyAction === "open" ? "Opening..." : `Open in ${preferredEditor.label}`}
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Managed Origins</CardTitle>
              <CardDescription>
                {managedOrigins.length > 0
                  ? "The session watches these exact origins."
                  : "No origins are enabled yet."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {visibleOrigins.length > 0 ? (
                <>
                  {visibleOrigins.map((origin) => (
                    <Badge key={origin} variant="muted">{origin}</Badge>
                  ))}
                  {hiddenOriginsCount > 0 ? (
                    <Badge variant="muted">+{hiddenOriginsCount} more</Badge>
                  ) : null}
                </>
              ) : (
                <span className="text-sm text-muted-foreground">Open Settings to add your first origin.</span>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
