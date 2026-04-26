import type { WorkspaceStatus } from "../lib/workspace-open-state.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Label,
  Textarea
} from "./components.js";
import type { OptionsActionFlash } from "./options-app.actions.js";
import { SectionIntro } from "./options-app.shared.js";
import type { ScenarioPanelState } from "./options-app.queries.js";

export function ScenarioManagerSection({
  scenarioStatus,
  workspaceStatus,
  scenarioPanel,
  manualScenarioName,
  manualScenarioDescription,
  manualScenarioError,
  savingManualScenario,
  traceScenarioName,
  traceScenarioDescription,
  traceScenarioError,
  savingTraceScenario,
  switchBusyName,
  onManualScenarioNameChange,
  onManualScenarioDescriptionChange,
  onTraceScenarioNameChange,
  onTraceScenarioDescriptionChange,
  onClearManualScenarioError,
  onClearTraceScenarioError,
  onSaveScenario,
  onSaveScenarioFromTrace,
  onSwitchScenario
}: {
  scenarioStatus: OptionsActionFlash | null;
  workspaceStatus: WorkspaceStatus;
  scenarioPanel: ScenarioPanelState;
  manualScenarioName: string;
  manualScenarioDescription: string;
  manualScenarioError: string | null;
  savingManualScenario: boolean;
  traceScenarioName: string;
  traceScenarioDescription: string;
  traceScenarioError: string | null;
  savingTraceScenario: boolean;
  switchBusyName: string | null;
  onManualScenarioNameChange: (value: string) => void;
  onManualScenarioDescriptionChange: (value: string) => void;
  onTraceScenarioNameChange: (value: string) => void;
  onTraceScenarioDescriptionChange: (value: string) => void;
  onClearManualScenarioError: () => void;
  onClearTraceScenarioError: () => void;
  onSaveScenario: () => void | Promise<void>;
  onSaveScenarioFromTrace: () => void | Promise<void>;
  onSwitchScenario: (name: string) => void | Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <SectionIntro
          title="Scenario Manager"
          description="Snapshots use Server Root when connected, otherwise Remembered Browser Root."
        />
      </CardHeader>
      <CardContent className="grid gap-6">
        {scenarioStatus ? (
          <Alert variant={scenarioStatus.variant}>{scenarioStatus.text}</Alert>
        ) : null}

        <div className="grid gap-3 rounded-xl border border-border/70 bg-card/70 p-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="default">
              Snapshots in {workspaceStatus.authorityLabel}
            </Badge>
            <Badge
              variant={workspaceStatus.activeSnapshotName ? "success" : "muted"}
            >
              Active snapshot: {workspaceStatus.activeSnapshotName ?? "None"}
            </Badge>
            <Badge variant="muted">
              Trace:{" "}
              {workspaceStatus.activeTraceLabel ??
                (workspaceStatus.authority === "server"
                  ? "None"
                  : "Server Root only")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {workspaceStatus.authority === "server"
              ? "Trace provenance below belongs to the active Server Root."
              : "Trace save becomes available when Server Root is active."}
          </p>
        </div>

        <div className="grid gap-4 rounded-xl border border-border/70 bg-card/70 p-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Current Workspace</h3>
            <p className="text-sm text-muted-foreground">
              The active snapshot marker lives in the active root and only
              changes when you switch.
            </p>
          </div>

          {scenarioPanel.activeScenarioName ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  scenarioPanel.activeScenarioMissing
                    ? "destructive"
                    : "success"
                }
              >
                {scenarioPanel.activeScenarioMissing
                  ? "Active Missing"
                  : "Active"}
              </Badge>
              <span className="font-medium">
                {scenarioPanel.activeScenarioName}
              </span>
            </div>
          ) : (
            <Alert variant="default">
              No active snapshot marker is set for this root yet.
            </Alert>
          )}

          {scenarioPanel.activeScenarioMissing &&
          scenarioPanel.activeScenarioName ? (
            <Alert variant="destructive">
              The active snapshot marker still points to "
              {scenarioPanel.activeScenarioName}", but that snapshot is missing
              from this root.
            </Alert>
          ) : null}

          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void onSaveScenario();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="scenario-name">Scenario name</Label>
              <Input
                id="scenario-name"
                aria-label="Scenario name"
                placeholder="baseline"
                disabled={savingManualScenario}
                value={manualScenarioName}
                onChange={(event) => {
                  onManualScenarioNameChange(event.currentTarget.value);
                  onClearManualScenarioError();
                }}
              />
              {manualScenarioError ? (
                <p className="text-xs text-destructive">
                  {manualScenarioError}
                </p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="scenario-description">
                Description (optional)
              </Label>
              <Textarea
                id="scenario-description"
                aria-label="Scenario description"
                placeholder="Saved after refreshing the root fixtures."
                disabled={savingManualScenario}
                value={manualScenarioDescription}
                onChange={(event) =>
                  onManualScenarioDescriptionChange(event.currentTarget.value)
                }
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={savingManualScenario}>
                {savingManualScenario ? "Saving..." : "Save Snapshot"}
              </Button>
            </div>
          </form>
        </div>

        {scenarioPanel.supportsTraceSave && scenarioPanel.activeTrace ? (
          <div className="grid gap-4 rounded-xl border border-border/70 bg-card/70 p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Save From Active Trace</h3>
              <p className="text-sm text-muted-foreground">
                Snapshot the current workspace with trace provenance attached
                while the server-backed trace is active.
              </p>
            </div>

            <div className="grid gap-2 rounded-xl border border-border/60 bg-background/80 p-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="default">
                  {scenarioPanel.activeTrace.status}
                </Badge>
                <span className="font-medium">
                  {scenarioPanel.activeTrace.name ??
                    scenarioPanel.activeTrace.traceId}
                </span>
              </div>
              {scenarioPanel.activeTrace.goal ? (
                <p>{scenarioPanel.activeTrace.goal}</p>
              ) : null}
              <div className="grid gap-1 text-muted-foreground sm:grid-cols-2">
                <span>Trace ID: {scenarioPanel.activeTrace.traceId}</span>
                <span>Steps: {scenarioPanel.activeTrace.stepCount}</span>
                <span>
                  Linked fixtures:{" "}
                  {scenarioPanel.activeTrace.linkedFixtureCount}
                </span>
                <span>
                  Origins: {scenarioPanel.activeTrace.selectedOrigins.length}
                </span>
              </div>
            </div>

            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void onSaveScenarioFromTrace();
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="trace-scenario-name">Scenario name</Label>
                <Input
                  id="trace-scenario-name"
                  aria-label="Trace scenario name"
                  placeholder="trace_snapshot"
                  disabled={savingTraceScenario}
                  value={traceScenarioName}
                  onChange={(event) => {
                    onTraceScenarioNameChange(event.currentTarget.value);
                    onClearTraceScenarioError();
                  }}
                />
                {traceScenarioError ? (
                  <p className="text-xs text-destructive">
                    {traceScenarioError}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="trace-scenario-description">
                  Description (optional)
                </Label>
                <Textarea
                  id="trace-scenario-description"
                  aria-label="Trace scenario description"
                  placeholder="Saved from the active guided trace."
                  disabled={savingTraceScenario}
                  value={traceScenarioDescription}
                  onChange={(event) =>
                    onTraceScenarioDescriptionChange(event.currentTarget.value)
                  }
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={savingTraceScenario}>
                  {savingTraceScenario ? "Saving..." : "Save Trace Snapshot"}
                </Button>
              </div>
            </form>
          </div>
        ) : null}

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Saved Snapshots</h3>
              <p className="text-sm text-muted-foreground">
                Active snapshots stay pinned first, then the rest sort by newest
                saved time.
              </p>
            </div>
            <Badge variant="muted">
              {scenarioPanel.snapshots.length} saved
            </Badge>
          </div>

          {scenarioPanel.snapshots.length > 0 ? (
            scenarioPanel.snapshots.map((snapshot) => {
              const switchBusy = switchBusyName === snapshot.name;

              return (
                <div
                  key={snapshot.name}
                  className="grid gap-3 rounded-xl border border-border/70 bg-card/70 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{snapshot.name}</span>
                        {snapshot.isActive ? (
                          <Badge variant="success">Active</Badge>
                        ) : null}
                        {snapshot.source === "manual" ? (
                          <Badge variant="default">Manual</Badge>
                        ) : null}
                        {snapshot.source === "trace" ? (
                          <Badge variant="muted">Trace</Badge>
                        ) : null}
                        {snapshot.source === "unknown" ? (
                          <Badge variant="muted">Legacy</Badge>
                        ) : null}
                      </div>
                      {snapshot.description ? (
                        <p className="text-sm text-foreground/90">
                          {snapshot.description}
                        </p>
                      ) : null}
                      <div className="grid gap-1 text-sm text-muted-foreground">
                        {snapshot.createdAt ? (
                          <span>Created: {snapshot.createdAt}</span>
                        ) : null}
                        {snapshot.sourceTrace ? (
                          <span>
                            Trace {snapshot.sourceTrace.traceId} ·{" "}
                            {snapshot.sourceTrace.stepCount} steps ·{" "}
                            {snapshot.sourceTrace.linkedFixtureCount} linked
                            fixtures
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={snapshot.isActive || switchBusy}
                      onClick={() => void onSwitchScenario(snapshot.name)}
                    >
                      {snapshot.isActive
                        ? "Active"
                        : switchBusy
                          ? "Working..."
                          : "Switch"}
                    </Button>
                  </div>
                </div>
              );
            })
          ) : (
            <Alert variant="default">No snapshots saved yet.</Alert>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
