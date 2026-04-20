import type { FixtureDiff } from "@wraithwalker/core/scenarios";

import type {
  MessageRuntimeApi,
  OptionsPermissionsApi
} from "../lib/chrome-api.js";
import type {
  BackgroundMessage,
  DiagnosticsResult,
  ErrorResult,
  NativeOpenResult,
  NativeVerifyResult,
  ScenarioDiffResult,
  ScenarioResult
} from "../lib/messages.js";
import { originToPermissionPattern } from "../lib/path-utils.js";
import { createRootDirectoryPickerOptions } from "../lib/root-handle.js";
import { isValidDumpAllowlistPatterns } from "../lib/site-config.js";
import { whitelistSiteOrigin } from "../lib/site-whitelist.js";
import type { NativeHostConfig, SiteConfig } from "../lib/types.js";
import type { WorkspaceStatus } from "../lib/workspace-open-state.js";
import {
  getScenarioNameError,
  getSwitchDialogTargetName
} from "./options-app.helpers.js";

export interface OptionsActionFlash {
  variant: "default" | "success" | "destructive";
  text: string;
}

export interface ScenarioSwitchDialogState {
  targetName: string;
  diff: FixtureDiff | null;
}

interface OptionsActionErrorResult {
  kind: "error";
  flash: OptionsActionFlash;
}

interface OptionsActionNoopResult {
  kind: "noop";
}

interface OptionsActionValidationResult {
  kind: "validation_error";
  errorText: string;
}

function getErrorMessage(result: { error?: string }): string {
  return result.error || "Unknown error.";
}

function buildErrorFlash(error: unknown): OptionsActionFlash {
  return {
    variant: "destructive",
    text: error instanceof Error ? error.message : String(error)
  };
}

function sendMessage<T>(
  runtime: MessageRuntimeApi,
  message: BackgroundMessage
): Promise<T> {
  return runtime.sendMessage(message) as Promise<T>;
}

export interface AddSiteActionOptions {
  originInput: string;
  canEditSites: boolean;
  originsBlockedMessage: string;
  permissions: OptionsPermissionsApi;
  sites: SiteConfig[];
  setSiteConfigs: (siteConfigs: SiteConfig[]) => Promise<void>;
  setSiteConfigsCache: (siteConfigs: SiteConfig[]) => void;
  refetchSessionSnapshot: () => Promise<void>;
}

export type AddSiteActionResult =
  | {
      kind: "added";
      flash: OptionsActionFlash;
      nextSiteOriginInput: "";
    }
  | {
      kind: "already_enabled";
      flash: OptionsActionFlash;
      nextSiteOriginInput: string;
    }
  | {
      kind: "blocked";
      flash: OptionsActionFlash;
      nextSiteOriginInput: string;
    }
  | (OptionsActionErrorResult & {
      nextSiteOriginInput: string;
    });

export async function addSiteAction({
  originInput,
  canEditSites,
  originsBlockedMessage,
  permissions,
  sites,
  setSiteConfigs,
  setSiteConfigsCache,
  refetchSessionSnapshot
}: AddSiteActionOptions): Promise<AddSiteActionResult> {
  if (!canEditSites) {
    return {
      kind: "blocked",
      flash: {
        variant: "destructive",
        text: originsBlockedMessage
      },
      nextSiteOriginInput: originInput
    };
  }

  try {
    const result = await whitelistSiteOrigin({
      originInput,
      requestHostPermission: async (permissionPattern) =>
        permissions.request({
          origins: [permissionPattern]
        }),
      readSiteConfigs: async () => sites,
      writeSiteConfigs: setSiteConfigs
    });
    setSiteConfigsCache(result.siteConfigs);
    if (result.outcome === "already_enabled") {
      return {
        kind: "already_enabled",
        flash: {
          variant: "default",
          text: `Origin ${result.origin} is already enabled.`
        },
        nextSiteOriginInput: originInput
      };
    }

    await refetchSessionSnapshot();
    return {
      kind: "added",
      flash: {
        variant: "success",
        text: "Origin added and host access granted."
      },
      nextSiteOriginInput: ""
    };
  } catch (error) {
    return {
      kind: "error",
      flash: buildErrorFlash(error),
      nextSiteOriginInput: originInput
    };
  }
}

export interface UpdateSiteActionOptions {
  origin: string;
  dumpAllowlistPatterns: string[];
  canEditSites: boolean;
  originsBlockedMessage: string;
  sites: SiteConfig[];
  setSiteConfigs: (siteConfigs: SiteConfig[]) => Promise<void>;
  setSiteConfigsCache: (siteConfigs: SiteConfig[]) => void;
  refetchSessionSnapshot: () => Promise<void>;
}

export type UpdateSiteActionResult =
  | {
      kind: "blocked";
      flash: OptionsActionFlash;
    }
  | {
      kind: "validation_error";
      flash: OptionsActionFlash;
    }
  | {
      kind: "success";
      flash: OptionsActionFlash;
    }
  | OptionsActionErrorResult;

export async function updateSiteAction({
  origin,
  dumpAllowlistPatterns,
  canEditSites,
  originsBlockedMessage,
  sites,
  setSiteConfigs,
  setSiteConfigsCache,
  refetchSessionSnapshot
}: UpdateSiteActionOptions): Promise<UpdateSiteActionResult> {
  if (!canEditSites) {
    return {
      kind: "blocked",
      flash: {
        variant: "destructive",
        text: originsBlockedMessage
      }
    };
  }

  if (!isValidDumpAllowlistPatterns(dumpAllowlistPatterns)) {
    return {
      kind: "validation_error",
      flash: {
        variant: "destructive",
        text: "One or more dump allowlist patterns are invalid."
      }
    };
  }

  try {
    const nextSites = sites.map((site) =>
      site.origin === origin ? { ...site, dumpAllowlistPatterns } : site
    );
    await setSiteConfigs(nextSites);
    setSiteConfigsCache(nextSites);
    await refetchSessionSnapshot();
    return {
      kind: "success",
      flash: {
        variant: "success",
        text: `Updated ${origin}.`
      }
    };
  } catch (error) {
    return {
      kind: "error",
      flash: buildErrorFlash(error)
    };
  }
}

export interface RemoveSiteActionOptions {
  origin: string;
  canEditSites: boolean;
  originsBlockedMessage: string;
  permissions: OptionsPermissionsApi;
  sites: SiteConfig[];
  setSiteConfigs: (siteConfigs: SiteConfig[]) => Promise<void>;
  setSiteConfigsCache: (siteConfigs: SiteConfig[]) => void;
  refetchSessionSnapshot: () => Promise<void>;
}

export type RemoveSiteActionResult =
  | {
      kind: "blocked";
      flash: OptionsActionFlash;
    }
  | {
      kind: "success";
      flash: OptionsActionFlash;
    }
  | OptionsActionErrorResult;

export async function removeSiteAction({
  origin,
  canEditSites,
  originsBlockedMessage,
  permissions,
  sites,
  setSiteConfigs,
  setSiteConfigsCache,
  refetchSessionSnapshot
}: RemoveSiteActionOptions): Promise<RemoveSiteActionResult> {
  if (!canEditSites) {
    return {
      kind: "blocked",
      flash: {
        variant: "destructive",
        text: originsBlockedMessage
      }
    };
  }

  try {
    const permissionPattern = originToPermissionPattern(origin);
    const nextSites = sites.filter((site) => site.origin !== origin);
    await setSiteConfigs(nextSites);
    setSiteConfigsCache(nextSites);
    await Promise.resolve(
      permissions.remove({
        origins: [permissionPattern]
      })
    ).catch(() => false);
    await refetchSessionSnapshot();
    return {
      kind: "success",
      flash: {
        variant: "success",
        text: `Removed ${origin}.`
      }
    };
  } catch (error) {
    return {
      kind: "error",
      flash: buildErrorFlash(error)
    };
  }
}

export interface RootActionOptions {
  rootState: {
    hasHandle: boolean;
    permission: PermissionState;
  } | null;
  windowRef: Pick<Window, "showDirectoryPicker">;
  loadStoredRootHandle: () => Promise<FileSystemDirectoryHandle | undefined>;
  requestRootPermission: (
    rootHandle?: FileSystemDirectoryHandle | null
  ) => Promise<PermissionState>;
  storeRootHandleWithSentinel: (
    rootHandle: FileSystemDirectoryHandle
  ) => Promise<{
    rootId: string;
  }>;
  refetchRememberedRootState: () => Promise<void>;
}

export type RootActionResult =
  | {
      kind: "saved";
      flash: OptionsActionFlash;
    }
  | {
      kind: "permission_status";
      flash: OptionsActionFlash;
    }
  | OptionsActionNoopResult
  | OptionsActionErrorResult;

export async function chooseOrReconnectRootAction({
  rootState,
  windowRef,
  loadStoredRootHandle,
  requestRootPermission,
  storeRootHandleWithSentinel,
  refetchRememberedRootState
}: RootActionOptions): Promise<RootActionResult> {
  try {
    if (!rootState?.hasHandle || rootState.permission === "granted") {
      const currentHandle = rootState?.hasHandle
        ? await loadStoredRootHandle()
        : undefined;
      const rootHandle = await windowRef.showDirectoryPicker(
        createRootDirectoryPickerOptions(currentHandle)
      );
      const sentinel = await storeRootHandleWithSentinel(rootHandle);
      await refetchRememberedRootState();
      return {
        kind: "saved",
        flash: {
          variant: "success",
          text: `Root directory saved. Root ID: ${sentinel.rootId}.`
        }
      };
    }

    const rootHandle = await loadStoredRootHandle();
    if (!rootHandle) {
      throw new Error("Choose a root directory first.");
    }

    const permission = await requestRootPermission(rootHandle);
    await refetchRememberedRootState();
    return {
      kind: "permission_status",
      flash: {
        variant: permission === "granted" ? "success" : "destructive",
        text: `Root permission status: ${permission}.`
      }
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        kind: "noop"
      };
    }

    return {
      kind: "error",
      flash: buildErrorFlash(error)
    };
  }
}

export interface SaveLaunchSettingsActionOptions {
  nativeHostConfig: NativeHostConfig | null;
  setNativeHostConfig: (nativeHostConfig: NativeHostConfig) => Promise<void>;
  refetchNativeHostConfig: () => Promise<void>;
}

export type SaveLaunchSettingsActionResult =
  | {
      kind: "success";
      flash: OptionsActionFlash;
    }
  | OptionsActionNoopResult;

export async function saveLaunchSettingsAction({
  nativeHostConfig,
  setNativeHostConfig,
  refetchNativeHostConfig
}: SaveLaunchSettingsActionOptions): Promise<SaveLaunchSettingsActionResult> {
  if (!nativeHostConfig) {
    return {
      kind: "noop"
    };
  }

  await setNativeHostConfig(nativeHostConfig);
  await refetchNativeHostConfig();
  return {
    kind: "success",
    flash: {
      variant: "success",
      text: "Launch settings saved."
    }
  };
}

export interface VerifyHelperActionOptions {
  runtime: MessageRuntimeApi;
  refetchNativeHostConfig: () => Promise<void>;
}

export type VerifyHelperActionResult =
  | {
      kind: "success";
      flash: OptionsActionFlash;
    }
  | OptionsActionErrorResult;

export async function verifyHelperAction({
  runtime,
  refetchNativeHostConfig
}: VerifyHelperActionOptions): Promise<VerifyHelperActionResult> {
  try {
    const result = await sendMessage<NativeVerifyResult>(runtime, {
      type: "native.verify"
    });
    await refetchNativeHostConfig();
    if (!result.ok) {
      throw new Error(getErrorMessage(result as ErrorResult));
    }

    return {
      kind: "success",
      flash: {
        variant: "success",
        text: `Helper verified at ${result.verifiedAt}.`
      }
    };
  } catch (error) {
    return {
      kind: "error",
      flash: buildErrorFlash(error)
    };
  }
}

export interface OpenLaunchFolderActionOptions {
  runtime: MessageRuntimeApi;
  workspaceStatus: Pick<WorkspaceStatus, "authority" | "authorityLabel">;
}

export type OpenLaunchFolderActionResult =
  | {
      kind: "success";
      flash: OptionsActionFlash;
    }
  | OptionsActionErrorResult;

export async function openLaunchFolderAction({
  runtime,
  workspaceStatus
}: OpenLaunchFolderActionOptions): Promise<OpenLaunchFolderActionResult> {
  try {
    const result = await sendMessage<NativeOpenResult>(runtime, {
      type: "native.revealRoot"
    });
    if (!result.ok) {
      throw new Error(getErrorMessage(result as ErrorResult));
    }

    return {
      kind: "success",
      flash: {
        variant: "success",
        text:
          workspaceStatus.authority === "none"
            ? "Opened the active root in the OS file manager."
            : `Opened ${workspaceStatus.authorityLabel} in the OS file manager.`
      }
    };
  } catch (error) {
    return {
      kind: "error",
      flash: buildErrorFlash(error)
    };
  }
}

export interface CopyDiagnosticsActionOptions {
  runtime: MessageRuntimeApi;
  writeClipboardText: (text: string) => Promise<void>;
}

export type CopyDiagnosticsActionResult =
  | {
      kind: "success";
      flash: OptionsActionFlash;
    }
  | OptionsActionErrorResult;

export async function copyDiagnosticsAction({
  runtime,
  writeClipboardText
}: CopyDiagnosticsActionOptions): Promise<CopyDiagnosticsActionResult> {
  try {
    const result = await sendMessage<DiagnosticsResult>(runtime, {
      type: "diagnostics.getReport"
    });
    if (!result.ok) {
      throw new Error(getErrorMessage(result as ErrorResult));
    }

    await writeClipboardText(JSON.stringify(result.report, null, 2));
    return {
      kind: "success",
      flash: {
        variant: "success",
        text: "Support diagnostics copied to clipboard."
      }
    };
  } catch (error) {
    return {
      kind: "error",
      flash: buildErrorFlash(error)
    };
  }
}

export interface SaveScenarioActionOptions {
  runtime: MessageRuntimeApi;
  nameInput: string;
  descriptionInput: string;
  refetchScenarioPanel: () => Promise<void>;
}

export type SaveScenarioActionResult =
  | OptionsActionValidationResult
  | {
      kind: "success";
      flash: OptionsActionFlash;
      nextName: "";
      nextDescription: "";
    }
  | OptionsActionErrorResult;

export async function saveScenarioAction({
  runtime,
  nameInput,
  descriptionInput,
  refetchScenarioPanel
}: SaveScenarioActionOptions): Promise<SaveScenarioActionResult> {
  const nameError = getScenarioNameError(nameInput);
  if (nameError) {
    return {
      kind: "validation_error",
      errorText: nameError
    };
  }

  try {
    const result = await sendMessage<ScenarioResult>(runtime, {
      type: "scenario.save",
      name: nameInput.trim(),
      ...(descriptionInput.trim()
        ? { description: descriptionInput.trim() }
        : {})
    });
    if (!result.ok) {
      throw new Error(getErrorMessage(result as ErrorResult));
    }

    await refetchScenarioPanel();
    return {
      kind: "success",
      flash: {
        variant: "success",
        text: `Scenario "${result.name}" saved.`
      },
      nextName: "",
      nextDescription: ""
    };
  } catch (error) {
    return {
      kind: "error",
      flash: buildErrorFlash(error)
    };
  }
}

export type SaveScenarioFromTraceActionResult =
  | OptionsActionValidationResult
  | {
      kind: "success";
      flash: OptionsActionFlash;
    }
  | OptionsActionErrorResult;

export async function saveScenarioFromTraceAction({
  runtime,
  nameInput,
  descriptionInput,
  refetchScenarioPanel
}: SaveScenarioActionOptions): Promise<SaveScenarioFromTraceActionResult> {
  const nameError = getScenarioNameError(nameInput);
  if (nameError) {
    return {
      kind: "validation_error",
      errorText: nameError
    };
  }

  try {
    const result = await sendMessage<ScenarioResult>(runtime, {
      type: "scenario.saveFromTrace",
      name: nameInput.trim(),
      ...(descriptionInput.trim()
        ? { description: descriptionInput.trim() }
        : {})
    });
    if (!result.ok) {
      throw new Error(getErrorMessage(result as ErrorResult));
    }

    await refetchScenarioPanel();
    return {
      kind: "success",
      flash: {
        variant: "success",
        text: `Scenario "${result.name}" saved from the active trace.`
      }
    };
  } catch (error) {
    return {
      kind: "error",
      flash: buildErrorFlash(error)
    };
  }
}

export interface PrepareSwitchScenarioActionOptions {
  runtime: MessageRuntimeApi;
  targetName: string;
  activeScenarioName: string | null;
  activeScenarioMissing: boolean;
}

export type PrepareSwitchScenarioActionResult =
  | {
      kind: "diff_dialog";
      dialog: ScenarioSwitchDialogState;
    }
  | {
      kind: "plain_dialog";
      dialog: ScenarioSwitchDialogState;
    }
  | OptionsActionErrorResult;

export async function prepareSwitchScenarioAction({
  runtime,
  targetName,
  activeScenarioName,
  activeScenarioMissing
}: PrepareSwitchScenarioActionOptions): Promise<PrepareSwitchScenarioActionResult> {
  try {
    if (
      activeScenarioName &&
      !activeScenarioMissing &&
      activeScenarioName !== targetName
    ) {
      const result = await sendMessage<ScenarioDiffResult>(runtime, {
        type: "scenario.diff",
        scenarioA: activeScenarioName,
        scenarioB: targetName
      });
      if (!result.ok) {
        throw new Error(getErrorMessage(result as ErrorResult));
      }

      return {
        kind: "diff_dialog",
        dialog: {
          targetName,
          diff: result.diff
        }
      };
    }

    return {
      kind: "plain_dialog",
      dialog: {
        targetName,
        diff: null
      }
    };
  } catch (error) {
    return {
      kind: "error",
      flash: buildErrorFlash(error)
    };
  }
}

export interface ConfirmSwitchScenarioActionOptions {
  runtime: MessageRuntimeApi;
  switchDialog: ScenarioSwitchDialogState | null;
  refetchScenarioPanel: () => Promise<void>;
}

export type ConfirmSwitchScenarioActionResult =
  | {
      kind: "success";
      flash: OptionsActionFlash;
    }
  | OptionsActionNoopResult
  | OptionsActionErrorResult;

export async function confirmSwitchScenarioAction({
  runtime,
  switchDialog,
  refetchScenarioPanel
}: ConfirmSwitchScenarioActionOptions): Promise<ConfirmSwitchScenarioActionResult> {
  const switchTargetName = getSwitchDialogTargetName(switchDialog);
  if (!switchTargetName) {
    return {
      kind: "noop"
    };
  }

  try {
    const result = await sendMessage<ScenarioResult>(runtime, {
      type: "scenario.switch",
      name: switchTargetName
    });
    if (!result.ok) {
      throw new Error(getErrorMessage(result as ErrorResult));
    }

    await refetchScenarioPanel();
    return {
      kind: "success",
      flash: {
        variant: "success",
        text: `Switched to "${result.name}".`
      }
    };
  } catch (error) {
    return {
      kind: "error",
      flash: buildErrorFlash(error)
    };
  }
}
