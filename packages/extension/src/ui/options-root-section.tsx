import type { RootState } from "./options-app.queries.js";
import { Alert, Button, Card, CardContent, CardHeader } from "./components.js";
import { SectionIntro } from "./options-app.shared.js";

function RootStatusSummary({
  rootState,
  serverConnected,
  serverRootPath
}: {
  rootState: RootState | null;
  serverConnected: boolean;
  serverRootPath?: string;
}) {
  if (serverConnected && (!rootState || !rootState.hasHandle)) {
    return (
      <Alert variant="default">
        Server Root is active.
        {serverRootPath
          ? ` Settings changes are using ${serverRootPath}.`
          : " Settings changes are using Server Root."}{" "}
        Choose Root Directory only if you want a Remembered Browser Root
        fallback.
      </Alert>
    );
  }

  if (!rootState || !rootState.hasHandle) {
    return (
      <Alert variant="default">
        Choose Root Directory to set the Remembered Browser Root fallback.
      </Alert>
    );
  }

  if (rootState.permission !== "granted") {
    return (
      <Alert variant="destructive">
        Reconnect Root Directory to restore the Remembered Browser Root
        fallback.
      </Alert>
    );
  }

  return (
    <Alert variant="success">
      Remembered Browser Root is ready.
      {rootState.sentinel ? ` Root ID: ${rootState.sentinel.rootId}.` : ""}
    </Alert>
  );
}

export function RememberedBrowserRootSection({
  rootState,
  serverConnected,
  serverRootPath,
  rootActionLabel,
  onRootAction,
  onOpenLaunchFolder,
  onCopyDiagnostics
}: {
  rootState: RootState | null;
  serverConnected: boolean;
  serverRootPath?: string;
  rootActionLabel: string;
  onRootAction: () => void | Promise<void>;
  onOpenLaunchFolder: () => void | Promise<void>;
  onCopyDiagnostics: () => void | Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <SectionIntro
          title="Remembered Browser Root"
          description="Chrome can remember this fallback workspace whenever Server Root is not active."
        />
      </CardHeader>
      <CardContent className="grid gap-4">
        <RootStatusSummary
          rootState={rootState}
          serverConnected={serverConnected}
          serverRootPath={serverRootPath}
        />
        {rootState?.sentinel ? (
          <div className="rounded-xl border border-border/70 bg-card/70 px-4 py-3 text-sm">
            <div className="font-medium">Root ID</div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">
              {rootState.sentinel.rootId}
            </div>
          </div>
        ) : null}
        <Button
          className="sm:w-fit"
          type="button"
          onClick={() => void onRootAction()}
        >
          {rootActionLabel}
        </Button>
        <Button
          className="sm:w-fit"
          type="button"
          variant="secondary"
          onClick={() => void onOpenLaunchFolder()}
        >
          Open Active Root Folder
        </Button>
        <Button
          className="sm:w-fit"
          type="button"
          variant="ghost"
          onClick={() => void onCopyDiagnostics()}
        >
          Copy Support Diagnostics
        </Button>
        <p className="text-xs text-muted-foreground">
          The directory picker remembers the browser-side fallback. Opening the
          active workspace in Finder or Explorer still goes through the shared
          reveal flow below.
        </p>
      </CardContent>
    </Card>
  );
}
