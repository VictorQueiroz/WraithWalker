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
  recentConsoleEntries: ExtensionConsoleEntry[];
}

export interface ExtensionConsoleEntry {
  tabId: number;
  topOrigin: string;
  source: string;
  level: string;
  text: string;
  timestamp: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
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
  recentConsoleEntries: ExtensionConsoleEntry[];
}

export interface ExtensionHeartbeatInput {
  clientId: string;
  extensionVersion: string;
  sessionActive: boolean;
  enabledOrigins: string[];
  recentConsoleEntries?: ExtensionConsoleEntry[];
  completedCommands?: ExtensionServerCommandResult[];
}

export interface ExtensionServerCommand {
  commandId: string;
  type: "refresh_config";
  issuedAt: string;
}

export interface ExtensionServerCommandResult {
  commandId: string;
  type: "refresh_config";
  ok: boolean;
  completedAt: string;
  error?: string;
}

export interface ExtensionHeartbeatStatus extends ExtensionStatus {
  commands?: ExtensionServerCommand[];
}

interface CreateExtensionSessionTrackerDependencies {
  getActiveTrace: () => Promise<ScenarioTraceRecord | null>;
  getEffectiveSiteConfigs: () => Promise<SiteConfig[]>;
  now?: () => number;
  ttlMs?: number;
  completedCommandResultLimit?: number;
}

export type ScenarioTracePhase =
  | "disconnected"
  | "not_ready"
  | "idle"
  | "armed"
  | "recording";

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

export function describeTraceStatusGuidance(
  view: Pick<TraceStatusView, "phase" | "blockingReason">
): string {
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
  ttlMs = EXTENSION_HEARTBEAT_TTL_MS,
  completedCommandResultLimit = 100
}: CreateExtensionSessionTrackerDependencies) {
  let activeClient: ActiveExtensionClientState | null = null;
  let commandSequence = 0;
  const pendingCommands = new Map<
    string,
    { clientId: string; command: ExtensionServerCommand }
  >();
  const completedCommandResults = new Map<
    string,
    ExtensionServerCommandResult
  >();
  const commandWaiters = new Map<
    string,
    Array<{
      resolve: (result: ExtensionServerCommandResult) => void;
      reject: (error: Error) => void;
      timeoutId?: ReturnType<typeof setTimeout>;
    }>
  >();

  function isConnected(client: ActiveExtensionClientState | null): boolean {
    if (!client) {
      return false;
    }

    return now() - Date.parse(client.lastHeartbeatAt) <= ttlMs;
  }

  function rejectAllWaiters(error: Error): void {
    for (const [commandId, waiters] of commandWaiters.entries()) {
      commandWaiters.delete(commandId);
      for (const waiter of waiters) {
        if (waiter.timeoutId) {
          clearTimeout(waiter.timeoutId);
        }
        waiter.reject(error);
      }
    }
  }

  function clearCommandState(message: string): void {
    pendingCommands.clear();
    completedCommandResults.clear();
    rejectAllWaiters(new Error(message));
  }

  function sweepExpiredCommandState(): void {
    if (!activeClient || isConnected(activeClient)) {
      return;
    }

    clearCommandState(
      "The browser extension heartbeat expired before the queued command completed."
    );
  }

  function settleCompletedCommand(result: ExtensionServerCommandResult): void {
    pendingCommands.delete(result.commandId);
    completedCommandResults.delete(result.commandId);
    completedCommandResults.set(result.commandId, result);
    while (completedCommandResults.size > completedCommandResultLimit) {
      const oldestCommandId = completedCommandResults.keys().next().value;
      if (!oldestCommandId) {
        break;
      }
      completedCommandResults.delete(oldestCommandId);
    }

    const waiters = commandWaiters.get(result.commandId) ?? [];
    commandWaiters.delete(result.commandId);
    for (const waiter of waiters) {
      if (waiter.timeoutId) {
        clearTimeout(waiter.timeoutId);
      }
      waiter.resolve(result);
    }
  }

  function listPendingCommandsForClient(
    clientId: string
  ): ExtensionServerCommand[] {
    return [...pendingCommands.values()]
      .filter((entry) => entry.clientId === clientId)
      .map((entry) => entry.command);
  }

  async function heartbeat(
    input: ExtensionHeartbeatInput
  ): Promise<ExtensionHeartbeatStatus> {
    sweepExpiredCommandState();
    if (activeClient && activeClient.clientId !== input.clientId) {
      clearCommandState(
        `The active browser extension client changed from ${activeClient.clientId} to ${input.clientId}.`
      );
    }

    const heartbeatAt = new Date(now()).toISOString();
    activeClient = {
      clientId: input.clientId,
      extensionVersion: input.extensionVersion,
      sessionActive: input.sessionActive,
      enabledOrigins: [...input.enabledOrigins],
      lastHeartbeatAt: heartbeatAt,
      recentConsoleEntries: [...(input.recentConsoleEntries ?? [])]
    };

    for (const result of input.completedCommands ?? []) {
      const pending = pendingCommands.get(result.commandId);
      if (!pending || pending.clientId !== input.clientId) {
        continue;
      }

      settleCompletedCommand(result);
    }

    return {
      ...(await getStatus()),
      commands: listPendingCommandsForClient(input.clientId)
    };
  }

  async function getStatus(): Promise<ExtensionStatus> {
    sweepExpiredCommandState();
    const trace = await getActiveTrace();
    const activeTraceSummary = trace ? summarizeScenarioTrace(trace) : null;
    const connected = isConnected(activeClient);
    const siteConfigs = connected ? await getEffectiveSiteConfigs() : [];
    const configuredOrigins = new Set(
      siteConfigs.map((siteConfig) => siteConfig.origin)
    );
    const enabledOrigins =
      connected && activeClient
        ? [
            ...new Set(
              activeClient.enabledOrigins.filter((origin) =>
                configuredOrigins.has(origin)
              )
            )
          ]
        : [];
    const captureReady =
      connected &&
      Boolean(activeClient?.sessionActive) &&
      enabledOrigins.length > 0;
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
        activeTraceSummary,
        recentConsoleEntries: []
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
      activeTraceSummary,
      recentConsoleEntries: connected
        ? [...activeClient.recentConsoleEntries]
        : []
    };
  }

  function queueCommand(
    command: Pick<ExtensionServerCommand, "type">
  ): ExtensionServerCommand {
    sweepExpiredCommandState();
    if (!activeClient || !isConnected(activeClient)) {
      throw new Error(
        "No connected browser extension is available to receive server commands."
      );
    }

    const queuedCommand: ExtensionServerCommand = {
      commandId: `extension-command-${++commandSequence}`,
      type: command.type,
      issuedAt: new Date(now()).toISOString()
    };
    pendingCommands.set(queuedCommand.commandId, {
      clientId: activeClient.clientId,
      command: queuedCommand
    });
    return queuedCommand;
  }

  function waitForCommandResult(
    commandId: string,
    { timeoutMs = EXTENSION_HEARTBEAT_TTL_MS }: { timeoutMs?: number } = {}
  ): Promise<ExtensionServerCommandResult> {
    sweepExpiredCommandState();

    const completed = completedCommandResults.get(commandId);
    if (completed) {
      return Promise.resolve(completed);
    }

    if (!pendingCommands.has(commandId)) {
      return Promise.reject(
        new Error(`Unknown extension server command: ${commandId}`)
      );
    }

    return new Promise<ExtensionServerCommandResult>((resolve, reject) => {
      const waiters = commandWaiters.get(commandId) ?? [];
      const waiter = {
        resolve,
        reject,
        timeoutId:
          timeoutMs > 0
            ? setTimeout(() => {
                const currentWaiters = commandWaiters.get(commandId) ?? [];
                commandWaiters.set(
                  commandId,
                  currentWaiters.filter((entry) => entry !== waiter)
                );
                reject(
                  new Error(
                    `Timed out waiting for extension command ${commandId} to complete.`
                  )
                );
              }, timeoutMs)
            : undefined
      };
      waiters.push(waiter);
      commandWaiters.set(commandId, waiters);
    });
  }

  return {
    heartbeat,
    getStatus,
    queueCommand,
    waitForCommandResult
  };
}
