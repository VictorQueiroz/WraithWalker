import { arrayifyHeaders, createRequestEntry, isHttpUrl } from "./background-helpers.js";
import type { RequestEntry } from "./types.js";
import type {
  LifecycleSource,
  NetworkLoadingParams,
  NetworkRequestWillBeSentParams,
  NetworkResponseReceivedParams,
  RequestLifecycleMiddleware,
  RequestLifecycleState
} from "./request-lifecycle-shared.js";

interface RequestLifecycleTrackerDependencies {
  state: RequestLifecycleState;
  requestKey: (tabId: number, requestId: string) => string;
  setLastError: (message: string) => void;
  middleware: Pick<RequestLifecycleMiddleware, "persistResponse">;
}

export interface RequestLifecycleTrackerApi {
  ensureRequestEntry(tabId: number, requestId: string): RequestEntry;
  clearTrackedRequest(tabId: number, requestId: string): void;
  handleNetworkRequestWillBeSent(source: LifecycleSource, params: NetworkRequestWillBeSentParams): void;
  handleNetworkResponseReceived(source: LifecycleSource, params: NetworkResponseReceivedParams): void;
  handleNetworkLoadingFinished(source: LifecycleSource, params: NetworkLoadingParams): Promise<void>;
  handleNetworkLoadingFailed(source: LifecycleSource, params: NetworkLoadingParams): void;
}

export function createRequestLifecycleTracker({
  state,
  requestKey,
  setLastError,
  middleware
}: RequestLifecycleTrackerDependencies): RequestLifecycleTrackerApi {
  function ensureRequestEntry(tabId: number, requestId: string): RequestEntry {
    const key = requestKey(tabId, requestId);
    const entry = createRequestEntry({
      existingEntry: state.requests.get(key),
      tabId,
      requestId,
      topOrigin: state.attachedTabs.get(tabId)?.topOrigin || ""
    });
    state.requests.set(key, entry);
    return entry;
  }

  function clearTrackedRequest(tabId: number, requestId: string): void {
    state.requests.delete(requestKey(tabId, requestId));
  }

  function handleNetworkRequestWillBeSent(source: LifecycleSource, params: NetworkRequestWillBeSentParams): void {
    const tabId = source.tabId;
    if (!tabId || !state.attachedTabs.has(tabId) || !isHttpUrl(params.request.url)) {
      return;
    }

    const entry = ensureRequestEntry(tabId, params.requestId);
    entry.requestedAt = new Date().toISOString();
    entry.topOrigin = state.attachedTabs.get(tabId)?.topOrigin || entry.topOrigin;
    entry.method = params.request.method.toUpperCase();
    entry.url = params.request.url;
    entry.requestHeaders = arrayifyHeaders(params.request.headers);
    entry.resourceType = params.type || entry.resourceType;

    if (typeof params.request.postData === "string") {
      entry.requestBody = params.request.postData;
      entry.requestBodyEncoding = "utf8";
    }
  }

  function handleNetworkResponseReceived(source: LifecycleSource, params: NetworkResponseReceivedParams): void {
    const tabId = source.tabId;
    if (!tabId || !state.attachedTabs.has(tabId)) {
      return;
    }

    const entry = ensureRequestEntry(tabId, params.requestId);
    entry.responseStatus = params.response.status;
    entry.responseStatusText = params.response.statusText;
    entry.responseHeaders = arrayifyHeaders(params.response.headers);
    entry.mimeType = params.response.mimeType || entry.mimeType;
    entry.resourceType = params.type || entry.resourceType;
  }

  async function handleNetworkLoadingFinished(source: LifecycleSource, params: NetworkLoadingParams): Promise<void> {
    const tabId = source.tabId;
    if (!tabId) {
      return;
    }

    const key = requestKey(tabId, params.requestId);
    const entry = state.requests.get(key);
    if (!entry) {
      return;
    }

    try {
      if (!entry.replayed) {
        await middleware.persistResponse({
          entry,
          tabId,
          requestId: params.requestId
        });
      }
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
    } finally {
      state.requests.delete(key);
    }
  }

  function handleNetworkLoadingFailed(source: LifecycleSource, params: NetworkLoadingParams): void {
    if (!source.tabId) {
      return;
    }

    clearTrackedRequest(source.tabId, params.requestId);
  }

  return {
    ensureRequestEntry,
    clearTrackedRequest,
    handleNetworkRequestWillBeSent,
    handleNetworkResponseReceived,
    handleNetworkLoadingFinished,
    handleNetworkLoadingFailed
  };
}
