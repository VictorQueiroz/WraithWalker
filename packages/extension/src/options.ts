import * as React from "react";
import { createRoot } from "react-dom/client";

import {
  getNativeHostConfig as defaultGetNativeHostConfig,
  setNativeHostConfig as defaultSetNativeHostConfig
} from "./lib/chrome-storage.js";
import { EDITOR_PRESETS, type EditorPreset } from "./lib/constants.js";
import {
  getConfiguredSiteConfigs as defaultGetSiteConfigs,
  setConfiguredSiteConfigs as defaultSetSiteConfigs
} from "./lib/root-config.js";
import {
  ensureRootSentinel as defaultEnsureRootSentinel,
  loadStoredRootHandle as defaultLoadStoredRootHandle,
  queryRootPermission as defaultQueryRootPermission,
  requestRootPermission as defaultRequestRootPermission,
  storeRootHandleWithSentinel as defaultStoreRootHandleWithSentinel
} from "./lib/root-handle.js";
import {
  createOptionsChromeApi,
  type OptionsChromeApi
} from "./lib/chrome-api.js";
import { OptionsApp } from "./ui/options-app.js";

export interface OptionsDependencies {
  document?: Document;
  windowRef?: Window;
  chromeApi?: OptionsChromeApi;
  getNativeHostConfig?: typeof defaultGetNativeHostConfig;
  getSiteConfigs?: typeof defaultGetSiteConfigs;
  setNativeHostConfig?: typeof defaultSetNativeHostConfig;
  setSiteConfigs?: typeof defaultSetSiteConfigs;
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

function isTestMode(): boolean {
  return Boolean(
    (globalThis as typeof globalThis & { __WRAITHWALKER_TEST__?: boolean })
      .__WRAITHWALKER_TEST__
  );
}

export async function initOptions({
  document: documentRef = document,
  windowRef = window,
  chromeApi = createOptionsChromeApi(),
  getNativeHostConfig = defaultGetNativeHostConfig,
  getSiteConfigs = defaultGetSiteConfigs,
  setNativeHostConfig = defaultSetNativeHostConfig,
  setSiteConfigs = defaultSetSiteConfigs,
  ensureRootSentinel = defaultEnsureRootSentinel,
  loadStoredRootHandle = defaultLoadStoredRootHandle,
  queryRootPermission = defaultQueryRootPermission,
  requestRootPermission = defaultRequestRootPermission,
  storeRootHandleWithSentinel = defaultStoreRootHandleWithSentinel,
  writeClipboardText,
  editorPresets = EDITOR_PRESETS
}: OptionsDependencies = {}) {
  const container = documentRef.getElementById("root");
  if (!container) {
    throw new Error("Options root container not found.");
  }

  const root = createRoot(container);
  root.render(
    React.createElement(OptionsApp, {
      windowRef,
      chromeApi,
      getNativeHostConfig,
      getSiteConfigs,
      setNativeHostConfig,
      setSiteConfigs,
      ensureRootSentinel,
      loadStoredRootHandle,
      queryRootPermission,
      requestRootPermission,
      storeRootHandleWithSentinel,
      writeClipboardText,
      editorPresets
    })
  );

  return {
    root,
    unmount() {
      root.unmount();
    }
  };
}

if (!isTestMode()) {
  void initOptions();
}
