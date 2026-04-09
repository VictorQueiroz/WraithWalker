import {
  summarizeScenarioTrace,
  type ScenarioTraceAgentSummary,
  type ScenarioTraceRecord
} from "@wraithwalker/core/scenario-traces";
import type { SiteConfig } from "@wraithwalker/core/site-config";

export const EXTENSION_HEARTBEAT_TTL_MS = 15_000;

export interface ActiveExtensionClientState {
  clientId: string;
  extensionVersion: string;
  sessionActive: boolean;
  enabledOrigins: string[];
  lastHeartbeatAt: string;
}

export interface ExtensionStatus {
  connected: boolean;
  captureReady: boolean;
  sessionActive: boolean;
  lastHeartbeatAt: string | null;
  extensionVersion: string;
  clientId: string;
  captureDestination: "none" | "server";
  enabledOrigins: string[];
  siteConfigs: SiteConfig[];
  activeTrace: ScenarioTraceRecord | null;
  tracePhase: ScenarioTracePhase;
  blockingReason?: ScenarioTraceBlockingReason;
  activeTraceSummary: ScenarioTraceAgentSummary | null;
}

export interface ExtensionHeartbeatInput {
  clientId: string;
  extensionVersion: string;
  sessionActive: boolean;
  enabledOrigins: string[];
}

interface CreateExtensionSessionTrackerDependencies {
  getActiveTrace: () => Promise<ScenarioTraceRecord | null>;
  getEffectiveSiteConfigs: () => Promise<SiteConfig[]>;
  now?: () => number;
  ttlMs?: number;
}

export type ScenarioTracePhase = "disconnected" | "not_ready" | "idle" | "armed" | "recording";

export type ScenarioTraceBlockingReason =
  | "extension_disconnected"
  | "session_inactive"
  | "no_enabled_origins";

export interface TraceStatusView {
  phase: ScenarioTracePhase;
  blockingReason?: ScenarioTraceBlockingReason;
  connected: boolean;
  captureReady: boolean;
  sessionActive: boolean;
  captureDestination: "none" | "server";
  enabledOrigins: string[];
  activeTrace: ScenarioTraceAgentSummary | null;
  guidance: string;
}

function getTraceBlockingReason(status: {
  connected: boolean;
  captureReady: boolean;
  sessionActive: boolean;
  enabledOrigins: string[];
}): ScenarioTraceBlockingReason | undefined {
  if (!status.connected) {
    return "extension_disconnected";
  }

  if (status.captureReady) {
    return undefined;
  }

  if (!status.sessionActive) {
    return "session_inactive";
  }

  if (status.enabledOrigins.length === 0) {
    return "no_enabled_origins";
  }

  return undefined;
}

function getTracePhase(status: {
  connected: boolean;
  captureReady: boolean;
  activeTrace: ScenarioTraceRecord | null;
}): ScenarioTracePhase {
  if (!status.connected) {
    return "disconnected";
  }

  if (!status.captureReady) {
    return "not_ready";
  }

  if (status.activeTrace?.status === "recording") {
    return "recording";
  }

  if (status.activeTrace?.status === "armed") {
    return "armed";
  }

  return "idle";
}

export function describeTraceStatusGuidance(view: Pick<TraceStatusView, "phase" | "blockingReason">): string {
  switch (view.phase) {
    case "disconnected":
      return "Connect the browser extension to this server and start a session before tracing.";
    case "not_ready":
      if (view.blockingReason === "session_inactive") {
        return "Start the browser session in the extension, then poll trace-status again.";
      }
      if (view.blockingReason === "no_enabled_origins") {
        return "Enable at least one origin in the connected root, then poll trace-status again.";
      }
      return "Wait until captureReady is true before starting a trace.";
    case "armed":
      return "The trace is armed and waiting for clicks. Ask the user to click through the workflow, then stop the trace when finished.";
    case "recording":
      return "The trace is recording clicks and linked fixtures. Continue polling trace-status while the user clicks, then stop the trace when finished.";
    case "idle":
    default:
      return "Tracing is ready. Call start-trace with an optional name and goal, then ask the user to click through the workflow.";
  }
}

export function buildTraceStatusView(status: ExtensionStatus): TraceStatusView {
  const view: TraceStatusView = {
    phase: status.tracePhase,
    ...(status.blockingReason ? { blockingReason: status.blockingReason } : {}),
    connected: status.connected,
    captureReady: status.captureReady,
    sessionActive: status.sessionActive,
    captureDestination: status.captureDestination,
    enabledOrigins: [...status.enabledOrigins],
    activeTrace: status.activeTraceSummary,
    guidance: ""
  };

  return {
    ...view,
    guidance: describeTraceStatusGuidance(view)
  };
}

export function createExtensionSessionTracker({
  getActiveTrace,
  getEffectiveSiteConfigs,
  now = Date.now,
  ttlMs = EXTENSION_HEARTBEAT_TTL_MS
}: CreateExtensionSessionTrackerDependencies) {
  let activeClient: ActiveExtensionClientState | null = null;

  function isConnected(client: ActiveExtensionClientState | null): boolean {
    if (!client) {
      return false;
    }

    return now() - Date.parse(client.lastHeartbeatAt) <= ttlMs;
  }

  async function heartbeat(input: ExtensionHeartbeatInput): Promise<ExtensionStatus> {
    const heartbeatAt = new Date(now()).toISOString();
    activeClient = {
      clientId: input.clientId,
      extensionVersion: input.extensionVersion,
      sessionActive: input.sessionActive,
      enabledOrigins: [...input.enabledOrigins],
      lastHeartbeatAt: heartbeatAt
    };

    return getStatus();
  }

  async function getStatus(): Promise<ExtensionStatus> {
    const trace = await getActiveTrace();
    const activeTraceSummary = trace
      ? summarizeScenarioTrace(trace)
      : null;
    const connected = isConnected(activeClient);
    const siteConfigs = connected
      ? await getEffectiveSiteConfigs()
      : [];
    const enabledOrigins = siteConfigs.map((siteConfig) => siteConfig.origin);
    const captureReady = connected && Boolean(activeClient?.sessionActive) && enabledOrigins.length > 0;
    const tracePhase = getTracePhase({
      connected,
      captureReady,
      activeTrace: trace
    });
    const blockingReason = getTraceBlockingReason({
      connected,
      captureReady,
      sessionActive: connected ? Boolean(activeClient?.sessionActive) : false,
      enabledOrigins
    });

    if (!activeClient) {
      return {
        connected: false,
        captureReady: false,
        sessionActive: false,
        lastHeartbeatAt: null,
        extensionVersion: "",
        clientId: "",
        captureDestination: "none",
        enabledOrigins: [],
        siteConfigs: [],
        activeTrace: trace,
        tracePhase,
        ...(blockingReason ? { blockingReason } : {}),
        activeTraceSummary
      };
    }

    return {
      connected,
      captureReady,
      sessionActive: connected ? activeClient.sessionActive : false,
      lastHeartbeatAt: activeClient.lastHeartbeatAt,
      extensionVersion: activeClient.extensionVersion,
      clientId: activeClient.clientId,
      captureDestination: connected ? "server" : "none",
      enabledOrigins,
      siteConfigs,
      activeTrace: trace,
      tracePhase,
      ...(blockingReason ? { blockingReason } : {}),
      activeTraceSummary
    };
  }

  return {
    heartbeat,
    getStatus
  };
}
