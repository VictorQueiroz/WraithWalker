import * as React from "react";
import { createRoot } from "react-dom/client";

import { getNativeHostConfig as defaultGetNativeHostConfig } from "./lib/chrome-storage.js";
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
  getPreferredEditorId?: () => Promise<string>;
  loadStoredRootHandle?: typeof defaultLoadStoredRootHandle;
  queryRootPermission?: typeof defaultQueryRootPermission;
  editorPresets?: EditorPreset[];
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
  loadStoredRootHandle = defaultLoadStoredRootHandle,
  queryRootPermission = defaultQueryRootPermission,
  editorPresets = EDITOR_PRESETS
}: PopupDependencies = {}) {
  void windowRef;
  const container = documentRef.getElementById("root");
  if (!container) {
    throw new Error("Popup root container not found.");
  }

  const root = createRoot(container);
  root.render(
    React.createElement(PopupApp, {
      runtime,
      getNativeHostConfig,
      loadStoredRootHandle,
      queryRootPermission,
      setIntervalFn,
      refreshIntervalMs,
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
  void initPopup();
}
