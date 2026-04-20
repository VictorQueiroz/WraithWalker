import {
  QueryClient,
  queryOptions,
  timeoutManager,
  type QueryKey
} from "@tanstack/react-query";

import type {
  BackgroundMessage,
  ErrorResult,
  ScenarioListResult,
  ScenarioListSuccess
} from "../lib/messages.js";
import type { MessageRuntimeApi } from "../lib/chrome-api.js";
import { DEFAULT_NATIVE_HOST_CONFIG } from "../lib/constants.js";
import {
  ensureRootSentinel as defaultEnsureRootSentinel,
  loadStoredRootHandle as defaultLoadStoredRootHandle,
  queryRootPermission as defaultQueryRootPermission
} from "../lib/root-handle.js";
import { normalizeSiteConfigs } from "../lib/site-config.js";
import type {
  NativeHostConfig,
  RootSentinel,
  SessionSnapshot,
  SiteConfig
} from "../lib/types.js";

export interface RootState {
  hasHandle: boolean;
  permission: PermissionState;
  sentinel: RootSentinel | null;
}

export type ScenarioPanelState = Omit<ScenarioListSuccess, "ok">;
type ScenarioListRuntimeSuccess = Pick<ScenarioListSuccess, "ok"> &
  Partial<ScenarioPanelState>;

export const EMPTY_SCENARIO_PANEL: ScenarioPanelState = {
  scenarios: [],
  snapshots: [],
  activeScenarioName: null,
  activeScenarioMissing: false,
  activeTrace: null,
  supportsTraceSave: false
};

function getErrorMessage(result: { error?: string }): string {
  return result.error || "Unknown error.";
}

function sendMessage<T>(
  runtime: MessageRuntimeApi,
  message: BackgroundMessage
): Promise<T> {
  return runtime.sendMessage(message) as Promise<T>;
}

function normalizeScenarioSnapshotSource(
  value: unknown
): ScenarioPanelState["snapshots"][number]["source"] {
  return value === "manual" || value === "trace" ? value : "unknown";
}

function normalizeScenarioSnapshot(
  value: unknown,
  activeScenarioName: string | null
): ScenarioPanelState["snapshots"][number] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const snapshot = value as Partial<ScenarioPanelState["snapshots"][number]>;
  if (typeof snapshot.name !== "string") {
    return null;
  }

  return {
    name: snapshot.name,
    ...(typeof snapshot.schemaVersion === "number"
      ? { schemaVersion: snapshot.schemaVersion }
      : {}),
    ...(typeof snapshot.createdAt === "string"
      ? { createdAt: snapshot.createdAt }
      : {}),
    ...(typeof snapshot.rootId === "string" ? { rootId: snapshot.rootId } : {}),
    source: normalizeScenarioSnapshotSource(snapshot.source),
    ...(typeof snapshot.description === "string" && snapshot.description.trim()
      ? { description: snapshot.description.trim() }
      : {}),
    ...(snapshot.sourceTrace && typeof snapshot.sourceTrace === "object"
      ? { sourceTrace: snapshot.sourceTrace }
      : {}),
    hasMetadata:
      typeof snapshot.hasMetadata === "boolean" ? snapshot.hasMetadata : false,
    isActive:
      typeof snapshot.isActive === "boolean"
        ? snapshot.isActive
        : activeScenarioName === snapshot.name
  };
}

export function normalizeScenarioPanelState(
  result: ScenarioListRuntimeSuccess
): ScenarioPanelState {
  const activeScenarioName =
    typeof result.activeScenarioName === "string"
      ? result.activeScenarioName
      : null;
  const scenarios = Array.isArray(result.scenarios)
    ? result.scenarios.filter(
        (scenarioName): scenarioName is string =>
          typeof scenarioName === "string"
      )
    : [];
  const normalizedSnapshots = Array.isArray(result.snapshots)
    ? result.snapshots
        .map((snapshot) =>
          normalizeScenarioSnapshot(snapshot, activeScenarioName)
        )
        .filter(
          (snapshot): snapshot is ScenarioPanelState["snapshots"][number] =>
            snapshot !== null
        )
    : [];
  const snapshots =
    normalizedSnapshots.length > 0 || !Array.isArray(result.scenarios)
      ? normalizedSnapshots
      : scenarios.map((scenarioName) => ({
          name: scenarioName,
          source: "unknown" as const,
          hasMetadata: false,
          isActive: activeScenarioName === scenarioName
        }));

  return {
    scenarios:
      scenarios.length > 0
        ? scenarios
        : snapshots.map((snapshot) => snapshot.name),
    snapshots,
    activeScenarioName,
    activeScenarioMissing: Boolean(result.activeScenarioMissing),
    activeTrace:
      result.activeTrace && typeof result.activeTrace === "object"
        ? result.activeTrace
        : null,
    supportsTraceSave: Boolean(result.supportsTraceSave)
  };
}

export const optionsQueryKeys = {
  all: ["options"] as const,
  nativeHostConfig: () =>
    [...optionsQueryKeys.all, "nativeHostConfig"] as const,
  rememberedRootState: () =>
    [...optionsQueryKeys.all, "rememberedRootState"] as const,
  sessionSnapshot: () => [...optionsQueryKeys.all, "sessionSnapshot"] as const,
  siteConfigs: () => [...optionsQueryKeys.all, "siteConfigs"] as const,
  scenarioPanel: () => [...optionsQueryKeys.all, "scenarioPanel"] as const
};

export function createOptionsQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false
      },
      mutations: {
        retry: false
      }
    }
  });
}

export function setOptionsQueryTimeoutProvider({
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout
}: {
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
} = {}): void {
  timeoutManager.setTimeoutProvider({
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    setInterval: setIntervalFn,
    clearInterval: clearIntervalFn
  });
}

export function createNativeHostConfigQueryOptions({
  getNativeHostConfig
}: {
  getNativeHostConfig: () => Promise<NativeHostConfig>;
}) {
  return queryOptions({
    queryKey: optionsQueryKeys.nativeHostConfig(),
    queryFn: async () =>
      (await getNativeHostConfig()) ?? DEFAULT_NATIVE_HOST_CONFIG
  });
}

export function createRememberedRootStateQueryOptions({
  ensureRootSentinel = defaultEnsureRootSentinel,
  loadStoredRootHandle = defaultLoadStoredRootHandle,
  queryRootPermission = defaultQueryRootPermission
}: {
  ensureRootSentinel?: typeof defaultEnsureRootSentinel;
  loadStoredRootHandle?: typeof defaultLoadStoredRootHandle;
  queryRootPermission?: typeof defaultQueryRootPermission;
}) {
  return queryOptions({
    queryKey: optionsQueryKeys.rememberedRootState(),
    queryFn: async (): Promise<RootState> => {
      const rootHandle = await loadStoredRootHandle();
      if (!rootHandle) {
        return {
          hasHandle: false,
          permission: "prompt",
          sentinel: null
        };
      }

      const permission = await queryRootPermission(rootHandle);
      const sentinel =
        permission === "granted" ? await ensureRootSentinel(rootHandle) : null;

      return {
        hasHandle: true,
        permission,
        sentinel
      };
    }
  });
}

export function createSessionSnapshotQueryOptions({
  runtime,
  refetchIntervalMs
}: {
  runtime: MessageRuntimeApi;
  refetchIntervalMs: number | false;
}) {
  return queryOptions({
    queryKey: optionsQueryKeys.sessionSnapshot(),
    queryFn: () =>
      sendMessage<SessionSnapshot>(runtime, {
        type: "session.getState"
      }),
    refetchInterval: refetchIntervalMs
  });
}

export function createSiteConfigsQueryOptions({
  getSiteConfigs,
  refetchIntervalMs
}: {
  getSiteConfigs: () => Promise<SiteConfig[]>;
  refetchIntervalMs: number | false;
}) {
  return queryOptions({
    queryKey: optionsQueryKeys.siteConfigs(),
    queryFn: async () => normalizeSiteConfigs(await getSiteConfigs()),
    refetchInterval: refetchIntervalMs
  });
}

export function createScenarioPanelQueryOptions({
  runtime,
  refetchIntervalMs
}: {
  runtime: MessageRuntimeApi;
  refetchIntervalMs: number | false;
}) {
  return queryOptions({
    queryKey: optionsQueryKeys.scenarioPanel(),
    queryFn: async () => {
      const result = await sendMessage<ScenarioListResult>(runtime, {
        type: "scenario.list"
      });
      if (!result.ok) {
        throw new Error(getErrorMessage(result as ErrorResult));
      }

      return normalizeScenarioPanelState(result as ScenarioListRuntimeSuccess);
    },
    refetchInterval: refetchIntervalMs
  });
}

export async function refetchOptionsQuery(
  queryClient: QueryClient,
  queryKey: QueryKey
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey
  });
  await queryClient.refetchQueries({
    queryKey,
    type: "active"
  });
}
