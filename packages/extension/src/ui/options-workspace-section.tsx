import type { SessionSnapshot } from "../lib/types.js";
import type {
  WorkspaceReadiness,
  WorkspaceStatus
} from "../lib/workspace-open-state.js";
import { Alert, Badge, Card, CardContent, CardHeader } from "./components.js";
import { SectionIntro } from "./options-app.shared.js";

function WorkspaceStatusTile({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid gap-1 rounded-xl border border-border/70 bg-card/70 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function ReadinessChecklistRow({
  label,
  value,
  text,
  state
}: {
  label: string;
  value: string;
  text: string;
  state: "ready" | "needs_attention" | "info";
}) {
  const badgeVariant =
    state === "ready"
      ? "success"
      : state === "needs_attention"
        ? "default"
        : "muted";

  return (
    <div className="grid gap-2 rounded-xl border border-border/70 bg-card/70 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="flex items-center gap-2">
          <Badge variant={badgeVariant}>{value}</Badge>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export function WorkspaceStatusSection({
  sessionSnapshot,
  workspaceStatus,
  workspaceReadiness
}: {
  sessionSnapshot: SessionSnapshot | null;
  workspaceStatus: WorkspaceStatus;
  workspaceReadiness: WorkspaceReadiness;
}) {
  return (
    <Card>
      <CardHeader>
        <SectionIntro
          title="Workspace Status"
          description="See which workspace is active right now and what needs attention next."
        />
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <WorkspaceStatusTile
            label="Session"
            value={workspaceStatus.sessionLabel}
          />
          <WorkspaceStatusTile
            label="Active Root"
            value={workspaceStatus.authorityLabel}
          />
          <WorkspaceStatusTile
            label="Remembered Browser Root"
            value={workspaceStatus.rememberedRootLabel}
          />
          <WorkspaceStatusTile
            label="Enabled Origins"
            value={`${workspaceStatus.enabledOriginCount} enabled`}
          />
          <WorkspaceStatusTile
            label="Active Snapshot"
            value={workspaceStatus.activeSnapshotName ?? "None"}
          />
          <WorkspaceStatusTile
            label="Active Trace"
            value={
              workspaceStatus.activeTraceLabel ??
              (workspaceStatus.authority === "server"
                ? "None"
                : "Server Root only")
            }
          />
        </div>
        {sessionSnapshot?.captureRootPath &&
        workspaceStatus.authority !== "none" ? (
          <div className="text-sm text-muted-foreground">
            Current path:{" "}
            <span className="break-all text-foreground">
              {sessionSnapshot.captureRootPath}
            </span>
          </div>
        ) : null}
        <Alert variant={workspaceReadiness.primaryNextActionVariant}>
          <span className="font-medium">
            {workspaceReadiness.primaryNextActionLabel}:
          </span>{" "}
          {workspaceReadiness.primaryNextActionText}
        </Alert>
        <div className="grid gap-3" aria-label="Capture readiness checklist">
          {workspaceReadiness.items.map((item) => (
            <ReadinessChecklistRow
              key={item.id}
              label={item.label}
              value={item.value}
              text={item.text}
              state={item.state}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
