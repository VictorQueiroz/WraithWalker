import { findMatchingOrigin } from "./background-helpers.js";
import type { AttachedTabState, RequestEntry, RootSentinel, SessionSnapshot } from "./types.js";

interface BrowserTab {
  id?: number;
  url?: string;
}

interface RootReadyResult {
  ok: boolean;
  sentinel?: RootSentinel;
  error?: string;
  permission?: PermissionState;
}

interface SessionControllerState {
  sessionActive: boolean;
  attachedTabs: Map<number, AttachedTabState>;
  requests: Map<string, RequestEntry | unknown>;
  enabledOrigins: string[];
}

interface SessionControllerDependencies {
  state: SessionControllerState;
  listTabs: () => Promise<BrowserTab[]>;
  attachTab: (tabId: number, topOrigin: string) => Promise<void>;
  detachTab: (tabId: number) => Promise<void>;
  refreshStoredConfig: () => Promise<void>;
  ensureRootReady: (opts?: { requestPermission?: boolean }) => Promise<RootReadyResult>;
  closeOffscreenDocument: () => Promise<void>;
  persistSnapshot: () => Promise<void>;
  setLastError: (message: string) => void;
  snapshotState: () => Promise<SessionSnapshot>;
}

export function createSessionController({
  state,
  listTabs,
  attachTab,
  detachTab,
  refreshStoredConfig,
  ensureRootReady,
  closeOffscreenDocument,
  persistSnapshot,
  setLastError,
  snapshotState
}: SessionControllerDependencies) {
  function getMatchingOrigin(url?: string): string | null {
    return findMatchingOrigin(url || "", state.enabledOrigins);
  }

  async function reconcileTabs(): Promise<void> {
    const tabs = await listTabs();
    const matchingTabIds = new Set<number>();

    for (const tab of tabs) {
      if (typeof tab.id !== "number") {
        continue;
      }

      const matchingOrigin = getMatchingOrigin(tab.url);
      if (!matchingOrigin) {
        continue;
      }

      matchingTabIds.add(tab.id);
      try {
        await attachTab(tab.id, matchingOrigin);
      } catch (error) {
        setLastError(error instanceof Error ? error.message : String(error));
      }
    }

    for (const tabId of [...state.attachedTabs.keys()]) {
      if (!matchingTabIds.has(tabId)) {
        await detachTab(tabId);
      }
    }
  }

  async function startSession(): Promise<SessionSnapshot> {
    await refreshStoredConfig();
    setLastError("");

    if (!state.enabledOrigins.length) {
      setLastError("Add at least one enabled origin in the options page.");
      return snapshotState();
    }

    const rootResult = await ensureRootReady({ requestPermission: true });
    if (!rootResult.ok) {
      return snapshotState();
    }

    state.sessionActive = true;
    await reconcileTabs();
    await persistSnapshot();
    return snapshotState();
  }

  async function stopSession(): Promise<SessionSnapshot> {
    state.sessionActive = false;
    state.requests.clear();
    setLastError("");

    await Promise.all([...state.attachedTabs.keys()].map((tabId) => detachTab(tabId)));
    await closeOffscreenDocument();
    await persistSnapshot();
    return snapshotState();
  }

  async function handleTabStateChange(tabId: number, tab?: BrowserTab): Promise<void> {
    if (!state.sessionActive) {
      return;
    }

    const matchingOrigin = getMatchingOrigin(tab?.url);
    if (matchingOrigin) {
      await attachTab(tabId, matchingOrigin);
      return;
    }

    await detachTab(tabId);
  }

  return {
    getMatchingOrigin,
    reconcileTabs,
    startSession,
    stopSession,
    handleTabStateChange
  };
}
