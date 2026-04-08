import type { ScenarioTraceRecord } from "@wraithwalker/core/scenario-traces";
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
    const connected = isConnected(activeClient);
    const siteConfigs = connected
      ? await getEffectiveSiteConfigs()
      : [];
    const enabledOrigins = siteConfigs.map((siteConfig) => siteConfig.origin);

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
        activeTrace: trace
      };
    }

    return {
      connected,
      captureReady: connected && activeClient.sessionActive && enabledOrigins.length > 0,
      sessionActive: connected ? activeClient.sessionActive : false,
      lastHeartbeatAt: activeClient.lastHeartbeatAt,
      extensionVersion: activeClient.extensionVersion,
      clientId: activeClient.clientId,
      captureDestination: connected ? "server" : "none",
      enabledOrigins,
      siteConfigs,
      activeTrace: trace
    };
  }

  return {
    heartbeat,
    getStatus
  };
}
