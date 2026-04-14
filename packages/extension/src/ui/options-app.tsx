import * as React from "react";

import {
  DEFAULT_DUMP_ALLOWLIST_PATTERNS,
  DEFAULT_EDITOR_ID,
  EDITOR_PRESETS,
  type EditorPreset
} from "../lib/constants.js";
import {
  getEditorLaunchOverride,
  updateEditorLaunchOverride
} from "../lib/editor-launch.js";
import type {
  BackgroundMessage,
  DiagnosticsResult,
  ErrorResult,
  NativeOpenResult,
  NativeVerifyResult,
  ScenarioListResult,
  ScenarioResult
} from "../lib/messages.js";
import {
  normalizeSiteInput,
  originToPermissionPattern
} from "../lib/path-utils.js";
import {
  createRootDirectoryPickerOptions,
  ensureRootSentinel as defaultEnsureRootSentinel,
  loadStoredRootHandle as defaultLoadStoredRootHandle,
  queryRootPermission as defaultQueryRootPermission,
  requestRootPermission as defaultRequestRootPermission,
  storeRootHandleWithSentinel as defaultStoreRootHandleWithSentinel
} from "../lib/root-handle.js";
import {
  createConfiguredSiteConfig,
  isValidDumpAllowlistPatterns
} from "../lib/site-config.js";
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

interface PermissionsApi {
  request(options: { origins: string[] }): Promise<boolean>;
  remove(options: { origins: string[] }): Promise<boolean>;
}

interface RuntimeApi {
  sendMessage(message: BackgroundMessage): Promise<unknown>;
}

interface ChromeApi {
  permissions: PermissionsApi;
  runtime: RuntimeApi;
}

interface RootState {
  hasHandle: boolean;
  permission: PermissionState;
  sentinel: RootSentinel | null;
}

interface FlashState {
  variant: "default" | "success" | "destructive";
  text: string;
}

export interface OptionsAppProps {
  windowRef?: Window;
  chromeApi: ChromeApi;
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
  runtime: RuntimeApi,
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
        Connected to the local WraithWalker server.
        {serverRootPath
          ? ` Settings changes are using ${serverRootPath}.`
          : " Settings changes are using the server root."}{" "}
        A browser-local root is optional fallback only.
      </Alert>
    );
  }

  if (!rootState || !rootState.hasHandle) {
    return (
      <Alert variant="default">
        No WraithWalker root directory is connected yet. Choose one to start
        writing fixtures to disk.
      </Alert>
    );
  }

  if (rootState.permission !== "granted") {
    return (
      <Alert variant="destructive">
        Chrome still knows this WraithWalker root directory, but write access
        needs to be reconnected before capture can start.
      </Alert>
    );
  }

  return (
    <Alert variant="success">
      WraithWalker root access is ready.
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
  onSave,
  onRemove
}: {
  siteConfig: SiteConfig;
  disabled?: boolean;
  onSave: (
    origin: string,
    patch: Pick<SiteConfig, "dumpAllowlistPatterns">
  ) => Promise<void>;
  onRemove: (origin: string) => Promise<void>;
}) {
  const [patternsText, setPatternsText] = React.useState(
    formatDumpAllowlistPatterns(siteConfig.dumpAllowlistPatterns)
  );
  const [busy, setBusy] = React.useState<"save" | "remove" | null>(null);

  React.useEffect(() => {
    setPatternsText(
      formatDumpAllowlistPatterns(siteConfig.dumpAllowlistPatterns)
    );
  }, [siteConfig.dumpAllowlistPatterns]);

  return (
    <Card className="bg-white/80">
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
  const [scenarioNames, setScenarioNames] = React.useState<string[]>([]);
  const [scenarioName, setScenarioName] = React.useState("");
  const [scenarioStatus, setScenarioStatus] = React.useState<FlashState | null>(
    null
  );
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
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

  const refreshSessionSnapshot = React.useCallback(async () => {
    const snapshot = await sendMessage<SessionSnapshot>(chromeApi.runtime, {
      type: "session.getState"
    });
    setSessionSnapshot(snapshot);
    return snapshot;
  }, [chromeApi.runtime]);

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
        setScenarioNames([]);
        return;
      }

      setScenarioStatus(null);
      setScenarioNames(result.scenarios);
    } catch (error) {
      setScenarioStatus({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
      setScenarioNames([]);
    }
  }, [chromeApi.runtime]);

  const refreshAll = React.useCallback(async () => {
    setLoading(true);
    try {
      const nextSites = await getSiteConfigs();
      const [nextSessionSnapshot, nextNativeConfig] = await Promise.all([
        refreshSessionSnapshot(),
        getNativeHostConfig()
      ]);
      setSites(nextSites);
      setSessionSnapshot(nextSessionSnapshot);
      setNativeHostConfigState(nextNativeConfig);
      await Promise.all([refreshRootState(), refreshScenarios()]);
    } finally {
      setLoading(false);
    }
  }, [
    getNativeHostConfig,
    getSiteConfigs,
    refreshRootState,
    refreshScenarios,
    refreshSessionSnapshot
  ]);

  React.useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  async function handleAddSite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFlash(null);
    try {
      if (!canEditSites) {
        throw new Error(
          "Choose and connect a WraithWalker root directory, or connect the local WraithWalker server, before configuring origins or dump patterns."
        );
      }

      const origin = normalizeSiteInput(siteOriginInput);
      const permissionPattern = originToPermissionPattern(origin);
      const granted = await chromeApi.permissions.request({
        origins: [permissionPattern]
      });
      if (!granted) {
        throw new Error(
          `Host access was not granted for ${permissionPattern}.`
        );
      }

      const nextSites = [...sites, createConfiguredSiteConfig(origin)].sort(
        (left, right) => left.origin.localeCompare(right.origin)
      );
      await setSiteConfigs(nextSites);
      setSites(nextSites);
      setSiteOriginInput("");
      await refreshSessionSnapshot();
      setFlash({
        variant: "success",
        text: "Origin added and host access granted."
      });
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
        text: "Choose and connect a WraithWalker root directory, or connect the local WraithWalker server, before configuring origins or dump patterns."
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
        throw new Error(
          "Choose and connect a WraithWalker root directory, or connect the local WraithWalker server, before configuring origins or dump patterns."
        );
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
        text: "Opened the launch folder in the OS file manager."
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
        text: "Diagnostics copied to clipboard."
      });
    } catch (error) {
      setFlash({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function handleSaveScenario() {
    if (!scenarioName.trim()) {
      return;
    }

    setFlash(null);
    try {
      const result = await sendMessage<ScenarioResult>(chromeApi.runtime, {
        type: "scenario.save",
        name: scenarioName.trim()
      });
      if (!result.ok) {
        throw new Error(getErrorMessage(result as ErrorResult));
      }
      setScenarioName("");
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
    }
  }

  async function handleSwitchScenario(name: string) {
    setFlash(null);
    try {
      const result = await sendMessage<ScenarioResult>(chromeApi.runtime, {
        type: "scenario.switch",
        name
      });
      if (!result.ok) {
        throw new Error(getErrorMessage(result as ErrorResult));
      }
      setFlash({
        variant: "success",
        text: `Switched to "${result.name}".`
      });
    } catch (error) {
      setFlash({
        variant: "destructive",
        text: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const rootActionLabel = !rootState?.hasHandle
    ? "Choose Root Directory"
    : rootState.permission === "granted"
      ? "Change Root Directory"
      : "Reconnect Root Directory";

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
                  title="WraithWalker Root"
                  description="This Chrome-granted WraithWalker root directory is remembered and reused whenever permission is still available."
                />
              </CardHeader>
              <CardContent className="grid gap-4">
                <RootStatusSummary
                  rootState={rootState}
                  serverConnected={serverConnected}
                  serverRootPath={sessionSnapshot?.captureRootPath}
                />
                {rootState?.sentinel ? (
                  <div className="rounded-xl border border-border/70 bg-white/70 px-4 py-3 text-sm">
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
                  Open Launch Folder
                </Button>
                <Button
                  className="sm:w-fit"
                  type="button"
                  variant="secondary"
                  onClick={() => void handleCopyDiagnostics()}
                >
                  Copy Diagnostics
                </Button>
                <p className="text-xs text-muted-foreground">
                  Chrome can remember the selected directory handle, but opening
                  that folder in Finder or Explorer still requires the native
                  host plus the shared launch path below.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <SectionIntro
                  title="Enabled Origins"
                  description="Grant exact host access one origin at a time. These origin rules are stored in the connected local server root when available, otherwise in the selected WraithWalker root."
                />
              </CardHeader>
              <CardContent className="grid gap-4">
                {serverConnected ? (
                  <Alert variant="success">
                    Connected to the local WraithWalker server.
                    {sessionSnapshot?.captureRootPath
                      ? ` Editing ${sessionSnapshot.captureRootPath}.`
                      : " Editing the server root."}
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
                    <Alert variant="default">
                      Choose and connect a WraithWalker root directory, or
                      connect the local WraithWalker server, before configuring
                      origins or dump patterns.
                    </Alert>
                  ) : sites.length > 0 ? (
                    sites.map((siteConfig) => (
                      <SiteCard
                        key={siteConfig.origin}
                        siteConfig={siteConfig}
                        disabled={!canEditSites}
                        onSave={handleUpdateSite}
                        onRemove={handleRemoveSite}
                      />
                    ))
                  ) : (
                    <Alert variant="default">No origins are enabled yet.</Alert>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="opacity-90">
              <CardHeader>
                <SectionIntro
                  title="Scenarios"
                  description="Secondary controls for saving and switching fixture snapshots when you need them."
                />
              </CardHeader>
              <CardContent className="grid gap-4">
                {scenarioStatus ? (
                  <Alert variant={scenarioStatus.variant}>
                    {scenarioStatus.text}
                  </Alert>
                ) : null}
                <div className="grid gap-2">
                  {scenarioNames.length > 0 ? (
                    scenarioNames.map((name) => (
                      <div
                        key={name}
                        className="flex items-center justify-between rounded-xl border border-border/70 bg-white/70 px-4 py-3"
                      >
                        <span className="font-medium">{name}</span>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void handleSwitchScenario(name)}
                        >
                          Switch
                        </Button>
                      </div>
                    ))
                  ) : (
                    <Alert variant="default">No scenarios saved yet.</Alert>
                  )}
                </div>
                <Separator />
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <Input
                    aria-label="Scenario name"
                    placeholder="baseline"
                    value={scenarioName}
                    onChange={(event) =>
                      setScenarioName(event.currentTarget.value)
                    }
                  />
                  <Button
                    type="button"
                    onClick={() => void handleSaveScenario()}
                  >
                    Save Scenario
                  </Button>
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
                      remembered root and default editor.
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
                        Needed when you want Cursor to open the remembered root
                        directly, or when using the native host fallback.
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
                            current
                              ? updateEditorLaunchOverride(
                                  current,
                                  cursorEditor.id,
                                  {
                                    ...getEditorLaunchOverride(
                                      current,
                                      cursorEditor.id
                                    ),
                                    urlTemplate
                                  }
                                )
                              : current
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
                            current
                              ? updateEditorLaunchOverride(
                                  current,
                                  cursorEditor.id,
                                  {
                                    ...getEditorLaunchOverride(
                                      current,
                                      cursorEditor.id
                                    ),
                                    commandTemplate
                                  }
                                )
                              : current
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
      </div>
    </main>
  );
}
