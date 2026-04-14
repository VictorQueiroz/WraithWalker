import {
  buildCursorPromptText,
  buildCursorPromptUrl,
  buildEditorAppUrl,
  buildEditorLaunchUrl,
  resolveEditorLaunch
} from "./editor-launch.js";
import { DEFAULT_EDITOR_ID } from "./constants.js";
import type {
  NativeOpenResult,
  NativeVerifyResult,
  RootReadyResult,
  RootReadySuccess,
  ScenarioListResult,
  ScenarioResult
} from "./messages.js";
import type {
  BackgroundAuthorityApi,
  getRequiredRootId
} from "./background-authority.js";
import type {
  BackgroundState,
  ChromeApi
} from "./background-runtime-shared.js";
import { getErrorMessage } from "./background-runtime-shared.js";
import type { SiteConfig } from "./types.js";
import type { WraithWalkerServerClient } from "./wraithwalker-server.js";

interface BackgroundNativeActionsDependencies {
  state: BackgroundState;
  chromeApi: ChromeApi;
  serverClient: WraithWalkerServerClient;
  authority: Pick<
    BackgroundAuthorityApi,
    | "refreshStoredConfig"
    | "refreshServerInfo"
    | "ensureLocalRootReady"
    | "sendOffscreenMessage"
    | "withServerFallback"
  >;
  getRequiredRootId: typeof getRequiredRootId;
}

export interface BackgroundNativeActionsApi {
  verifyNativeHostRoot(options?: {
    requestPermission?: boolean;
    rootResult?: RootReadySuccess;
    launchPathOverride?: string;
  }): Promise<NativeVerifyResult>;
  openDirectoryInEditor(
    commandTemplate?: string,
    editorId?: string
  ): Promise<NativeOpenResult>;
  revealRootInOs(): Promise<NativeOpenResult>;
  listScenariosForActiveTarget(): Promise<ScenarioListResult>;
  saveScenarioForActiveTarget(name: string): Promise<ScenarioResult>;
  switchScenarioForActiveTarget(name: string): Promise<ScenarioResult>;
}

export function createBackgroundNativeActions({
  state,
  chromeApi,
  serverClient,
  authority,
  getRequiredRootId
}: BackgroundNativeActionsDependencies): BackgroundNativeActionsApi {
  async function resolveActiveLaunchTarget({
    requestPermission = false
  }: {
    requestPermission?: boolean;
  } = {}): Promise<
    | {
        ok: true;
        rootId: string;
        launchPath: string;
        source: "server" | "local";
      }
    | { ok: false; error: string }
  > {
    const serverInfo = await authority.refreshServerInfo({ force: true });
    if (serverInfo) {
      const rootId = getRequiredRootId({
        ok: true,
        sentinel: serverInfo.sentinel,
        permission: "granted"
      });
      if (!rootId) {
        return { ok: false, error: "Root sentinel is missing a rootId." };
      }

      return {
        ok: true,
        rootId,
        launchPath: serverInfo.rootPath,
        source: "server"
      };
    }

    const rootResult: RootReadyResult =
      !requestPermission && state.localRootReady && state.localRootSentinel
        ? {
            ok: true,
            sentinel: state.localRootSentinel,
            permission: "granted"
          }
        : await authority.ensureLocalRootReady({ requestPermission });
    if (!rootResult.ok) {
      return { ok: false, error: getErrorMessage(rootResult) };
    }

    const rootId = getRequiredRootId(rootResult);
    if (!rootId) {
      return { ok: false, error: "Root sentinel is missing a rootId." };
    }

    const launchPath = state.nativeHostConfig.launchPath.trim();
    if (!launchPath) {
      return {
        ok: false,
        error:
          "Configure the shared editor launch path in the options page first."
      };
    }

    return {
      ok: true,
      rootId,
      launchPath,
      source: "local"
    };
  }

  async function verifyNativeHostRoot({
    requestPermission = false,
    rootResult,
    launchPathOverride
  }: {
    requestPermission?: boolean;
    rootResult?: RootReadySuccess;
    launchPathOverride?: string;
  } = {}): Promise<NativeVerifyResult> {
    await authority.refreshStoredConfig();
    if (!state.nativeHostConfig.hostName.trim()) {
      const error =
        "Configure the native host name and shared editor launch path in the options page first.";
      return { ok: false, error };
    }

    let resolvedTarget: Awaited<ReturnType<typeof resolveActiveLaunchTarget>>;
    if (rootResult) {
      const rootId = getRequiredRootId(rootResult);
      if (!rootId) {
        return { ok: false, error: "Root sentinel is missing a rootId." };
      }

      resolvedTarget = {
        ok: true,
        rootId,
        launchPath:
          launchPathOverride ?? state.nativeHostConfig.launchPath.trim(),
        source: "local"
      };
    } else {
      resolvedTarget = await resolveActiveLaunchTarget({ requestPermission });
    }
    if (resolvedTarget.ok === false) {
      return { ok: false, error: resolvedTarget.error };
    }

    if (!resolvedTarget.launchPath) {
      return {
        ok: false,
        error:
          "Configure the shared editor launch path in the options page first."
      };
    }

    try {
      const response = await chromeApi.runtime.sendNativeMessage(
        state.nativeHostConfig.hostName,
        {
          type: "verifyRoot",
          path: resolvedTarget.launchPath,
          expectedRootId: resolvedTarget.rootId
        }
      );

      if (!response?.ok) {
        throw new Error(
          String(response?.error || "Native host verification failed.")
        );
      }

      return { ok: true, verifiedAt: new Date().toISOString() };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async function generateContext(editorId?: string): Promise<void> {
    try {
      const payload = {
        siteConfigs: [...state.siteConfigsByOrigin.values()] as SiteConfig[],
        editorId
      };

      await authority.withServerFallback({
        remoteOperation: () => serverClient.generateContext(payload),
        localOperation: () =>
          authority.sendOffscreenMessage("fs.generateContext", payload)
      });
    } catch {
      // Context generation failure should not block editor open.
    }
  }

  async function openEditorViaUrl(url: string): Promise<NativeOpenResult> {
    try {
      await chromeApi.tabs.create({
        url
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async function openEditorViaUrls(urls: string[]): Promise<NativeOpenResult> {
    for (const url of urls) {
      const result = await openEditorViaUrl(url);
      if (!result.ok) {
        return result;
      }
    }

    return { ok: true };
  }

  async function openDirectoryInEditor(
    commandTemplate?: string,
    editorId?: string
  ): Promise<NativeOpenResult> {
    await authority.refreshStoredConfig();
    const serverInfo = await authority.refreshServerInfo({ force: true });
    const resolvedEditorId = editorId || state.preferredEditorId;
    const launch = resolveEditorLaunch(
      state.nativeHostConfig,
      resolvedEditorId
    );
    const urlTemplate = launch.urlTemplate.trim();
    const appUrl = launch.appUrl.trim();
    const canLaunchEditorApp = Boolean(appUrl && !launch.hasCustomUrlOverride);
    const launchPath =
      serverInfo?.rootPath || state.nativeHostConfig.launchPath.trim();
    const isCursorLaunch = launch.editorId === DEFAULT_EDITOR_ID;
    const shouldOpenCursorPrompt = isCursorLaunch && !serverInfo;
    const cursorPromptUrl = shouldOpenCursorPrompt
      ? buildCursorPromptUrl(buildCursorPromptText(state.enabledOrigins))
      : "";

    await generateContext(resolvedEditorId);

    if (isCursorLaunch) {
      const urls: string[] = [];

      if (launchPath && urlTemplate) {
        const target = await resolveActiveLaunchTarget({
          requestPermission: true
        });
        if (target.ok === false) {
          return { ok: false, error: target.error };
        }
        urls.push(
          buildEditorLaunchUrl(urlTemplate, target.launchPath, target.rootId)
        );
      }

      if (cursorPromptUrl) {
        urls.push(cursorPromptUrl);
      }
      return openEditorViaUrls(urls);
    }

    if (!launchPath && canLaunchEditorApp) {
      return openEditorViaUrl(buildEditorAppUrl(appUrl));
    }

    if (!launchPath) {
      const error = urlTemplate
        ? `Set the absolute editor launch path in Settings to open the remembered root in ${launch.preset.label}. Chrome does not expose local folder paths from the directory picker.`
        : "Configure the shared editor launch path in the options page first.";
      return { ok: false, error };
    }

    if (urlTemplate) {
      const target = await resolveActiveLaunchTarget({
        requestPermission: true
      });
      if (target.ok === false) {
        return { ok: false, error: target.error };
      }
      return openEditorViaUrl(
        buildEditorLaunchUrl(urlTemplate, target.launchPath, target.rootId)
      );
    }

    const target = await resolveActiveLaunchTarget({ requestPermission: true });
    if (target.ok === false) {
      return { ok: false, error: target.error };
    }

    const verification = await verifyNativeHostRoot({
      rootResult: {
        ok: true,
        sentinel: state.rootSentinel!,
        permission: "granted"
      },
      launchPathOverride: target.launchPath
    });
    if (!verification.ok) {
      return verification;
    }

    try {
      const response = await chromeApi.runtime.sendNativeMessage(
        state.nativeHostConfig.hostName,
        {
          type: "openDirectory",
          path: target.launchPath,
          expectedRootId: target.rootId,
          commandTemplate: commandTemplate || launch.commandTemplate
        }
      );

      if (!response?.ok) {
        throw new Error(
          String(response?.error || "Open directory request failed.")
        );
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async function revealRootInOs(): Promise<NativeOpenResult> {
    await authority.refreshStoredConfig();
    const target = await resolveActiveLaunchTarget({ requestPermission: true });
    if (target.ok === false) {
      return { ok: false, error: target.error };
    }

    if (target.source === "server") {
      try {
        await serverClient.revealRoot();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    if (!state.nativeHostConfig.hostName.trim()) {
      return {
        ok: false,
        error:
          "Configure the native host name and shared editor launch path in the options page first."
      };
    }

    try {
      const response = await chromeApi.runtime.sendNativeMessage(
        state.nativeHostConfig.hostName,
        {
          type: "revealDirectory",
          path: target.launchPath,
          expectedRootId: target.rootId
        }
      );

      if (!response?.ok) {
        throw new Error(
          String(response?.error || "Reveal directory request failed.")
        );
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async function listScenariosForActiveTarget(): Promise<ScenarioListResult> {
    await authority.refreshStoredConfig();
    const target = await resolveActiveLaunchTarget({
      requestPermission: false
    });
    if (target.ok === false) {
      return { ok: false, error: target.error };
    }

    if (target.source === "server") {
      try {
        const result = await serverClient.listScenarios();
        return { ok: true, scenarios: result.scenarios };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    if (!state.nativeHostConfig.hostName.trim()) {
      return {
        ok: false,
        error:
          "Configure the native host name and shared editor launch path in the options page first."
      };
    }

    return chromeApi.runtime.sendNativeMessage(
      state.nativeHostConfig.hostName,
      {
        type: "listScenarios",
        path: target.launchPath,
        expectedRootId: target.rootId
      }
    ) as Promise<ScenarioListResult>;
  }

  async function saveScenarioForActiveTarget(
    name: string
  ): Promise<ScenarioResult> {
    await authority.refreshStoredConfig();
    const target = await resolveActiveLaunchTarget({
      requestPermission: false
    });
    if (target.ok === false) {
      return { ok: false, error: target.error };
    }

    if (target.source === "server") {
      try {
        return await serverClient.saveScenario(name);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    if (!state.nativeHostConfig.hostName.trim()) {
      return {
        ok: false,
        error:
          "Configure the native host name and shared editor launch path in the options page first."
      };
    }

    return chromeApi.runtime.sendNativeMessage(
      state.nativeHostConfig.hostName,
      {
        type: "saveScenario",
        path: target.launchPath,
        expectedRootId: target.rootId,
        name
      }
    ) as Promise<ScenarioResult>;
  }

  async function switchScenarioForActiveTarget(
    name: string
  ): Promise<ScenarioResult> {
    await authority.refreshStoredConfig();
    const target = await resolveActiveLaunchTarget({
      requestPermission: false
    });
    if (target.ok === false) {
      return { ok: false, error: target.error };
    }

    if (target.source === "server") {
      try {
        return await serverClient.switchScenario(name);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    if (!state.nativeHostConfig.hostName.trim()) {
      return {
        ok: false,
        error:
          "Configure the native host name and shared editor launch path in the options page first."
      };
    }

    return chromeApi.runtime.sendNativeMessage(
      state.nativeHostConfig.hostName,
      {
        type: "switchScenario",
        path: target.launchPath,
        expectedRootId: target.rootId,
        name
      }
    ) as Promise<ScenarioResult>;
  }

  return {
    verifyNativeHostRoot,
    openDirectoryInEditor,
    revealRootInOs,
    listScenariosForActiveTarget,
    saveScenarioForActiveTarget,
    switchScenarioForActiveTarget
  };
}
