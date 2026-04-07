import * as React from "react";
import { createRoot } from "react-dom/client";

import { getPreferredEditorId as defaultGetPreferredEditorId } from "./lib/chrome-storage.js";
import { EDITOR_PRESETS, POPUP_REFRESH_INTERVAL_MS, type EditorPreset } from "./lib/constants.js";
import type { BackgroundMessage } from "./lib/messages.js";
import { PopupApp } from "./ui/popup-app.js";

interface RuntimeApi {
  sendMessage(message: BackgroundMessage): Promise<unknown>;
  openOptionsPage(): void;
}

export interface PopupDependencies {
  document?: Document;
  runtime?: RuntimeApi;
  setIntervalFn?: typeof setInterval;
  refreshIntervalMs?: number;
  getPreferredEditorId?: typeof defaultGetPreferredEditorId;
  editorPresets?: EditorPreset[];
}

function isTestMode(): boolean {
  return Boolean((globalThis as typeof globalThis & { __WRAITHWALKER_TEST__?: boolean }).__WRAITHWALKER_TEST__);
}

export async function initPopup({
  document: documentRef = document,
  runtime = chrome.runtime as unknown as RuntimeApi,
  setIntervalFn = setInterval,
  refreshIntervalMs = POPUP_REFRESH_INTERVAL_MS,
  getPreferredEditorId = defaultGetPreferredEditorId,
  editorPresets = EDITOR_PRESETS
}: PopupDependencies = {}) {
  const container = documentRef.getElementById("root");
  if (!container) {
    throw new Error("Popup root container not found.");
  }

  const root = createRoot(container);
  root.render(
    React.createElement(PopupApp, {
      runtime,
      getPreferredEditorId,
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
