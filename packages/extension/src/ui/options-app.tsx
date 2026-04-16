import * as React from "react";

import {
  DEFAULT_DUMP_ALLOWLIST_PATTERNS,
  DEFAULT_EDITOR_ID,
  EDITOR_PRESETS,
  POPUP_REFRESH_INTERVAL_MS,
  type EditorPreset
} from "../lib/constants.js";
import { getEditorLaunchOverride } from "../lib/editor-launch.js";
import type {
  BackgroundMessage,
  DiagnosticsResult,
  ErrorResult,
  NativeOpenResult,
  NativeVerifyResult,
  ScenarioDiffResult,
  ScenarioListResult,
  ScenarioListSuccess,
  ScenarioResult
} from "../lib/messages.js";
import type { FixtureDiff } from "@wraithwalker/core/scenarios";
import { originToPermissionPattern } from "../lib/path-utils.js";
import {
  deriveEditorLaunchState,
  deriveWorkspaceReadiness,
  deriveWorkspaceStatus
} from "../lib/workspace-open-state.js";
import {
  createRootDirectoryPickerOptions,
  ensureRootSentinel as defaultEnsureRootSentinel,
  loadStoredRootHandle as defaultLoadStoredRootHandle,
  queryRootPermission as defaultQueryRootPermission,
  requestRootPermission as defaultRequestRootPermission,
  storeRootHandleWithSentinel as defaultStoreRootHandleWithSentinel
} from "../lib/root-handle.js";
import {
  isValidDumpAllowlistPatterns,
  normalizeSiteConfigs
} from "../lib/site-config.js";
import { whitelistSiteOrigin } from "../lib/site-whitelist.js";
import type { MessageRuntimeApi, OptionsChromeApi } from "../lib/chrome-api.js";
import type {
  NativeHostConfig,
  RootSentinel,
  SessionSnapshot,
  SiteConfig
} from "../lib/types.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Separator,
  Textarea
} from "./components.js";
import {
  withSwitchDialogTargetName,
  withUpdatedEditorCommandOverride,
  withUpdatedEditorUrlOverride
} from "./options-app.helpers.js";

interface RootState {
  hasHandle: boolean;
  permission: PermissionState;
  sentinel: RootSentinel | null;
}

interface FlashState {
  variant: "default" | "success" | "destructive";
  text: string;
}

interface ScenarioSwitchDialogState {
  targetName: string;
  diff: FixtureDiff | null;
}

type ScenarioPanelState = Omit<ScenarioListSuccess, "ok">;
type ScenarioListRuntimeSuccess = Pick<ScenarioListSuccess, "ok"> &
  Partial<ScenarioPanelState>;

const EMPTY_SCENARIO_PANEL: ScenarioPanelState = {
  scenarios: [],
  snapshots: [],
  activeScenarioName: null,
  activeScenarioMissing: false,
  activeTrace: null,
  supportsTraceSave: false
};

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

function normalizeScenarioPanelState(
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

function isValidScenarioName(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value.trim());
}

function getScenarioNameError(value: string): string | null {
  if (!value.trim()) {
    return "Enter a scenario name.";
  }

  if (!isValidScenarioName(value)) {
    return "Use 1-64 letters, numbers, hyphens, or underscores.";
  }

  return null;
}

function buildSuggestedScenarioName(
  value: string | undefined,
  fallback: string
): string {
  const base = (value?.trim() || fallback).trim();
  const normalized = base
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .slice(0, 64);

  return isValidScenarioName(normalized) ? normalized : fallback;
}

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

export interface OptionsAppProps {
  windowRef?: Window;
  chromeApi: OptionsChromeApi;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  refreshIntervalMs?: number;
  getNativeHostConfig: () => Promise<NativeHostConfig>;
  getSiteConfigs: () => Promise<SiteConfig[]>;
  setNativeHostConfig: (nativeHostConfig: NativeHostConfig) => Promise<void>;
  setSiteConfigs: (siteConfigs: SiteConfig[]) => Promise<void>;
  ensureRootSentinel?: typeof defaultEnsureRootSentinel;
  loadStoredRootHandle?: typeof defaultLoadStoredRootHandle;
  queryRootPermission?: typeof defaultQueryRootPermission;
  requestRootPermission?: typeof defaultRequestRootPermission;
  storeRootHandleWithSentinel?: typeof defaultStoreRootHandleWithSentinel;
  writeClipboardText?: (text: string) => Promise<void>;
  getPreferredEditorId?: () => Promise<string>;
  setPreferredEditorId?: (editorId: string) => Promise<void>;
  editorPresets?: EditorPreset[];
}

function getErrorMessage(result: { error?: string }): string {
  return result.error || "Unknown error.";
}

function sendMessage<T>(
  runtime: MessageRuntimeApi,
  message: BackgroundMessage
): Promise<T> {
  return runtime.sendMessage(message) as Promise<T>;
}

function parseDumpAllowlistPatterns(text: string): string[] {
  const patterns = text
    .split(/\r\n|\n|\r/)
    .map((value) => value.trim())
    .filter(Boolean);

  return patterns.length > 0 ? patterns : [...DEFAULT_DUMP_ALLOWLIST_PATTERNS];
}

function formatDumpAllowlistPatterns(patterns: string[]): string {
  return patterns.join("\n");
}

function hasConfiguredRoot(rootState: RootState | null): boolean {
  return Boolean(rootState?.hasHandle && rootState.permission === "granted");
}

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

function SectionIntro({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function SiteCard({
  siteConfig,
  disabled = false,
  onDraftingChange,
  onSave,
  onRemove
}: {
  siteConfig: SiteConfig;
  disabled?: boolean;
  onDraftingChange?: (origin: string, isDrafting: boolean) => void;
  onSave: (
    origin: string,
    patch: Pick<SiteConfig, "dumpAllowlistPatterns">
  ) => Promise<void>;
  onRemove: (origin: string) => Promise<void>;
}) {
  const formattedPatterns = React.useMemo(
    () => formatDumpAllowlistPatterns(siteConfig.dumpAllowlistPatterns),
    [siteConfig.dumpAllowlistPatterns]
  );
  const [patternsText, setPatternsText] = React.useState(formattedPatterns);
  const [busy, setBusy] = React.useState<"save" | "remove" | null>(null);
  const isDrafting = patternsText !== formattedPatterns;

  React.useEffect(() => {
    if (!isDrafting) {
      setPatternsText(formattedPatterns);
    }
  }, [formattedPatterns, isDrafting]);

  React.useEffect(() => {
    onDraftingChange?.(siteConfig.origin, isDrafting);

    return () => {
      onDraftingChange?.(siteConfig.origin, false);
    };
  }, [isDrafting, onDraftingChange, siteConfig.origin]);

  return (
    <Card className="bg-card/80">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{siteConfig.origin}</CardTitle>
            <CardDescription>
              Granted pattern: {originToPermissionPattern(siteConfig.origin)}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy !== null || disabled}
              onClick={async () => {
                setBusy("save");
                try {
                  await onSave(siteConfig.origin, {
                    dumpAllowlistPatterns:
                      parseDumpAllowlistPatterns(patternsText)
                  });
                } finally {
                  setBusy(null);
                }
              }}
            >
              Save
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy !== null || disabled}
              onClick={async () => {
                setBusy("remove");
                try {
                  await onRemove(siteConfig.origin);
                } finally {
                  setBusy(null);
                }
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor={`patterns-${siteConfig.origin}`}>
            Dump Allowlist Patterns
          </Label>
          <Textarea
            id={`patterns-${siteConfig.origin}`}
            value={patternsText}
            disabled={disabled}
            onChange={(event) => setPatternsText(event.currentTarget.value)}
            placeholder={"\\.m?(js|ts)x?$"}
          />
          <p className="text-xs text-muted-foreground">
            One regular expression per line.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function OptionsApp({
  windowRef = window,
  chromeApi,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  refreshIntervalMs = POPUP_REFRESH_INTERVAL_MS,
  getNativeHostConfig,
  getSiteConfigs,
  setNativeHostConfig,
  setSiteConfigs,
  ensureRootSentinel = defaultEnsureRootSentinel,
  loadStoredRootHandle = defaultLoadStoredRootHandle,
  queryRootPermission = defaultQueryRootPermission,
  requestRootPermission = defaultRequestRootPermission,
  storeRootHandleWithSentinel = defaultStoreRootHandleWithSentinel,
  writeClipboardText = async (text: string) => {
    if (!windowRef.navigator?.clipboard?.writeText) {
      throw new Error(
        "Clipboard access is unavailable in this browser context."
      );
    }
    await windowRef.navigator.clipboard.writeText(text);
  },
  editorPresets = EDITOR_PRESETS
}: OptionsAppProps) {
  const [sites, setSites] = React.useState<SiteConfig[]>([]);
  const [siteOriginInput, setSiteOriginInput] = React.useState("");
  const [rootState, setRootState] = React.useState<RootState | null>(null);
  const [sessionSnapshot, setSessionSnapshot] =
    React.useState<SessionSnapshot | null>(null);
  const [nativeHostConfig, setNativeHostConfigState] =
    React.useState<NativeHostConfig | null>(null);
  const [scenarioPanel, setScenarioPanel] =
    React.useState(EMPTY_SCENARIO_PANEL);
  const [manualScenarioName, setManualScenarioName] = React.useState("");
  const [manualScenarioDescription, setManualScenarioDescription] =
    React.useState("");
  const [manualScenarioError, setManualScenarioError] = React.useState<
    string | null
  >(null);
  const [traceScenarioName, setTraceScenarioName] = React.useState("");
  const [traceScenarioDescription, setTraceScenarioDescription] =
    React.useState("");
  const [traceScenarioError, setTraceScenarioError] = React.useState<
    string | null
  >(null);
  const [scenarioStatus, setScenarioStatus] = React.useState<FlashState | null>(
    null
  );
  const [savingManualScenario, setSavingManualScenario] = React.useState(false);
  const [savingTraceScenario, setSavingTraceScenario] = React.useState(false);
  const [switchBusyName, setSwitchBusyName] = React.useState<string | null>(
    null
  );
  const [switchDialog, setSwitchDialog] =
    React.useState<ScenarioSwitchDialogState | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [siteDraftOrigins, setSiteDraftOrigins] = React.useState<string[]>([]);
  const [flash, setFlash] = React.useState<FlashState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const cursorEditor = React.useMemo(
    () =>
      editorPresets.find((preset) => preset.id === DEFAULT_EDITOR_ID) ??
      editorPresets[0],
    [editorPresets]
  );
  const cursorOverride = nativeHostConfig
    ? getEditorLaunchOverride(nativeHostConfig, cursorEditor.id)
    : {};
  const serverConnected = sessionSnapshot?.captureDestination === "server";
  const canEditSites = serverConnected || hasConfiguredRoot(rootState);
  const workspaceStatus = React.useMemo(
    () =>
      deriveWorkspaceStatus({
        snapshot: sessionSnapshot,
        rememberedRootState: rootState,
        activeScenarioName: scenarioPanel.activeScenarioName,
        activeTrace: scenarioPanel.activeTrace
      }),
    [
      rootState,
      scenarioPanel.activeScenarioName,
      scenarioPanel.activeTrace,
      sessionSnapshot
    ]
  );
  const cursorEditorLaunchState = React.useMemo(
    () =>
      nativeHostConfig
        ? deriveEditorLaunchState(nativeHostConfig, cursorEditor.id)
        : null,
    [cursorEditor.id, nativeHostConfig]
  );
  const workspaceReadiness = React.useMemo(
    () =>
      deriveWorkspaceReadiness({
        snapshot: sessionSnapshot,
        workspaceStatus,
        editorLaunchState: cursorEditorLaunchState,
        editorLabel: cursorEditor.label
      }),
    [
      cursorEditor.label,
      cursorEditorLaunchState,
      sessionSnapshot,
      workspaceStatus
    ]
  );

  const refreshSessionSnapshot = React.useCallback(async () => {
    const snapshot = await sendMessage<SessionSnapshot>(chromeApi.runtime, {
      type: "session.getState"
    });
    setSessionSnapshot(snapshot);
    return snapshot;
  }, [chromeApi.runtime]);

  const refreshSiteConfigs = React.useCallback(async () => {
    const nextSites = normalizeSiteConfigs(await getSiteConfigs());
    setSites(nextSites);
    return nextSites;
  }, [getSiteConfigs]);

  const refreshRootState = React.useCallback(async () => {
    const rootHandle = await loadStoredRootHandle();
    if (!rootHandle) {
      setRootState({
        hasHandle: false,
        permission: "prompt",
        sentinel: null
      });
      return;
    }

    const permission = await queryRootPermission(rootHandle);
    const sentinel =
      permission === "granted" ? await ensureRootSentinel(rootHandle) : null;

    setRootState({
      hasHandle: true,
      permission,
      sentinel
    });
  }, [ensureRootSentinel, loadStoredRootHandle, queryRootPermission]);

  const refreshScenarios = React.useCallback(async () => {
    try {
      const result = await sendMessage<ScenarioListResult>(chromeApi.runtime, {
        type: "scenario.list"
      });
      if (!result.ok) {
        setScenarioStatus({
          variant: "destructive",
          text: getErrorMessage(result as ErrorResult)
        });
        setScenarioPanel(EMPTY_SCENARIO_PANEL);
        return;
      }

      setScenarioStatus(null);
      setScenarioPanel(
        normalizeScenarioPanelState(result as ScenarioListRuntimeSuccess)
      );
    } catch (error) {
      setScenarioStatus({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
      setScenarioPanel(EMPTY_SCENARIO_PANEL);
    }
  }, [chromeApi.runtime]);

  const refreshAuthorityData = React.useCallback(async () => {
    await Promise.all([
      refreshSessionSnapshot(),
      refreshSiteConfigs(),
      refreshScenarios()
    ]);
  }, [refreshScenarios, refreshSessionSnapshot, refreshSiteConfigs]);

  const handleSiteDraftingChange = React.useCallback(
    (origin: string, isDrafting: boolean) => {
      setSiteDraftOrigins((currentOrigins) => {
        const hasOrigin = currentOrigins.includes(origin);
        if (isDrafting) {
          return hasOrigin ? currentOrigins : [...currentOrigins, origin];
        }

        return hasOrigin
          ? currentOrigins.filter((currentOrigin) => currentOrigin !== origin)
          : currentOrigins;
      });
    },
    []
  );

  const refreshAll = React.useCallback(async () => {
    setLoading(true);
    try {
      const nextNativeConfig = await getNativeHostConfig();
      setNativeHostConfigState(nextNativeConfig);
      await Promise.all([refreshRootState(), refreshAuthorityData()]);
    } finally {
      setLoading(false);
    }
  }, [getNativeHostConfig, refreshAuthorityData, refreshRootState]);

  React.useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  React.useEffect(() => {
    const intervalId = setIntervalFn(() => {
      if (siteDraftOrigins.length > 0) {
        return;
      }

      void refreshAuthorityData().catch(() => undefined);
    }, refreshIntervalMs);

    return () => {
      clearIntervalFn(intervalId);
    };
  }, [
    clearIntervalFn,
    refreshAuthorityData,
    refreshIntervalMs,
    siteDraftOrigins.length,
    setIntervalFn
  ]);

  React.useEffect(() => {
    if (!scenarioPanel.activeTrace) {
      setTraceScenarioName("");
      setTraceScenarioDescription("");
      setTraceScenarioError(null);
      return;
    }

    setTraceScenarioName(
      buildSuggestedScenarioName(
        scenarioPanel.activeTrace.name,
        scenarioPanel.activeTrace.traceId
      )
    );
    setTraceScenarioDescription(scenarioPanel.activeTrace.goal ?? "");
    setTraceScenarioError(null);
  }, [scenarioPanel.activeTrace]);

  async function handleAddSite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFlash(null);
    try {
      if (!canEditSites) {
        throw new Error(originsBlockedMessage);
      }

      const result = await whitelistSiteOrigin({
        originInput: siteOriginInput,
        requestHostPermission: async (permissionPattern) =>
          chromeApi.permissions.request({
            origins: [permissionPattern]
          }),
        readSiteConfigs: async () => sites,
        writeSiteConfigs: setSiteConfigs
      });

      setSites(result.siteConfigs);
      if (result.outcome === "already_enabled") {
        setFlash({
          variant: "default",
          text: `Origin ${result.origin} is already enabled.`
        });
      } else {
        setSiteOriginInput("");
        await refreshSessionSnapshot();
        setFlash({
          variant: "success",
          text: "Origin added and host access granted."
        });
      }
    } catch (error) {
      setFlash({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleUpdateSite(
    origin: string,
    patch: Pick<SiteConfig, "dumpAllowlistPatterns">
  ) {
    if (!canEditSites) {
      setFlash({
        variant: "destructive",
        text: originsBlockedMessage
      });
      return;
    }

    if (!isValidDumpAllowlistPatterns(patch.dumpAllowlistPatterns)) {
      setFlash({
        variant: "destructive",
        text: "One or more dump allowlist patterns are invalid."
      });
      return;
    }

    try {
      const nextSites = sites.map((site) =>
        site.origin === origin
          ? {
              ...site,
              dumpAllowlistPatterns: patch.dumpAllowlistPatterns
            }
          : site
      );
      await setSiteConfigs(nextSites);
      setSites(nextSites);
      await refreshSessionSnapshot();
      setFlash({
        variant: "success",
        text: `Updated ${origin}.`
      });
    } catch (error) {
      setFlash({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleRemoveSite(origin: string) {
    setFlash(null);
    try {
      if (!canEditSites) {
        throw new Error(originsBlockedMessage);
      }

      const permissionPattern = originToPermissionPattern(origin);
      const nextSites = sites.filter((site) => site.origin !== origin);
      await setSiteConfigs(nextSites);
      setSites(nextSites);
      await Promise.resolve(
        chromeApi.permissions.remove({ origins: [permissionPattern] })
      ).catch(() => false);
      await refreshSessionSnapshot();
      setFlash({
        variant: "success",
        text: `Removed ${origin}.`
      });
    } catch (error) {
      setFlash({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleRootAction() {
    setFlash(null);
    try {
      if (!rootState?.hasHandle || rootState.permission === "granted") {
        const currentHandle = rootState?.hasHandle
          ? await loadStoredRootHandle()
          : undefined;
        const rootHandle = await windowRef.showDirectoryPicker(
          createRootDirectoryPickerOptions(currentHandle)
        );
        const sentinel = await storeRootHandleWithSentinel(rootHandle);
        await refreshRootState();
        setFlash({
          variant: "success",
          text: `Root directory saved. Root ID: ${sentinel.rootId}.`
        });
        return;
      }

      const rootHandle = await loadStoredRootHandle();
      if (!rootHandle) {
        throw new Error("Choose a root directory first.");
      }

      const permission = await requestRootPermission(rootHandle);
      await refreshRootState();
      setFlash({
        variant: permission === "granted" ? "success" : "destructive",
        text: `Root permission status: ${permission}.`
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setFlash({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleSaveLaunchSettings() {
    if (!nativeHostConfig) {
      return;
    }

    setFlash(null);
    await setNativeHostConfig(nativeHostConfig);
    const refreshedConfig = await getNativeHostConfig();
    setNativeHostConfigState(refreshedConfig);
    setFlash({
      variant: "success",
      text: "Launch settings saved."
    });
  }

  async function handleVerifyHelper() {
    setFlash(null);
    try {
      const result = await sendMessage<NativeVerifyResult>(chromeApi.runtime, {
        type: "native.verify"
      });
      const refreshedConfig = await getNativeHostConfig();
      setNativeHostConfigState(refreshedConfig);
      if (!result.ok) {
        throw new Error(getErrorMessage(result as ErrorResult));
      }
      setFlash({
        variant: "success",
        text: `Helper verified at ${result.verifiedAt}.`
      });
    } catch (error) {
      setFlash({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleOpenLaunchFolder() {
    setFlash(null);
    try {
      const result = await sendMessage<NativeOpenResult>(chromeApi.runtime, {
        type: "native.revealRoot"
      });
      if (!result.ok) {
        throw new Error(getErrorMessage(result as ErrorResult));
      }
      setFlash({
        variant: "success",
        text:
          workspaceStatus.authority === "none"
            ? "Opened the active root in the OS file manager."
            : `Opened ${workspaceStatus.authorityLabel} in the OS file manager.`
      });
    } catch (error) {
      setFlash({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleCopyDiagnostics() {
    setFlash(null);
    try {
      const result = await sendMessage<DiagnosticsResult>(chromeApi.runtime, {
        type: "diagnostics.getReport"
      });
      if (!result.ok) {
        throw new Error(getErrorMessage(result as ErrorResult));
      }

      await writeClipboardText(JSON.stringify(result.report, null, 2));
      setFlash({
        variant: "success",
        text: "Support diagnostics copied to clipboard."
      });
    } catch (error) {
      setFlash({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleSaveScenario() {
    const nameError = getScenarioNameError(manualScenarioName);
    if (nameError) {
      setManualScenarioError(nameError);
      return;
    }

    setFlash(null);
    setManualScenarioError(null);
    setSavingManualScenario(true);
    try {
      const result = await sendMessage<ScenarioResult>(chromeApi.runtime, {
        type: "scenario.save",
        name: manualScenarioName.trim(),
        ...(manualScenarioDescription.trim()
          ? { description: manualScenarioDescription.trim() }
          : {})
      });
      if (!result.ok) {
        throw new Error(getErrorMessage(result as ErrorResult));
      }
      setManualScenarioName("");
      setManualScenarioDescription("");
      await refreshScenarios();
      setFlash({
        variant: "success",
        text: `Scenario "${result.name}" saved.`
      });
    } catch (error) {
      setFlash({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSavingManualScenario(false);
    }
  }

  async function handleSaveScenarioFromTrace() {
    const nameError = getScenarioNameError(traceScenarioName);
    if (nameError) {
      setTraceScenarioError(nameError);
      return;
    }

    setFlash(null);
    setTraceScenarioError(null);
    setSavingTraceScenario(true);
    try {
      const result = await sendMessage<ScenarioResult>(chromeApi.runtime, {
        type: "scenario.saveFromTrace",
        name: traceScenarioName.trim(),
        ...(traceScenarioDescription.trim()
          ? { description: traceScenarioDescription.trim() }
          : {})
      });
      if (!result.ok) {
        throw new Error(getErrorMessage(result as ErrorResult));
      }
      await refreshScenarios();
      setFlash({
        variant: "success",
        text: `Scenario "${result.name}" saved from the active trace.`
      });
    } catch (error) {
      setFlash({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSavingTraceScenario(false);
    }
  }

  async function handleSwitchScenario(name: string) {
    setFlash(null);
    setSwitchBusyName(name);
    try {
      if (
        scenarioPanel.activeScenarioName &&
        !scenarioPanel.activeScenarioMissing &&
        scenarioPanel.activeScenarioName !== name
      ) {
        const diffResult = await sendMessage<ScenarioDiffResult>(
          chromeApi.runtime,
          {
            type: "scenario.diff",
            scenarioA: scenarioPanel.activeScenarioName,
            scenarioB: name
          }
        );
        if (!diffResult.ok) {
          throw new Error(getErrorMessage(diffResult as ErrorResult));
        }

        setSwitchDialog({
          targetName: name,
          diff: diffResult.diff
        });
        return;
      }

      setSwitchDialog({
        targetName: name,
        diff: null
      });
    } catch (error) {
      setFlash({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSwitchBusyName(null);
    }
  }

  async function handleConfirmSwitchScenario() {
    return withSwitchDialogTargetName(
      switchDialog,
      async (switchTargetName) => {
        setFlash(null);
        setSwitchBusyName(switchTargetName);
        try {
          const result = await sendMessage<ScenarioResult>(chromeApi.runtime, {
            type: "scenario.switch",
            name: switchTargetName
          });
          if (!result.ok) {
            throw new Error(getErrorMessage(result as ErrorResult));
          }
          setSwitchDialog(null);
          await refreshScenarios();
          setFlash({
            variant: "success",
            text: `Switched to "${result.name}".`
          });
        } catch (error) {
          setFlash({
            variant: "destructive",
            text: error instanceof Error ? error.message : String(error)
          });
        } finally {
          setSwitchBusyName(null);
        }
      }
    );
  }

  const rootActionLabel = !rootState?.hasHandle
    ? "Choose Root Directory"
    : rootState.permission === "granted"
      ? "Change Root Directory"
      : "Reconnect Root Directory";
  const switchDialogPreview = switchDialog?.diff
    ? buildDiffPreview(switchDialog.diff)
    : [];
  const originsBlockedMessage =
    rootActionLabel === "Reconnect Root Directory"
      ? "Reconnect Root Directory above before adding origins, or connect the local WraithWalker server."
      : "Choose Root Directory above before adding origins, or connect the local WraithWalker server.";

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="extension-shell">
        <div className="extension-panel grid gap-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <Badge variant="default">WraithWalker Settings</Badge>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Choose the WraithWalker root first, everything else second.
                </h1>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  Reuse the last granted root, keep exact origins tidy, and make
                  Cursor the default one-click workspace action.
                </p>
              </div>
            </div>
            {loading ? <Badge variant="muted">Loading…</Badge> : null}
          </div>

          {flash ? <Alert variant={flash.variant}>{flash.text}</Alert> : null}

          <div className="grid gap-6">
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
                <div
                  className="grid gap-3"
                  aria-label="Capture readiness checklist"
                >
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
                  serverRootPath={sessionSnapshot?.captureRootPath}
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
                  onClick={() => void handleRootAction()}
                >
                  {rootActionLabel}
                </Button>
                <Button
                  className="sm:w-fit"
                  type="button"
                  variant="secondary"
                  onClick={() => void handleOpenLaunchFolder()}
                >
                  Open Active Root Folder
                </Button>
                <Button
                  className="sm:w-fit"
                  type="button"
                  variant="ghost"
                  onClick={() => void handleCopyDiagnostics()}
                >
                  Copy Support Diagnostics
                </Button>
                <p className="text-xs text-muted-foreground">
                  The directory picker remembers the browser-side fallback.
                  Opening the active workspace in Finder or Explorer still goes
                  through the shared reveal flow below.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <SectionIntro
                  title="Enabled Origins"
                  description="Grant exact host access one origin at a time. These rules are stored in Server Root when connected, otherwise in Remembered Browser Root."
                />
              </CardHeader>
              <CardContent className="grid gap-4">
                {serverConnected ? (
                  <Alert variant="success">
                    Server Root is active.
                    {sessionSnapshot?.captureRootPath
                      ? ` Editing ${sessionSnapshot.captureRootPath}.`
                      : " Editing Server Root."}
                  </Alert>
                ) : null}
                <form
                  className="grid gap-3 sm:grid-cols-[1fr_auto]"
                  onSubmit={handleAddSite}
                >
                  <Input
                    aria-label="Exact origin"
                    placeholder="https://app.example.com"
                    disabled={!canEditSites}
                    value={siteOriginInput}
                    onChange={(event) =>
                      setSiteOriginInput(event.currentTarget.value)
                    }
                  />
                  <Button type="submit" disabled={!canEditSites}>
                    Add Origin
                  </Button>
                </form>
                <div className="grid gap-3">
                  {!canEditSites ? (
                    <Alert variant="default">{originsBlockedMessage}</Alert>
                  ) : sites.length > 0 ? (
                    sites.map((siteConfig) => (
                      <SiteCard
                        key={siteConfig.origin}
                        siteConfig={siteConfig}
                        disabled={!canEditSites}
                        onDraftingChange={handleSiteDraftingChange}
                        onSave={handleUpdateSite}
                        onRemove={handleRemoveSite}
                      />
                    ))
                  ) : (
                    <Alert variant="default">
                      Add your first origin above to make capture useful.
                    </Alert>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <SectionIntro
                  title="Scenario Manager"
                  description="Snapshots use Server Root when connected, otherwise Remembered Browser Root."
                />
              </CardHeader>
              <CardContent className="grid gap-6">
                {scenarioStatus ? (
                  <Alert variant={scenarioStatus.variant}>
                    {scenarioStatus.text}
                  </Alert>
                ) : null}

                <div className="grid gap-3 rounded-xl border border-border/70 bg-card/70 p-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="default">
                      Snapshots in {workspaceStatus.authorityLabel}
                    </Badge>
                    <Badge
                      variant={
                        workspaceStatus.activeSnapshotName ? "success" : "muted"
                      }
                    >
                      Active snapshot:{" "}
                      {workspaceStatus.activeSnapshotName ?? "None"}
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
                      The active snapshot marker lives in the active root and
                      only changes when you switch.
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
                      {scenarioPanel.activeScenarioName}", but that snapshot is
                      missing from this root.
                    </Alert>
                  ) : null}

                  <form
                    className="grid gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleSaveScenario();
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
                          setManualScenarioName(event.currentTarget.value);
                          setManualScenarioError(null);
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
                          setManualScenarioDescription(
                            event.currentTarget.value
                          )
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

                {scenarioPanel.supportsTraceSave &&
                scenarioPanel.activeTrace ? (
                  <div className="grid gap-4 rounded-xl border border-border/70 bg-card/70 p-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold">
                        Save From Active Trace
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Snapshot the current workspace with trace provenance
                        attached while the server-backed trace is active.
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
                        <span>
                          Trace ID: {scenarioPanel.activeTrace.traceId}
                        </span>
                        <span>
                          Steps: {scenarioPanel.activeTrace.stepCount}
                        </span>
                        <span>
                          Linked fixtures:{" "}
                          {scenarioPanel.activeTrace.linkedFixtureCount}
                        </span>
                        <span>
                          Origins:{" "}
                          {scenarioPanel.activeTrace.selectedOrigins.length}
                        </span>
                      </div>
                    </div>

                    <form
                      className="grid gap-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleSaveScenarioFromTrace();
                      }}
                    >
                      <div className="grid gap-2">
                        <Label htmlFor="trace-scenario-name">
                          Scenario name
                        </Label>
                        <Input
                          id="trace-scenario-name"
                          aria-label="Trace scenario name"
                          placeholder="trace_snapshot"
                          disabled={savingTraceScenario}
                          value={traceScenarioName}
                          onChange={(event) => {
                            setTraceScenarioName(event.currentTarget.value);
                            setTraceScenarioError(null);
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
                            setTraceScenarioDescription(
                              event.currentTarget.value
                            )
                          }
                        />
                      </div>
                      <div className="flex justify-end">
                        <Button type="submit" disabled={savingTraceScenario}>
                          {savingTraceScenario
                            ? "Saving..."
                            : "Save Trace Snapshot"}
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
                        Active snapshots stay pinned first, then the rest sort
                        by newest saved time.
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
                                <span className="font-medium">
                                  {snapshot.name}
                                </span>
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
                                    {snapshot.sourceTrace.linkedFixtureCount}{" "}
                                    linked fixtures
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={snapshot.isActive || switchBusy}
                              onClick={() =>
                                void handleSwitchScenario(snapshot.name)
                              }
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

            <Card className="opacity-90">
              <CardHeader className="gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle>Advanced Native Host</CardTitle>
                    <CardDescription>
                      Collapsed by default so the main flow stays focused on the
                      active root and default editor.
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setAdvancedOpen((value) => !value)}
                  >
                    {advancedOpen ? "Hide" : "Show"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                {!advancedOpen ? (
                  <Alert variant="default">
                    Hidden by default so the common flow stays simple. Open this
                    section when you need native-host verification or editor
                    overrides.
                  </Alert>
                ) : null}

                {advancedOpen && nativeHostConfig ? (
                  <div className="grid gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="native-host-name">Native Host Name</Label>
                      <Input
                        id="native-host-name"
                        value={nativeHostConfig.hostName}
                        onChange={(event) => {
                          const hostName = event.currentTarget.value;
                          setNativeHostConfigState((current) =>
                            current ? { ...current, hostName } : current
                          );
                        }}
                        placeholder="com.wraithwalker.host"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="native-root-path">
                        Shared Editor Launch Path
                      </Label>
                      <Input
                        id="native-root-path"
                        value={nativeHostConfig.launchPath}
                        onChange={(event) => {
                          const launchPath = event.currentTarget.value;
                          setNativeHostConfigState((current) =>
                            current ? { ...current, launchPath } : current
                          );
                        }}
                        placeholder="/Users/you/wraithwalker-fixtures"
                      />
                      <p className="text-xs text-muted-foreground">
                        Needed when you want Cursor to open Remembered Browser
                        Root directly, or when using the native host fallback.
                        Without it, Cursor can still launch and receive the
                        workspace brief through its prompt deeplink, but Chrome
                        does not expose the absolute local path back to the
                        extension.
                      </p>
                    </div>
                    <Separator />
                    <div className="grid gap-2">
                      <Label htmlFor="editor-url-template">
                        Custom URL Override For Cursor
                      </Label>
                      <Input
                        id="editor-url-template"
                        value={cursorOverride.urlTemplate ?? ""}
                        onChange={(event) => {
                          const urlTemplate = event.currentTarget.value;
                          setNativeHostConfigState((current) =>
                            withUpdatedEditorUrlOverride(
                              current,
                              cursorEditor.id,
                              urlTemplate
                            )
                          );
                        }}
                        placeholder={
                          cursorEditor.urlTemplate ||
                          "custom://open?folder=$DIR_COMPONENT"
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="editor-command-template">
                        Custom Command Override For Cursor
                      </Label>
                      <Input
                        id="editor-command-template"
                        value={cursorOverride.commandTemplate ?? ""}
                        onChange={(event) => {
                          const commandTemplate = event.currentTarget.value;
                          setNativeHostConfigState((current) =>
                            withUpdatedEditorCommandOverride(
                              current,
                              cursorEditor.id,
                              commandTemplate
                            )
                          );
                        }}
                        placeholder={cursorEditor.commandTemplate}
                      />
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        type="button"
                        onClick={() => void handleSaveLaunchSettings()}
                      >
                        Save Launch Settings
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void handleVerifyHelper()}
                      >
                        Verify Helper
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>

        {switchDialog ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
            <Card
              role="dialog"
              aria-modal="true"
              aria-label={`Switch to ${switchDialog.targetName}`}
              className="w-full max-w-xl"
            >
              <CardHeader>
                <CardTitle>Switch Snapshot</CardTitle>
                <CardDescription>
                  {switchDialog.diff
                    ? `Compare "${switchDialog.diff.scenarioA}" with "${switchDialog.targetName}" before replacing the current workspace.`
                    : `Replace the current workspace with "${switchDialog.targetName}".`}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                {switchDialog.diff ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-border/70 bg-card/70 px-4 py-3">
                        <div className="text-xs text-muted-foreground">
                          Added
                        </div>
                        <div className="text-lg font-semibold">
                          {switchDialog.diff.added.length}
                        </div>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-card/70 px-4 py-3">
                        <div className="text-xs text-muted-foreground">
                          Removed
                        </div>
                        <div className="text-lg font-semibold">
                          {switchDialog.diff.removed.length}
                        </div>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-card/70 px-4 py-3">
                        <div className="text-xs text-muted-foreground">
                          Changed
                        </div>
                        <div className="text-lg font-semibold">
                          {switchDialog.diff.changed.length}
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
                        No endpoint differences were detected between these
                        snapshots.
                      </Alert>
                    )}
                  </>
                ) : (
                  <Alert variant="default">
                    No active snapshot baseline is available, so this switch
                    will proceed without a diff preview.
                  </Alert>
                )}

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={switchBusyName === switchDialog.targetName}
                    onClick={() => setSwitchDialog(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={switchBusyName === switchDialog.targetName}
                    onClick={() => void handleConfirmSwitchScenario()}
                  >
                    {switchBusyName === switchDialog.targetName
                      ? "Switching..."
                      : "Confirm Switch"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </main>
  );
}
