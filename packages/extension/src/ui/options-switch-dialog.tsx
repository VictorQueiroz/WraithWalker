import type { FixtureDiff } from "@wraithwalker/core/scenarios";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "./components.js";
import type { ScenarioSwitchDialogState } from "./options-app.actions.js";

function buildDiffPreview(diff: FixtureDiff): string[] {
  const previews = [
    ...diff.added
      .slice(0, 2)
      .map(
        (entry) => `Added ${entry.method} ${entry.pathname} (${entry.status})`
      ),
    ...diff.removed
      .slice(0, 2)
      .map(
        (entry) => `Removed ${entry.method} ${entry.pathname} (${entry.status})`
      ),
    ...diff.changed.slice(0, 3).map((entry) => {
      const suffix = entry.bodyChanged ? ", body changed" : "";
      return `Changed ${entry.method} ${entry.pathname} (${entry.statusBefore} -> ${entry.statusAfter}${suffix})`;
    })
  ];

  return previews.slice(0, 5);
}

export function ScenarioSwitchDialog({
  dialog,
  switchBusyName,
  onCancel,
  onConfirm
}: {
  dialog: ScenarioSwitchDialogState;
  switchBusyName: string | null;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const switchDialogPreview = dialog.diff ? buildDiffPreview(dialog.diff) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={`Switch to ${dialog.targetName}`}
        className="w-full max-w-xl"
      >
        <CardHeader>
          <CardTitle>Switch Snapshot</CardTitle>
          <CardDescription>
            {dialog.diff
              ? `Compare "${dialog.diff.scenarioA}" with "${dialog.targetName}" before replacing the current workspace.`
              : `Replace the current workspace with "${dialog.targetName}".`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {dialog.diff ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border/70 bg-card/70 px-4 py-3">
                  <div className="text-xs text-muted-foreground">Added</div>
                  <div className="text-lg font-semibold">
                    {dialog.diff.added.length}
                  </div>
                </div>
                <div className="rounded-xl border border-border/70 bg-card/70 px-4 py-3">
                  <div className="text-xs text-muted-foreground">Removed</div>
                  <div className="text-lg font-semibold">
                    {dialog.diff.removed.length}
                  </div>
                </div>
                <div className="rounded-xl border border-border/70 bg-card/70 px-4 py-3">
                  <div className="text-xs text-muted-foreground">Changed</div>
                  <div className="text-lg font-semibold">
                    {dialog.diff.changed.length}
                  </div>
                </div>
              </div>

              {switchDialogPreview.length > 0 ? (
                <ul className="grid gap-2 text-sm text-foreground/90">
                  {switchDialogPreview.map((preview) => (
                    <li
                      key={preview}
                      className="rounded-xl border border-border/70 bg-card/70 px-3 py-2"
                    >
                      {preview}
                    </li>
                  ))}
                </ul>
              ) : (
                <Alert variant="default">
                  No endpoint differences were detected between these snapshots.
                </Alert>
              )}
            </>
          ) : (
            <Alert variant="default">
              No active snapshot baseline is available, so this switch will
              proceed without a diff preview.
            </Alert>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={switchBusyName === dialog.targetName}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={switchBusyName === dialog.targetName}
              onClick={() => void onConfirm()}
            >
              {switchBusyName === dialog.targetName
                ? "Switching..."
                : "Confirm Switch"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
