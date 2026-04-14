import type {
  BackgroundState,
  TraceBindingPayload
} from "./background-runtime-shared.js";
import { DetachedDebuggerCommandError } from "./background-runtime-shared.js";
import type { FixtureDescriptor, RequestEntry } from "./types.js";
import type {
  ServerScenarioTraceRecord,
  WraithWalkerServerClient
} from "./wraithwalker-server.js";

export const TRACE_BINDING_NAME = "__wraithwalkerTraceBinding";

interface BackgroundTraceServiceDependencies {
  state: BackgroundState;
  serverClient: WraithWalkerServerClient;
  sendDebuggerCommand: <T = unknown>(
    tabId: number,
    method: string,
    params?: Record<string, unknown>
  ) => Promise<T>;
  scheduleHeartbeat: () => void;
  markServerOffline: () => void;
}

interface RuntimeBindingCalledEvent {
  name?: string;
  payload?: string;
}

export interface BackgroundTraceServiceApi {
  handleBindingCalled(tabId: number, params: unknown): Promise<boolean>;
  recordTraceClick(tabId: number, payload: TraceBindingPayload): Promise<void>;
  linkTraceFixtureIfNeeded(args: {
    descriptor: FixtureDescriptor;
    entry: RequestEntry;
    capturedAt: string;
  }): Promise<void>;
  armTraceForTab(tabId: number): Promise<void>;
  disarmTraceForTab(tabId: number): Promise<void>;
  syncTraceBindings(): Promise<void>;
}

function buildTraceCollectorSource(bindingName: string): string {
  return `(() => {
    const BINDING_NAME = ${JSON.stringify(bindingName)};
    const STATE_KEY = "__wraithwalkerTraceState";
    const DISABLE_KEY = "__wraithwalkerDisableTrace";
    const esc = (value) => {
      if (globalThis.CSS && typeof globalThis.CSS.escape === "function") {
        return globalThis.CSS.escape(value);
      }
      return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
    };
    const clip = (value, limit = 160) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, limit);
    const indexInType = (el) => {
      let index = 1;
      let node = el;
      while ((node = node.previousElementSibling)) {
        if (node.tagName === el.tagName) index += 1;
      }
      return index;
    };
    const segmentFor = (el) => {
      const tag = el.tagName.toLowerCase();
      if (el.id) return "#" + esc(el.id);
      for (const attr of ["data-testid", "data-test", "data-qa"]) {
        const value = el.getAttribute(attr);
        if (value) return tag + "[" + attr + "=" + JSON.stringify(value) + "]";
      }
      let segment = tag;
      const role = el.getAttribute("role");
      if (role) segment += "[role=" + JSON.stringify(role) + "]";
      else {
        const classes = [...el.classList]
          .filter((name) => /^[a-zA-Z0-9_-]+$/.test(name))
          .slice(0, 2);
        if (classes.length) {
          segment += classes.map((name) => "." + esc(name)).join("");
        }
      }
      const parent = el.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((candidate) => candidate.tagName === el.tagName);
        if (siblings.length > 1) {
          segment += ":nth-of-type(" + indexInType(el) + ")";
        }
      }
      return segment;
    };
    const selectorFor = (element) => {
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
        const segment = segmentFor(current);
        parts.unshift(segment);
        if (segment.startsWith("#")) break;
        current = current.parentElement;
      }
      return parts.join(" > ");
    };
    const handler = (event) => {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
      const target = path.find((value) => value instanceof Element);
      if (!(target instanceof Element) || typeof globalThis[BINDING_NAME] !== "function") {
        return;
      }
      const payload = {
        recordedAt: new Date().toISOString(),
        pageUrl: globalThis.location?.href || "",
        topOrigin: globalThis.location?.origin || "",
        selector: selectorFor(target),
        tagName: target.tagName.toLowerCase(),
        textSnippet: clip(target.textContent || target.getAttribute("aria-label") || target.getAttribute("title") || ""),
        role: target.getAttribute("role") || undefined,
        ariaLabel: target.getAttribute("aria-label") || undefined,
        href: target instanceof HTMLAnchorElement ? target.href : (target.getAttribute("href") || undefined)
      };
      globalThis[BINDING_NAME](JSON.stringify(payload));
    };
    const previous = globalThis[STATE_KEY];
    if (previous && typeof previous.disable === "function") {
      previous.disable();
    }
    globalThis[STATE_KEY] = {
      disable() {
        globalThis.removeEventListener("click", handler, true);
      }
    };
    globalThis[DISABLE_KEY] = () => globalThis[STATE_KEY]?.disable?.();
    globalThis.addEventListener("click", handler, true);
  })();`;
}

export function createBackgroundTraceService({
  state,
  serverClient,
  sendDebuggerCommand,
  scheduleHeartbeat,
  markServerOffline
}: BackgroundTraceServiceDependencies): BackgroundTraceServiceApi {
  async function recordTraceClick(
    tabId: number,
    payload: TraceBindingPayload
  ): Promise<void> {
    const activeTrace = state.activeTrace as ServerScenarioTraceRecord | null;
    if (!state.serverInfo || !activeTrace) {
      return;
    }

    try {
      const result = await serverClient.recordTraceClick({
        traceId: activeTrace.traceId,
        step: {
          stepId: crypto.randomUUID(),
          tabId,
          recordedAt: payload.recordedAt || new Date().toISOString(),
          pageUrl: payload.pageUrl,
          topOrigin:
            payload.topOrigin || state.attachedTabs.get(tabId)?.topOrigin || "",
          selector: payload.selector,
          tagName: payload.tagName,
          textSnippet: payload.textSnippet,
          ...(payload.role ? { role: payload.role } : {}),
          ...(payload.ariaLabel ? { ariaLabel: payload.ariaLabel } : {}),
          ...(payload.href ? { href: payload.href } : {})
        }
      });
      state.activeTrace = result.activeTrace;
      scheduleHeartbeat();
    } catch {
      markServerOffline();
    }
  }

  async function handleBindingCalled(
    tabId: number,
    params: unknown
  ): Promise<boolean> {
    const event = params as RuntimeBindingCalledEvent;
    if (
      event.name !== TRACE_BINDING_NAME ||
      typeof event.payload !== "string"
    ) {
      return false;
    }

    const parsed = JSON.parse(event.payload) as TraceBindingPayload;
    await recordTraceClick(tabId, parsed);
    return true;
  }

  async function linkTraceFixtureIfNeeded({
    descriptor,
    entry,
    capturedAt
  }: {
    descriptor: FixtureDescriptor;
    entry: RequestEntry;
    capturedAt: string;
  }): Promise<void> {
    const activeTrace = state.activeTrace as ServerScenarioTraceRecord | null;
    if (!state.serverInfo || !activeTrace || !entry.requestedAt) {
      return;
    }

    try {
      const result = await serverClient.linkTraceFixture({
        traceId: activeTrace.traceId,
        tabId: entry.tabId,
        requestedAt: entry.requestedAt,
        fixture: {
          bodyPath: descriptor.bodyPath,
          requestUrl: descriptor.requestUrl,
          resourceType: entry.resourceType || "Other",
          capturedAt
        }
      });
      state.activeTrace = result.trace;
      scheduleHeartbeat();
    } catch {
      markServerOffline();
    }
  }

  async function armTraceForTab(tabId: number): Promise<void> {
    const tabState = state.attachedTabs.get(tabId);
    const activeTrace = state.activeTrace as ServerScenarioTraceRecord | null;
    if (
      !tabState ||
      !activeTrace ||
      !state.serverInfo ||
      !state.sessionActive
    ) {
      return;
    }

    if (tabState.traceArmedForTraceId === activeTrace.traceId) {
      return;
    }

    try {
      await sendDebuggerCommand(tabId, "Runtime.addBinding", {
        name: TRACE_BINDING_NAME
      });
    } catch (error) {
      if (error instanceof DetachedDebuggerCommandError) {
        return;
      }
      // The binding may already be registered for this target.
    }

    const source = buildTraceCollectorSource(TRACE_BINDING_NAME);

    if (tabState.traceScriptIdentifier) {
      try {
        await sendDebuggerCommand(
          tabId,
          "Page.removeScriptToEvaluateOnNewDocument",
          {
            identifier: tabState.traceScriptIdentifier
          }
        );
      } catch (error) {
        if (error instanceof DetachedDebuggerCommandError) {
          return;
        }
        // Ignore stale script identifiers on refresh/navigate races.
      }
    }

    let injected: { identifier?: string };
    try {
      injected = await sendDebuggerCommand<{ identifier?: string }>(
        tabId,
        "Page.addScriptToEvaluateOnNewDocument",
        { source }
      );
      await sendDebuggerCommand(tabId, "Runtime.evaluate", {
        expression: source,
        awaitPromise: false,
        returnByValue: false
      });
    } catch (error) {
      if (error instanceof DetachedDebuggerCommandError) {
        return;
      }

      throw error;
    }

    tabState.traceScriptIdentifier = injected.identifier || null;
    tabState.traceArmedForTraceId = activeTrace.traceId;
  }

  async function disarmTraceForTab(tabId: number): Promise<void> {
    const tabState = state.attachedTabs.get(tabId);
    if (!tabState) {
      return;
    }

    if (tabState.traceScriptIdentifier) {
      try {
        await sendDebuggerCommand(
          tabId,
          "Page.removeScriptToEvaluateOnNewDocument",
          {
            identifier: tabState.traceScriptIdentifier
          }
        );
      } catch {
        // Ignore stale script identifiers on detached targets.
      }
    }

    try {
      await sendDebuggerCommand(tabId, "Runtime.evaluate", {
        expression: "globalThis.__wraithwalkerDisableTrace?.()",
        awaitPromise: false,
        returnByValue: false
      });
    } catch {
      // Ignore detached tabs or unavailable execution contexts.
    }

    tabState.traceScriptIdentifier = null;
    tabState.traceArmedForTraceId = null;
  }

  async function syncTraceBindings(): Promise<void> {
    const shouldArm = Boolean(
      state.serverInfo && state.activeTrace && state.sessionActive
    );
    const tabIds = [...state.attachedTabs.keys()];

    await Promise.all(
      tabIds.map((tabId) =>
        shouldArm ? armTraceForTab(tabId) : disarmTraceForTab(tabId)
      )
    );
  }

  return {
    handleBindingCalled,
    recordTraceClick,
    linkTraceFixtureIfNeeded,
    armTraceForTab,
    disarmTraceForTab,
    syncTraceBindings
  };
}
