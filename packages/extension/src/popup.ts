import { getPreferredEditorId as defaultGetPreferredEditorId, setPreferredEditorId as defaultSetPreferredEditorId } from "./lib/chrome-storage.js";
import { DEFAULT_EDITOR_ID, EDITOR_PRESETS, POPUP_REFRESH_INTERVAL_MS } from "./lib/constants.js";
import type { EditorPreset } from "./lib/constants.js";
import { queryRequired } from "./lib/dom.js";
import type { BackgroundMessage, ErrorResult, NativeOpenResult, RootReadyResult } from "./lib/messages.js";
import type { SessionSnapshot } from "./lib/types.js";

interface RuntimeApi {
  sendMessage(message: BackgroundMessage): Promise<unknown>;
  openOptionsPage(): void;
}

interface PopupDependencies {
  document?: Document;
  runtime?: RuntimeApi;
  setIntervalFn?: typeof setInterval;
  refreshIntervalMs?: number;
  getPreferredEditorId?: typeof defaultGetPreferredEditorId;
  setPreferredEditorId?: typeof defaultSetPreferredEditorId;
  editorPresets?: EditorPreset[];
}

interface PopupElements {
  sessionPill: HTMLSpanElement;
  attachedTabsCount: HTMLSpanElement;
  enabledOriginsCount: HTMLSpanElement;
  rootStatus: HTMLSpanElement;
  helperStatus: HTMLSpanElement;
  toggleSessionButton: HTMLButtonElement;
  messageBox: HTMLDivElement;
  managedSites: HTMLDivElement;
  openOptionsButton: HTMLButtonElement;
  verifyRootButton: HTMLButtonElement;
  openEditorButton: HTMLButtonElement;
  editorDropdownToggle: HTMLButtonElement;
  editorDropdown: HTMLDivElement;
}

function getErrorMessage(result: { error?: string }): string {
  return result.error || "Unknown error.";
}

function isTestMode(): boolean {
  return Boolean((globalThis as typeof globalThis & { __WRAITHWALKER_TEST__?: boolean }).__WRAITHWALKER_TEST__);
}

function getElements(documentRef: Document): PopupElements {
  return {
    sessionPill: queryRequired<HTMLSpanElement>("#session-pill", documentRef),
    attachedTabsCount: queryRequired<HTMLSpanElement>("#attached-tabs-count", documentRef),
    enabledOriginsCount: queryRequired<HTMLSpanElement>("#enabled-origins-count", documentRef),
    rootStatus: queryRequired<HTMLSpanElement>("#root-status", documentRef),
    helperStatus: queryRequired<HTMLSpanElement>("#helper-status", documentRef),
    toggleSessionButton: queryRequired<HTMLButtonElement>("#toggle-session", documentRef),
    messageBox: queryRequired<HTMLDivElement>("#message-box", documentRef),
    managedSites: queryRequired<HTMLDivElement>("#managed-sites", documentRef),
    openOptionsButton: queryRequired<HTMLButtonElement>("#open-options", documentRef),
    verifyRootButton: queryRequired<HTMLButtonElement>("#verify-root", documentRef),
    openEditorButton: queryRequired<HTMLButtonElement>("#open-editor", documentRef),
    editorDropdownToggle: queryRequired<HTMLButtonElement>("#editor-dropdown-toggle", documentRef),
    editorDropdown: queryRequired<HTMLDivElement>("#editor-dropdown", documentRef)
  };
}

function sendMessage<T>(runtime: RuntimeApi, message: BackgroundMessage): Promise<T> {
  return runtime.sendMessage(message) as Promise<T>;
}

function setMessage(elements: PopupElements, kind: string | null, message: string): void {
  elements.messageBox.className = `${kind || "muted"}-box`;
  elements.messageBox.textContent = message;
}

function renderManagedSites(elements: PopupElements, origins: string[]): void {
  if (!origins.length) {
    elements.managedSites.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "muted-box";
    empty.textContent = "No origins enabled.";
    elements.managedSites.append(empty);
    return;
  }

  elements.managedSites.replaceChildren(
    ...origins.map((origin) => {
      const element = document.createElement("div");
      element.className = "site-item";
      element.textContent = origin;
      return element;
    })
  );
}

function renderState(elements: PopupElements, state: SessionSnapshot): void {
  const active = Boolean(state.sessionActive);
  elements.sessionPill.dataset.state = active ? "active" : "inactive";
  elements.sessionPill.textContent = active ? "Active" : "Inactive";
  elements.attachedTabsCount.textContent = String(state.attachedTabIds.length);
  elements.enabledOriginsCount.textContent = String(state.enabledOrigins.length);
  elements.rootStatus.textContent = state.rootReady ? "Ready" : "Blocked";
  elements.helperStatus.textContent = state.helperReady ? "Ready" : "Optional";
  elements.toggleSessionButton.textContent = active ? "Stop session" : "Start session";
  renderManagedSites(elements, state.enabledOrigins);

  if (state.lastError) {
    setMessage(elements, "error", state.lastError);
  } else if (!state.enabledOrigins.length) {
    setMessage(elements, "muted", "The extension starts with no active sites.");
  } else if (!state.rootReady) {
    setMessage(elements, "error", "Choose or reauthorize the root directory before starting.");
  } else if (active) {
    setMessage(elements, "success", "Debugger capture/replay is active for all matching tabs.");
  } else {
    setMessage(elements, "muted", "Session is idle. Start it to attach to matching tabs.");
  }
}

export async function initPopup({
  document: documentRef = document,
  runtime = chrome.runtime as unknown as RuntimeApi,
  setIntervalFn = setInterval,
  refreshIntervalMs = POPUP_REFRESH_INTERVAL_MS,
  getPreferredEditorId = defaultGetPreferredEditorId,
  setPreferredEditorId = defaultSetPreferredEditorId,
  editorPresets = EDITOR_PRESETS
}: PopupDependencies = {}) {
  const elements = getElements(documentRef);
  let activeEditor = editorPresets.find((e) => e.id === DEFAULT_EDITOR_ID) || editorPresets[0];

  function updateEditorButton(editor: EditorPreset): void {
    activeEditor = editor;
    elements.openEditorButton.textContent = `Open in ${editor.label}`;
  }

  function renderDropdown(): void {
    elements.editorDropdown.replaceChildren(
      ...editorPresets.map((preset) => {
        const item = documentRef.createElement("button");
        item.className = "split-dropdown-item";
        item.textContent = preset.label;
        item.dataset.editorId = preset.id;
        if (preset.id === activeEditor.id) {
          item.dataset.active = "true";
        }
        item.addEventListener("click", async () => {
          updateEditorButton(preset);
          await setPreferredEditorId(preset.id);
          elements.editorDropdown.classList.add("hidden");
          renderDropdown();
        });
        return item;
      })
    );
  }

  async function refreshState(): Promise<SessionSnapshot> {
    const state = await sendMessage<SessionSnapshot>(runtime, { type: "session.getState" });
    renderState(elements, state);
    return state;
  }

  elements.toggleSessionButton.addEventListener("click", async () => {
    try {
      const currentState = await sendMessage<SessionSnapshot>(runtime, { type: "session.getState" });
      const nextState = await sendMessage<SessionSnapshot>(runtime, {
        type: currentState.sessionActive ? "session.stop" : "session.start"
      });
      renderState(elements, nextState);
    } catch (error) {
      setMessage(elements, "error", error instanceof Error ? error.message : String(error));
    }
  });

  elements.openOptionsButton.addEventListener("click", () => {
    runtime.openOptionsPage();
  });

  elements.verifyRootButton.addEventListener("click", async () => {
    const result = await sendMessage<RootReadyResult>(runtime, { type: "root.verify" });
    if (!result.ok) {
      setMessage(elements, "error", getErrorMessage(result as ErrorResult));
      return;
    }
    await refreshState();
    setMessage(elements, "success", `Root ready with ID ${result.sentinel.rootId}.`);
  });

  elements.openEditorButton.addEventListener("click", async () => {
    const result = await sendMessage<NativeOpenResult>(runtime, {
      type: "native.open",
      commandTemplate: activeEditor.commandTemplate,
      editorId: activeEditor.id
    });
    await refreshState();
    setMessage(
      elements,
      result.ok ? "success" : "error",
      result.ok ? `Opened in ${activeEditor.label}.` : getErrorMessage(result as ErrorResult)
    );
  });

  elements.editorDropdownToggle.addEventListener("click", () => {
    elements.editorDropdown.classList.toggle("hidden");
  });

  documentRef.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const splitButton = documentRef.querySelector("#editor-split");
    if (splitButton && !splitButton.contains(target)) {
      elements.editorDropdown.classList.add("hidden");
    }
  });

  // Load preferred editor and initialize
  const preferredId = await getPreferredEditorId();
  const preferred = editorPresets.find((e) => e.id === preferredId);
  if (preferred) {
    updateEditorButton(preferred);
  }
  renderDropdown();

  await refreshState();
  setIntervalFn(refreshState, refreshIntervalMs);

  return {
    elements,
    renderState: (state: SessionSnapshot) => renderState(elements, state),
    refreshState
  };
}

if (!isTestMode()) {
  void initPopup();
}
