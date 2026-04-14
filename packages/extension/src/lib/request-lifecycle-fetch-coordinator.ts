import { arrayifyHeaders, isHttpUrl } from "./background-helpers.js";
import { StaleFetchRequestCommandError } from "./background-runtime-shared.js";
import type { RequestEntry } from "./types.js";
import type {
  FetchRequestPausedParams,
  LifecycleSource,
  PostDataResponse,
  PostDataResult,
  RequestLifecycleMiddleware,
  RequestLifecycleState
} from "./request-lifecycle-shared.js";
import type { RequestLifecycleTrackerApi } from "./request-lifecycle-tracker.js";

interface RequestLifecycleFetchCoordinatorDependencies {
  state: RequestLifecycleState;
  sendDebuggerCommand: <T = unknown>(tabId: number, method: string, params?: Record<string, unknown>) => Promise<T>;
  setLastError: (message: string) => void;
  tracker: Pick<RequestLifecycleTrackerApi, "ensureRequestEntry" | "clearTrackedRequest">;
  middleware: Pick<
    RequestLifecycleMiddleware,
    "loadReplayFixture" | "shouldReplayWithLiveResponseHeaders" | "fulfillReplay"
  >;
}

export interface RequestLifecycleFetchCoordinatorApi {
  populatePostData(
    tabId: number,
    requestId: string,
    fallbackRequest?: { postData?: string }
  ): Promise<PostDataResult>;
  handleFetchRequestPaused(source: LifecycleSource, params: FetchRequestPausedParams): Promise<void>;
}

export function createRequestLifecycleFetchCoordinator({
  state,
  sendDebuggerCommand,
  setLastError,
  tracker,
  middleware
}: RequestLifecycleFetchCoordinatorDependencies): RequestLifecycleFetchCoordinatorApi {
  async function populatePostData(
    tabId: number,
    requestId: string,
    fallbackRequest?: { postData?: string }
  ): Promise<PostDataResult> {
    if (typeof fallbackRequest?.postData === "string") {
      return {
        body: fallbackRequest.postData,
        encoding: "utf8"
      };
    }

    try {
      const response = await sendDebuggerCommand<PostDataResponse>(
        tabId,
        "Network.getRequestPostData",
        { requestId }
      );
      return {
        body: response.postData || "",
        encoding: response.base64Encoded ? "base64" : "utf8"
      };
    } catch {
      return { body: "", encoding: "utf8" };
    }
  }

  async function continueRequest(
    tabId: number,
    requestId: string,
    options: { interceptResponse?: boolean } = {}
  ): Promise<void> {
    await sendDebuggerCommand(tabId, "Fetch.continueRequest", {
      requestId,
      ...(options.interceptResponse ? { interceptResponse: true } : {})
    });
  }

  function handleStalePausedRequest(
    error: unknown,
    tabId: number,
    networkRequestId: string
  ): boolean {
    if (!(error instanceof StaleFetchRequestCommandError)) {
      return false;
    }

    tracker.clearTrackedRequest(tabId, networkRequestId);
    return true;
  }

  async function continueOrHandleStale(
    tabId: number,
    pausedRequestId: string,
    networkRequestId: string,
    options?: { interceptResponse?: boolean }
  ): Promise<boolean> {
    try {
      await continueRequest(tabId, pausedRequestId, options);
      return true;
    } catch (error) {
      if (handleStalePausedRequest(error, tabId, networkRequestId)) {
        return false;
      }
      throw error;
    }
  }

  function updatePausedRequestEntry(
    entry: RequestEntry,
    tabId: number,
    params: FetchRequestPausedParams
  ): void {
    entry.topOrigin = state.attachedTabs.get(tabId)?.topOrigin || entry.topOrigin;
    entry.method = params.request.method.toUpperCase();
    entry.url = params.request.url;
    entry.requestHeaders = arrayifyHeaders(params.request.headers);
    entry.resourceType = params.resourceType || entry.resourceType;
  }

  async function handleResponseStagePause(args: {
    entry: RequestEntry;
    tabId: number;
    pausedRequestId: string;
    networkRequestId: string;
    params: FetchRequestPausedParams;
  }): Promise<void> {
    const {
      entry,
      tabId,
      pausedRequestId,
      networkRequestId,
      params
    } = args;

    if (params.responseStatusCode) {
      entry.responseStatus = params.responseStatusCode;
    }
    if (params.responseHeaders) {
      entry.responseHeaders = arrayifyHeaders(params.responseHeaders);
    }

    if (!entry.replayOnResponse || params.responseErrorReason) {
      entry.replayOnResponse = false;
      await continueOrHandleStale(tabId, pausedRequestId, networkRequestId);
      return;
    }

    try {
      const replayFixture = await middleware.loadReplayFixture({
        entry,
        tabId,
        networkRequestId,
        fallbackRequest: params.request
      });
      if (!replayFixture) {
        entry.replayOnResponse = false;
        await continueOrHandleStale(tabId, pausedRequestId, networkRequestId);
        return;
      }

      await middleware.fulfillReplay({
        entry,
        tabId,
        pausedRequestId,
        descriptor: replayFixture.descriptor,
        fixture: replayFixture.fixture,
        liveResponse: {
          status: params.responseStatusCode,
          statusText: entry.responseStatusText,
          headers: entry.responseHeaders
        }
      });
    } catch (error) {
      entry.replayOnResponse = false;
      if (handleStalePausedRequest(error, tabId, networkRequestId)) {
        return;
      }
      setLastError(error instanceof Error ? error.message : String(error));
      await continueOrHandleStale(tabId, pausedRequestId, networkRequestId);
    }
  }

  async function handleRequestStagePause(args: {
    entry: RequestEntry;
    tabId: number;
    pausedRequestId: string;
    networkRequestId: string;
    params: FetchRequestPausedParams;
  }): Promise<void> {
    const {
      entry,
      tabId,
      pausedRequestId,
      networkRequestId,
      params
    } = args;

    try {
      const replayFixture = await middleware.loadReplayFixture({
        entry,
        tabId,
        networkRequestId,
        fallbackRequest: params.request
      });
      if (!replayFixture) {
        await continueOrHandleStale(tabId, pausedRequestId, networkRequestId);
        return;
      }

      if (middleware.shouldReplayWithLiveResponseHeaders(replayFixture)) {
        entry.replayOnResponse = true;
        await continueOrHandleStale(tabId, pausedRequestId, networkRequestId, {
          interceptResponse: true
        });
        return;
      }

      await middleware.fulfillReplay({
        entry,
        tabId,
        pausedRequestId,
        descriptor: replayFixture.descriptor,
        fixture: replayFixture.fixture
      });
    } catch (error) {
      if (handleStalePausedRequest(error, tabId, networkRequestId)) {
        return;
      }
      setLastError(error instanceof Error ? error.message : String(error));
      await continueOrHandleStale(tabId, pausedRequestId, networkRequestId);
    }
  }

  async function handleFetchRequestPaused(source: LifecycleSource, params: FetchRequestPausedParams): Promise<void> {
    const tabId = source.tabId;
    if (!tabId || !state.sessionActive || !state.attachedTabs.has(tabId)) {
      return;
    }

    const networkRequestId = params.networkId || params.requestId;
    if (!isHttpUrl(params.request.url)) {
      await continueOrHandleStale(tabId, params.requestId, networkRequestId);
      return;
    }

    const entry = tracker.ensureRequestEntry(tabId, networkRequestId);
    updatePausedRequestEntry(entry, tabId, params);

    if (params.responseStatusCode || params.responseErrorReason) {
      await handleResponseStagePause({
        entry,
        tabId,
        pausedRequestId: params.requestId,
        networkRequestId,
        params
      });
      return;
    }

    await handleRequestStagePause({
      entry,
      tabId,
      pausedRequestId: params.requestId,
      networkRequestId,
      params
    });
  }

  return {
    populatePostData,
    handleFetchRequestPaused
  };
}
