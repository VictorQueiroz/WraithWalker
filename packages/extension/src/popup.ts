import * as React from "react";
import { createRoot } from "react-dom/client";

import { getNativeHostConfig as defaultGetNativeHostConfig, getPreferredEditorId as defaultGetPreferredEditorId } from "./lib/chrome-storage.js";
import { EDITOR_PRESETS, POPUP_REFRESH_INTERVAL_MS, type EditorPreset } from "./lib/constants.js";
import { loadStoredRootHandle as defaultLoadStoredRootHandle, queryRootPermission as defaultQueryRootPermission } from "./lib/root-handle.js";
import type { BackgroundMessage } from "./lib/messages.js";
import { PopupApp } from "./ui/popup-app.js";

interface RuntimeApi {
  sendMessage(message: BackgroundMessage): Promise<unknown>;
  openOptionsPage(): void;
}

export interface PopupDependencies {
  document?: Document;
  windowRef?: Window;
  runtime?: RuntimeApi;
  setIntervalFn?: typeof setInterval;
  refreshIntervalMs?: number;
  getNativeHostConfig?: typeof defaultGetNativeHostConfig;
  getPreferredEditorId?: typeof defaultGetPreferredEditorId;
  loadStoredRootHandle?: typeof defaultLoadStoredRootHandle;
  queryRootPermission?: typeof defaultQueryRootPermission;
  editorPresets?: EditorPreset[];
  openExternalUrl?: (url: string) => void;
}

function isTestMode(): boolean {
  return Boolean((globalThis as typeof globalThis & { __WRAITHWALKER_TEST__?: boolean }).__WRAITHWALKER_TEST__);
}

export async function initPopup({
  document: documentRef = document,
  windowRef = window,
  runtime = chrome.runtime as unknown as RuntimeApi,
  setIntervalFn = setInterval,
  refreshIntervalMs = POPUP_REFRESH_INTERVAL_MS,
  getNativeHostConfig = defaultGetNativeHostConfig,
  getPreferredEditorId = defaultGetPreferredEditorId,
  loadStoredRootHandle = defaultLoadStoredRootHandle,
  queryRootPermission = defaultQueryRootPermission,
  editorPresets = EDITOR_PRESETS,
  openExternalUrl = (url: string) => {
    windowRef.location.href = url;
  }
}: PopupDependencies = {}) {
  const container = documentRef.getElementById("root");
  if (!container) {
    throw new Error("Popup root container not found.");
  }

  const root = createRoot(container);
  root.render(
    React.createElement(PopupApp, {
      runtime,
      getNativeHostConfig,
      getPreferredEditorId,
      loadStoredRootHandle,
      queryRootPermission,
      setIntervalFn,
      refreshIntervalMs,
      editorPresets,
      openExternalUrl
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
  void initPopup();
}
