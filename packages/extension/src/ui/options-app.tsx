import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  DEFAULT_EDITOR_ID,
  EDITOR_PRESETS,
  POPUP_REFRESH_INTERVAL_MS,
  type EditorPreset
} from "../lib/constants.js";
import { getEditorLaunchOverride } from "../lib/editor-launch.js";
import {
  deriveEditorLaunchState,
  deriveWorkspaceReadiness,
  deriveWorkspaceStatus
} from "../lib/workspace-open-state.js";
import { subscribeToWorkspaceStatusChanges } from "../lib/workspace-status-events.js";
import {
  ensureRootSentinel as defaultEnsureRootSentinel,
  loadStoredRootHandle as defaultLoadStoredRootHandle,
  queryRootPermission as defaultQueryRootPermission,
  requestRootPermission as defaultRequestRootPermission,
  storeRootHandleWithSentinel as defaultStoreRootHandleWithSentinel
} from "../lib/root-handle.js";
import type { OptionsChromeApi } from "../lib/chrome-api.js";
import type { NativeHostConfig, SiteConfig } from "../lib/types.js";
import { Alert, Badge } from "./components.js";
import {
  addSiteAction,
  chooseOrReconnectRootAction,
  confirmSwitchScenarioAction,
  copyDiagnosticsAction,
  openLaunchFolderAction,
  prepareSwitchScenarioAction,
  removeSiteAction,
  saveLaunchSettingsAction,
  saveScenarioAction,
  saveScenarioFromTraceAction,
  updateSiteAction,
  verifyHelperAction,
  type OptionsActionFlash,
  type ScenarioSwitchDialogState
} from "./options-app.actions.js";
import {
  getScenarioNameError,
  isValidScenarioName,
  withSwitchDialogTargetName
} from "./options-app.helpers.js";
import {
  EMPTY_SCENARIO_PANEL,
  createNativeHostConfigQueryOptions,
  createRememberedRootStateQueryOptions,
  createScenarioPanelQueryOptions,
  createSessionSnapshotQueryOptions,
  createSiteConfigsQueryOptions,
  optionsQueryKeys,
  refetchOptionsQuery,
  type RootState
} from "./options-app.queries.js";
import { AdvancedNativeHostSection } from "./options-advanced-section.js";
import { RememberedBrowserRootSection } from "./options-root-section.js";
import { ScenarioManagerSection } from "./options-scenario-section.js";
import { EnabledOriginsSection } from "./options-sites-section.js";
import { ScenarioSwitchDialog } from "./options-switch-dialog.js";
import { WorkspaceStatusSection } from "./options-workspace-section.js";

type FlashState = OptionsActionFlash;

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

function hasConfiguredRoot(rootState: RootState | null): boolean {
  return Boolean(rootState?.hasHandle && rootState.permission === "granted");
}

export function OptionsApp({
  windowRef = window,
  chromeApi,
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
  const [siteOriginInput, setSiteOriginInput] = React.useState("");
  const [nativeHostConfig, setNativeHostConfigState] =
    React.useState<NativeHostConfig | null>(null);
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
  const queryClient = useQueryClient();
  const pollingInterval =
    siteDraftOrigins.length > 0 ? false : refreshIntervalMs;
  const nativeHostConfigQuery = useQuery(
    createNativeHostConfigQueryOptions({
      getNativeHostConfig
    })
  );
  const rootStateQuery = useQuery(
    createRememberedRootStateQueryOptions({
      ensureRootSentinel,
      loadStoredRootHandle,
      queryRootPermission
    })
  );
  const sessionSnapshotQuery = useQuery(
    createSessionSnapshotQueryOptions({
      runtime: chromeApi.runtime,
      refetchIntervalMs: pollingInterval
    })
  );
  const siteConfigsQuery = useQuery(
    createSiteConfigsQueryOptions({
      getSiteConfigs,
      refetchIntervalMs: pollingInterval
    })
  );
  const scenarioPanelQuery = useQuery(
    createScenarioPanelQueryOptions({
      runtime: chromeApi.runtime,
      refetchIntervalMs: pollingInterval
    })
  );
  const sites = siteConfigsQuery.data ?? [];
  const rootState = rootStateQuery.data ?? null;
  const sessionSnapshot = sessionSnapshotQuery.data ?? null;
  const scenarioPanel = scenarioPanelQuery.isError
    ? EMPTY_SCENARIO_PANEL
    : (scenarioPanelQuery.data ?? EMPTY_SCENARIO_PANEL);
  const loading =
    nativeHostConfigQuery.isPending ||
    rootStateQuery.isPending ||
    sessionSnapshotQuery.isPending ||
    siteConfigsQuery.isPending ||
    scenarioPanelQuery.isPending;
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

  React.useEffect(() => {
    if (nativeHostConfigQuery.data) {
      setNativeHostConfigState(nativeHostConfigQuery.data);
    }
  }, [nativeHostConfigQuery.data]);

  React.useEffect(() => {
    if (scenarioPanelQuery.error) {
      setScenarioStatus({
        variant: "destructive",
        text:
          scenarioPanelQuery.error instanceof Error
            ? scenarioPanelQuery.error.message
            : String(scenarioPanelQuery.error)
      });
      return;
    }

    if (scenarioPanelQuery.data) {
      setScenarioStatus(null);
    }
  }, [scenarioPanelQuery.data, scenarioPanelQuery.error]);

  const refetchNativeHostConfig = React.useCallback(
    async () =>
      refetchOptionsQuery(queryClient, optionsQueryKeys.nativeHostConfig()),
    [queryClient]
  );

  const refetchSessionSnapshot = React.useCallback(
    async () =>
      refetchOptionsQuery(queryClient, optionsQueryKeys.sessionSnapshot()),
    [queryClient]
  );

  const refetchRememberedRootState = React.useCallback(
    async () =>
      refetchOptionsQuery(queryClient, optionsQueryKeys.rememberedRootState()),
    [queryClient]
  );

  const refetchSiteConfigs = React.useCallback(
    async () =>
      refetchOptionsQuery(queryClient, optionsQueryKeys.siteConfigs()),
    [queryClient]
  );

  const refetchScenarioPanel = React.useCallback(
    async () =>
      refetchOptionsQuery(queryClient, optionsQueryKeys.scenarioPanel()),
    [queryClient]
  );

  const refetchAuthorityData = React.useCallback(async () => {
    await Promise.all([
      refetchSessionSnapshot(),
      refetchSiteConfigs(),
      refetchScenarioPanel()
    ]);
  }, [refetchScenarioPanel, refetchSessionSnapshot, refetchSiteConfigs]);

  const setSiteConfigsCache = React.useCallback(
    (nextSites: SiteConfig[]) => {
      queryClient.setQueryData(optionsQueryKeys.siteConfigs(), nextSites);
    },
    [queryClient]
  );

  React.useEffect(
    () =>
      subscribeToWorkspaceStatusChanges(chromeApi.runtime, () => {
        if (siteDraftOrigins.length > 0) {
          void Promise.all([
            refetchRememberedRootState(),
            refetchSessionSnapshot(),
            refetchScenarioPanel()
          ]).catch(() => undefined);
          return;
        }

        void Promise.all([
          refetchRememberedRootState(),
          refetchAuthorityData()
        ]).catch(() => undefined);
      }),
    [
      chromeApi.runtime,
      refetchAuthorityData,
      refetchRememberedRootState,
      refetchScenarioPanel,
      refetchSessionSnapshot,
      siteDraftOrigins.length
    ]
  );

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
    const result = await addSiteAction({
      originInput: siteOriginInput,
      canEditSites,
      originsBlockedMessage,
      permissions: chromeApi.permissions,
      sites,
      setSiteConfigs,
      setSiteConfigsCache,
      refetchSessionSnapshot
    });

    setFlash(result.flash);
    setSiteOriginInput(result.nextSiteOriginInput);
  }

  async function handleUpdateSite(
    origin: string,
    patch: Pick<SiteConfig, "dumpAllowlistPatterns">
  ) {
    const result = await updateSiteAction({
      origin,
      dumpAllowlistPatterns: patch.dumpAllowlistPatterns,
      canEditSites,
      originsBlockedMessage,
      sites,
      setSiteConfigs,
      setSiteConfigsCache,
      refetchSessionSnapshot
    });

    setFlash(result.flash);
  }

  async function handleRemoveSite(origin: string) {
    setFlash(null);
    const result = await removeSiteAction({
      origin,
      canEditSites,
      originsBlockedMessage,
      permissions: chromeApi.permissions,
      sites,
      setSiteConfigs,
      setSiteConfigsCache,
      refetchSessionSnapshot
    });

    setFlash(result.flash);
  }

  async function handleRootAction() {
    setFlash(null);
    const result = await chooseOrReconnectRootAction({
      rootState,
      windowRef,
      loadStoredRootHandle,
      requestRootPermission,
      storeRootHandleWithSentinel,
      refetchRememberedRootState
    });

    if (result.kind !== "noop") {
      setFlash(result.flash);
    }
  }

  async function handleSaveLaunchSettings() {
    if (!nativeHostConfig) {
      return;
    }

    setFlash(null);
    const result = await saveLaunchSettingsAction({
      nativeHostConfig,
      setNativeHostConfig,
      refetchNativeHostConfig
    });
    if (result.kind === "success") {
      setFlash(result.flash);
    }
  }

  async function handleVerifyHelper() {
    setFlash(null);
    const result = await verifyHelperAction({
      runtime: chromeApi.runtime,
      refetchNativeHostConfig
    });

    setFlash(result.flash);
  }

  async function handleOpenLaunchFolder() {
    setFlash(null);
    const result = await openLaunchFolderAction({
      runtime: chromeApi.runtime,
      workspaceStatus
    });

    setFlash(result.flash);
  }

  async function handleCopyDiagnostics() {
    setFlash(null);
    const result = await copyDiagnosticsAction({
      runtime: chromeApi.runtime,
      writeClipboardText
    });

    setFlash(result.flash);
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
      const result = await saveScenarioAction({
        runtime: chromeApi.runtime,
        nameInput: manualScenarioName,
        descriptionInput: manualScenarioDescription,
        refetchScenarioPanel
      });

      if (result.kind === "validation_error") {
        setManualScenarioError(result.errorText);
        return;
      }

      setManualScenarioError(null);
      setFlash(result.flash);
      if (result.kind === "success") {
        setManualScenarioName(result.nextName);
        setManualScenarioDescription(result.nextDescription);
      }
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
      const result = await saveScenarioFromTraceAction({
        runtime: chromeApi.runtime,
        nameInput: traceScenarioName,
        descriptionInput: traceScenarioDescription,
        refetchScenarioPanel
      });

      if (result.kind === "validation_error") {
        setTraceScenarioError(result.errorText);
        return;
      }

      setTraceScenarioError(null);
      setFlash(result.flash);
    } finally {
      setSavingTraceScenario(false);
    }
  }

  async function handleSwitchScenario(name: string) {
    setFlash(null);
    setSwitchBusyName(name);
    try {
      const result = await prepareSwitchScenarioAction({
        runtime: chromeApi.runtime,
        targetName: name,
        activeScenarioName: scenarioPanel.activeScenarioName,
        activeScenarioMissing: scenarioPanel.activeScenarioMissing
      });

      if (result.kind === "error") {
        setFlash(result.flash);
        return;
      }

      setSwitchDialog(result.dialog);
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
          const result = await confirmSwitchScenarioAction({
            runtime: chromeApi.runtime,
            switchDialog,
            refetchScenarioPanel
          });

          if (result.kind === "success") {
            setSwitchDialog(null);
            setFlash(result.flash);
          } else if (result.kind === "error") {
            setFlash(result.flash);
          }
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
            <WorkspaceStatusSection
              sessionSnapshot={sessionSnapshot}
              workspaceStatus={workspaceStatus}
              workspaceReadiness={workspaceReadiness}
            />
            <RememberedBrowserRootSection
              rootState={rootState}
              serverConnected={serverConnected}
              serverRootPath={sessionSnapshot?.captureRootPath}
              rootActionLabel={rootActionLabel}
              onRootAction={handleRootAction}
              onOpenLaunchFolder={handleOpenLaunchFolder}
              onCopyDiagnostics={handleCopyDiagnostics}
            />
            <EnabledOriginsSection
              serverConnected={serverConnected}
              serverRootPath={sessionSnapshot?.captureRootPath}
              canEditSites={canEditSites}
              siteOriginInput={siteOriginInput}
              sites={sites}
              originsBlockedMessage={originsBlockedMessage}
              onSiteOriginInputChange={setSiteOriginInput}
              onAddSite={handleAddSite}
              onDraftingChange={handleSiteDraftingChange}
              onSaveSite={handleUpdateSite}
              onRemoveSite={handleRemoveSite}
            />
            <ScenarioManagerSection
              scenarioStatus={scenarioStatus}
              workspaceStatus={workspaceStatus}
              scenarioPanel={scenarioPanel}
              manualScenarioName={manualScenarioName}
              manualScenarioDescription={manualScenarioDescription}
              manualScenarioError={manualScenarioError}
              savingManualScenario={savingManualScenario}
              traceScenarioName={traceScenarioName}
              traceScenarioDescription={traceScenarioDescription}
              traceScenarioError={traceScenarioError}
              savingTraceScenario={savingTraceScenario}
              switchBusyName={switchBusyName}
              onManualScenarioNameChange={setManualScenarioName}
              onManualScenarioDescriptionChange={setManualScenarioDescription}
              onTraceScenarioNameChange={setTraceScenarioName}
              onTraceScenarioDescriptionChange={setTraceScenarioDescription}
              onClearManualScenarioError={() => setManualScenarioError(null)}
              onClearTraceScenarioError={() => setTraceScenarioError(null)}
              onSaveScenario={handleSaveScenario}
              onSaveScenarioFromTrace={handleSaveScenarioFromTrace}
              onSwitchScenario={handleSwitchScenario}
            />
            <AdvancedNativeHostSection
              advancedOpen={advancedOpen}
              nativeHostConfig={nativeHostConfig}
              cursorEditor={cursorEditor}
              cursorOverride={cursorOverride}
              setAdvancedOpen={setAdvancedOpen}
              setNativeHostConfigState={setNativeHostConfigState}
              onSaveLaunchSettings={handleSaveLaunchSettings}
              onVerifyHelper={handleVerifyHelper}
            />
          </div>
        </div>

        {switchDialog ? (
          <ScenarioSwitchDialog
            dialog={switchDialog}
            switchBusyName={switchBusyName}
            onCancel={() => setSwitchDialog(null)}
            onConfirm={handleConfirmSwitchScenario}
          />
        ) : null}
      </div>
    </main>
  );
}
