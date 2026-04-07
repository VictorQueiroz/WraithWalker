import * as React from "react";

import { getPreferredEditorId as defaultGetPreferredEditorId, setPreferredEditorId as defaultSetPreferredEditorId } from "../lib/chrome-storage.js";
import { DEFAULT_DUMP_ALLOWLIST_PATTERNS, DEFAULT_EDITOR_ID, EDITOR_PRESETS, type EditorPreset } from "../lib/constants.js";
import { getEditorLaunchOverride, updateEditorLaunchOverride } from "../lib/editor-launch.js";
import type { BackgroundMessage, ErrorResult, NativeVerifyResult, ScenarioListResult, ScenarioResult } from "../lib/messages.js";
import { normalizeSiteInput, originToPermissionPattern } from "../lib/path-utils.js";
import {
  ensureRootSentinel as defaultEnsureRootSentinel,
  loadStoredRootHandle as defaultLoadStoredRootHandle,
  queryRootPermission as defaultQueryRootPermission,
  requestRootPermission as defaultRequestRootPermission,
  storeRootHandleWithSentinel as defaultStoreRootHandleWithSentinel
} from "../lib/root-handle.js";
import { createSiteConfig, isValidDumpAllowlistPatterns } from "../lib/site-config.js";
import type { NativeHostConfig, RootSentinel, SiteConfig } from "../lib/types.js";
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
  Select,
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
  getPreferredEditorId?: typeof defaultGetPreferredEditorId;
  setPreferredEditorId?: typeof defaultSetPreferredEditorId;
  editorPresets?: EditorPreset[];
}

function getErrorMessage(result: { error?: string }): string {
  return result.error || "Unknown error.";
}

function sendMessage<T>(runtime: RuntimeApi, message: BackgroundMessage): Promise<T> {
  return runtime.sendMessage(message) as Promise<T>;
}

function parseDumpAllowlistPatterns(text: string): string[] {
  const patterns = text
    .split(/\r\n|\n|\r/)
    .map((value) => value.trim())
    .filter(Boolean);

  return patterns.length > 0
    ? patterns
    : [...DEFAULT_DUMP_ALLOWLIST_PATTERNS];
}

function formatDumpAllowlistPatterns(patterns: string[]): string {
  return patterns.join("\n");
}

function RootStatusSummary({ rootState }: { rootState: RootState | null }) {
  if (!rootState || !rootState.hasHandle) {
    return (
      <Alert variant="default">
        No capture root is connected yet. Choose one to start writing fixtures to disk.
      </Alert>
    );
  }

  if (rootState.permission !== "granted") {
    return (
      <Alert variant="destructive">
        Chrome still knows this root, but write access needs to be reconnected before capture can start.
      </Alert>
    );
  }

  return (
    <Alert variant="success">
      Root access is ready.
      {rootState.sentinel ? ` Root ID: ${rootState.sentinel.rootId}.` : ""}
    </Alert>
  );
}

function SiteCard({
  siteConfig,
  onSave,
  onRemove
}: {
  siteConfig: SiteConfig;
  onSave: (origin: string, patch: Pick<SiteConfig, "mode" | "dumpAllowlistPatterns">) => Promise<void>;
  onRemove: (origin: string) => Promise<void>;
}) {
  const [mode, setMode] = React.useState(siteConfig.mode);
  const [patternsText, setPatternsText] = React.useState(formatDumpAllowlistPatterns(siteConfig.dumpAllowlistPatterns));
  const [busy, setBusy] = React.useState<"save" | "remove" | null>(null);

  React.useEffect(() => {
    setMode(siteConfig.mode);
    setPatternsText(formatDumpAllowlistPatterns(siteConfig.dumpAllowlistPatterns));
  }, [siteConfig.dumpAllowlistPatterns, siteConfig.mode]);

  return (
    <Card className="bg-white/80">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{siteConfig.origin}</CardTitle>
            <CardDescription>Granted pattern: {originToPermissionPattern(siteConfig.origin)}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy !== null}
              onClick={async () => {
                setBusy("save");
                try {
                  await onSave(siteConfig.origin, {
                    mode,
                    dumpAllowlistPatterns: parseDumpAllowlistPatterns(patternsText)
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
              disabled={busy !== null}
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
          <Label htmlFor={`mode-${siteConfig.origin}`}>Storage Mode</Label>
          <Select
            id={`mode-${siteConfig.origin}`}
            value={mode}
            onChange={(event) => setMode(event.currentTarget.value as SiteConfig["mode"])}
          >
            <option value="simple">Simple</option>
            <option value="advanced">Advanced</option>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`patterns-${siteConfig.origin}`}>Dump Allowlist Patterns</Label>
          <Textarea
            id={`patterns-${siteConfig.origin}`}
            value={patternsText}
            onChange={(event) => setPatternsText(event.currentTarget.value)}
            placeholder={"\\.m?(js|ts)x?$"}
          />
          <p className="text-xs text-muted-foreground">One regular expression per line.</p>
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
  getPreferredEditorId = defaultGetPreferredEditorId,
  setPreferredEditorId = defaultSetPreferredEditorId,
  editorPresets = EDITOR_PRESETS
}: OptionsAppProps) {
  const [sites, setSites] = React.useState<SiteConfig[]>([]);
  const [siteOriginInput, setSiteOriginInput] = React.useState("");
  const [rootState, setRootState] = React.useState<RootState | null>(null);
  const [nativeHostConfig, setNativeHostConfigState] = React.useState<NativeHostConfig | null>(null);
  const [preferredEditorId, setPreferredEditorIdState] = React.useState(DEFAULT_EDITOR_ID);
  const [scenarioNames, setScenarioNames] = React.useState<string[]>([]);
  const [scenarioName, setScenarioName] = React.useState("");
  const [scenarioStatus, setScenarioStatus] = React.useState<FlashState | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [flash, setFlash] = React.useState<FlashState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const preferredEditor = React.useMemo(
    () => editorPresets.find((preset) => preset.id === preferredEditorId)
      ?? editorPresets.find((preset) => preset.id === DEFAULT_EDITOR_ID)
      ?? editorPresets[0],
    [editorPresets, preferredEditorId]
  );
  const preferredOverride = nativeHostConfig
    ? getEditorLaunchOverride(nativeHostConfig, preferredEditor.id)
    : {};

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
    const sentinel = permission === "granted"
      ? await ensureRootSentinel(rootHandle)
      : null;

    setRootState({
      hasHandle: true,
      permission,
      sentinel
    });
  }, [ensureRootSentinel, loadStoredRootHandle, queryRootPermission]);

  const refreshScenarios = React.useCallback(async () => {
    try {
      const result = await sendMessage<ScenarioListResult>(chromeApi.runtime, { type: "scenario.list" });
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
      const [nextSites, nextNativeConfig, nextPreferredEditorId] = await Promise.all([
        getSiteConfigs(),
        getNativeHostConfig(),
        getPreferredEditorId()
      ]);
      setSites(nextSites);
      setNativeHostConfigState(nextNativeConfig);
      setPreferredEditorIdState(nextPreferredEditorId);
      await Promise.all([refreshRootState(), refreshScenarios()]);
    } finally {
      setLoading(false);
    }
  }, [
    getNativeHostConfig,
    getPreferredEditorId,
    getSiteConfigs,
    refreshRootState,
    refreshScenarios
  ]);

  React.useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  async function handleAddSite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFlash(null);
    try {
      const origin = normalizeSiteInput(siteOriginInput);
      const permissionPattern = originToPermissionPattern(origin);
      const granted = await chromeApi.permissions.request({ origins: [permissionPattern] });
      if (!granted) {
        throw new Error(`Host access was not granted for ${permissionPattern}.`);
      }

      const nextSites = [...sites, createSiteConfig(origin)]
        .sort((left, right) => left.origin.localeCompare(right.origin));
      await setSiteConfigs(nextSites);
      setSites(nextSites);
      setSiteOriginInput("");
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

  async function handleUpdateSite(origin: string, patch: Pick<SiteConfig, "mode" | "dumpAllowlistPatterns">) {
    if (!isValidDumpAllowlistPatterns(patch.dumpAllowlistPatterns)) {
      setFlash({
        variant: "destructive",
        text: "One or more dump allowlist patterns are invalid."
      });
      return;
    }

    try {
      const nextSites = sites.map((site) => (
        site.origin === origin
          ? {
              ...site,
              mode: patch.mode,
              dumpAllowlistPatterns: patch.dumpAllowlistPatterns
            }
          : site
      ));
      await setSiteConfigs(nextSites);
      setSites(nextSites);
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
      const permissionPattern = originToPermissionPattern(origin);
      await chromeApi.permissions.remove({ origins: [permissionPattern] });
      const nextSites = sites.filter((site) => site.origin !== origin);
      await setSiteConfigs(nextSites);
      setSites(nextSites);
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
        const rootHandle = await windowRef.showDirectoryPicker({ mode: "readwrite" });
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
      const result = await sendMessage<NativeVerifyResult>(chromeApi.runtime, { type: "native.verify" });
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
    <main className="mx-auto max-w-6xl p-6">
      <div className="extension-shell">
        <div className="extension-panel grid gap-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <Badge variant="default">WraithWalker Settings</Badge>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Exact-origin capture, streamlined.</h1>
                <p className="max-w-3xl text-sm text-muted-foreground">
                  Configure origins, connect a capture root, choose your default editor, and keep scenarios close at hand.
                </p>
              </div>
            </div>
            {loading ? <Badge variant="muted">Loading…</Badge> : null}
          </div>

          {flash ? <Alert variant={flash.variant}>{flash.text}</Alert> : null}

          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Enabled Origins</CardTitle>
                  <CardDescription>
                    Grant runtime access origin by origin and choose how fixtures should be stored.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={handleAddSite}>
                    <Input
                      aria-label="Exact origin"
                      placeholder="https://app.example.com"
                      value={siteOriginInput}
                      onChange={(event) => setSiteOriginInput(event.currentTarget.value)}
                    />
                    <Button type="submit">Add Origin</Button>
                  </form>
                  <div className="grid gap-3">
                    {sites.length > 0 ? (
                      sites.map((siteConfig) => (
                        <SiteCard
                          key={siteConfig.origin}
                          siteConfig={siteConfig}
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

              <Card>
                <CardHeader>
                  <CardTitle>Scenarios</CardTitle>
                  <CardDescription>
                    Save and switch fixture snapshots without leaving Settings.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {scenarioStatus ? <Alert variant={scenarioStatus.variant}>{scenarioStatus.text}</Alert> : null}
                  <div className="grid gap-2">
                    {scenarioNames.length > 0 ? (
                      scenarioNames.map((name) => (
                        <div key={name} className="flex items-center justify-between rounded-xl border border-border/70 bg-white/70 px-4 py-3">
                          <span className="font-medium">{name}</span>
                          <Button type="button" variant="secondary" onClick={() => void handleSwitchScenario(name)}>
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
                      onChange={(event) => setScenarioName(event.currentTarget.value)}
                    />
                    <Button type="button" onClick={() => void handleSaveScenario()}>
                      Save Scenario
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Capture Root</CardTitle>
                  <CardDescription>
                    This Chrome-granted directory is where fixture content is written.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <RootStatusSummary rootState={rootState} />
                  {rootState?.sentinel ? (
                    <div className="rounded-xl border border-border/70 bg-white/70 px-4 py-3 text-sm">
                      <div className="font-medium">Root ID</div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">{rootState.sentinel.rootId}</div>
                    </div>
                  ) : null}
                  <Button type="button" onClick={() => void handleRootAction()}>
                    {rootActionLabel}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Preferred Editor</CardTitle>
                  <CardDescription>
                    The popup opens the capture root with this editor automatically.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-2">
                    {editorPresets.map((preset) => {
                      const selected = preset.id === preferredEditor.id;
                      return (
                        <button
                          key={preset.id}
                          aria-label={`Use ${preset.label}`}
                          aria-pressed={selected}
                          className={[
                            "rounded-2xl border px-4 py-3 text-left transition-colors",
                            selected
                              ? "border-primary/30 bg-primary/10 shadow-sm"
                              : "border-border/70 bg-white/70 hover:bg-accent"
                          ].join(" ")}
                          type="button"
                          onClick={async () => {
                            await setPreferredEditorId(preset.id);
                            setPreferredEditorIdState(preset.id);
                            setFlash({
                              variant: "success",
                              text: `${preset.label} is now the default popup editor.`
                            });
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{preset.label}</span>
                            {selected ? <Badge variant="default">Default</Badge> : null}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {preset.urlTemplate
                              ? "Built-in URL launch is available."
                              : "Needs a custom URL override or native-host fallback for one-click opening."}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>Advanced Native Host</CardTitle>
                      <CardDescription>
                        Global native-host settings plus launch overrides for {preferredEditor.label}.
                      </CardDescription>
                    </div>
                    <Button type="button" variant="ghost" onClick={() => setAdvancedOpen((value) => !value)}>
                      {advancedOpen ? "Hide" : "Show"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {!advancedOpen ? (
                    <Alert variant="default">
                      Hidden by default so the common flow stays simple. Open this section when you need native-host verification or editor overrides.
                    </Alert>
                  ) : null}

                  {advancedOpen && nativeHostConfig ? (
                    <>
                      <div className="grid gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="native-host-name">Native Host Name</Label>
                          <Input
                            id="native-host-name"
                            value={nativeHostConfig.hostName}
                            onChange={(event) => {
                              const hostName = event.currentTarget.value;
                              setNativeHostConfigState((current) => (
                                current ? { ...current, hostName } : current
                              ));
                            }}
                            placeholder="com.wraithwalker.host"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="native-root-path">Absolute Root Path</Label>
                          <Input
                            id="native-root-path"
                            value={nativeHostConfig.rootPath}
                            onChange={(event) => {
                              const rootPath = event.currentTarget.value;
                              setNativeHostConfigState((current) => (
                                current ? { ...current, rootPath } : current
                              ));
                            }}
                            placeholder="/Users/you/wraithwalker-fixtures"
                          />
                        </div>
                        <Separator />
                        <div className="grid gap-2">
                          <Label htmlFor="editor-url-template">Custom URL Override For {preferredEditor.label}</Label>
                          <Input
                            id="editor-url-template"
                            value={preferredOverride.urlTemplate ?? ""}
                            onChange={(event) => {
                              const urlTemplate = event.currentTarget.value;
                              setNativeHostConfigState((current) => (
                                current
                                  ? updateEditorLaunchOverride(current, preferredEditor.id, {
                                      ...getEditorLaunchOverride(current, preferredEditor.id),
                                      urlTemplate
                                    })
                                  : current
                              ));
                            }}
                            placeholder={preferredEditor.urlTemplate || "custom://open?folder=$DIR_COMPONENT"}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="editor-command-template">Custom Command Override For {preferredEditor.label}</Label>
                          <Input
                            id="editor-command-template"
                            value={preferredOverride.commandTemplate ?? ""}
                            onChange={(event) => {
                              const commandTemplate = event.currentTarget.value;
                              setNativeHostConfigState((current) => (
                                current
                                  ? updateEditorLaunchOverride(current, preferredEditor.id, {
                                      ...getEditorLaunchOverride(current, preferredEditor.id),
                                      commandTemplate
                                    })
                                  : current
                              ));
                            }}
                            placeholder={preferredEditor.commandTemplate}
                          />
                        </div>
                        {!preferredEditor.urlTemplate ? (
                          <Alert variant="default">
                            {preferredEditor.label} does not ship with a built-in URL scheme here. Add a custom URL override if you want URL-first launching, or rely on the native host fallback.
                          </Alert>
                        ) : null}
                        <div className="grid gap-2 text-sm text-muted-foreground">
                          {nativeHostConfig.verifiedAt ? <div>Last verified: {nativeHostConfig.verifiedAt}</div> : null}
                          {nativeHostConfig.lastVerificationError ? <div>Verification error: {nativeHostConfig.lastVerificationError}</div> : null}
                          {nativeHostConfig.lastOpenError ? <div>Open error: {nativeHostConfig.lastOpenError}</div> : null}
                        </div>
                        <div className="flex flex-wrap gap-3">
                          <Button type="button" onClick={() => void handleSaveLaunchSettings()}>
                            Save Launch Settings
                          </Button>
                          <Button type="button" variant="secondary" onClick={() => void handleVerifyHelper()}>
                            Verify Helper
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
