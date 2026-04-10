import {
  arrayifyHeaders,
  createRequestEntry,
  isHttpUrl
} from "./background-helpers.js";
import { createCapturePolicy } from "./capture-policy.js";
import { createFixtureDescriptor as defaultCreateFixtureDescriptor } from "./fixture-mapper.js";
import { createInterceptionMiddleware as defaultCreateInterceptionMiddleware } from "./interception-middleware.js";
import { createStorageLayoutResolver } from "./storage-layout.js";
import type { AttachedTabState, FixtureDescriptor, HeaderEntry, HeaderInput, RequestEntry, RequestPayload, ResponseMeta, SiteConfig, StoredFixture } from "./types.js";

interface LifecycleSource {
  tabId?: number;
}

interface LifecycleRequest {
  method: string;
  url: string;
  headers: HeaderInput;
  postData?: string;
}

interface FetchRequestPausedParams {
  requestId: string;
  networkId?: string;
  request: LifecycleRequest;
  resourceType?: string;
  responseStatusCode?: number;
  responseHeaders?: HeaderInput;
  responseErrorReason?: string;
}

interface NetworkRequestWillBeSentParams {
  requestId: string;
  request: LifecycleRequest;
  type?: string;
}

interface NetworkResponseReceivedParams {
  requestId: string;
  response: {
    status: number;
    statusText: string;
    headers: HeaderInput;
    mimeType?: string;
  };
  type?: string;
}

interface NetworkLoadingParams {
  requestId: string;
}

interface PostDataResult {
  body: string;
  encoding: "utf8" | "base64";
}

interface PostDataResponse {
  postData?: string;
  base64Encoded?: boolean;
}

interface ResponseBodyResponse {
  body: string;
  base64Encoded?: boolean;
}

interface FixtureCheckResponse {
  ok: boolean;
  exists?: boolean;
  error?: string;
}

interface FixtureReadResponse extends FixtureCheckResponse {
  request?: RequestPayload;
  bodyBase64?: string;
  meta?: ResponseMeta;
  size?: number;
}

interface RequestLifecycleState {
  sessionActive: boolean;
  attachedTabs: Map<number, AttachedTabState>;
  requests: Map<string, RequestEntry>;
}

interface FixtureWritePayload {
  descriptor: FixtureDescriptor;
  request: RequestPayload;
  response: {
    body: string;
    bodyEncoding: "utf8" | "base64";
    meta: ResponseMeta;
  };
}

interface RequestLifecycleDependencies {
  state: RequestLifecycleState;
  sendDebuggerCommand: <T = unknown>(tabId: number, method: string, params?: Record<string, unknown>) => Promise<T>;
  sendOffscreenMessage: <T = unknown>(type: string, payload?: Record<string, unknown>) => Promise<T>;
  setLastError: (message: string) => void;
  repository?: {
    exists: (descriptor: FixtureDescriptor) => Promise<boolean>;
    read: (descriptor: FixtureDescriptor) => Promise<StoredFixture | null>;
    writeIfAbsent: (payload: FixtureWritePayload) => Promise<unknown>;
  };
  getSiteConfigForOrigin?: (topOrigin: string) => SiteConfig | undefined;
  createFixtureDescriptor?: (entry: {
    topOrigin: string;
    method: string;
    url: string;
    postData?: string;
    postDataEncoding?: string;
    resourceType?: string;
    mimeType?: string;
  }) => Promise<FixtureDescriptor>;
  createInterceptionMiddleware?: typeof defaultCreateInterceptionMiddleware;
  requestKey?: (tabId: number, requestId: string) => string;
  onFixturePersisted?: (payload: {
    descriptor: FixtureDescriptor;
    entry: RequestEntry;
    capturedAt: string;
  }) => Promise<void> | void;
}

export function createRequestLifecycle({
  state,
  sendDebuggerCommand,
  sendOffscreenMessage,
  setLastError,
  repository: repositoryOverride,
  getSiteConfigForOrigin,
  createFixtureDescriptor = defaultCreateFixtureDescriptor,
  createInterceptionMiddleware = defaultCreateInterceptionMiddleware,
  requestKey = (tabId, requestId) => `${tabId}:${requestId}`,
  onFixturePersisted
}: RequestLifecycleDependencies) {
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
      const response = await sendDebuggerCommand<PostDataResponse>(tabId, "Network.getRequestPostData", { requestId });
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

  const capturePolicy = createCapturePolicy({ getSiteConfigForOrigin });
  const storageLayout = createStorageLayoutResolver({ createFixtureDescriptor });

  const repository = repositoryOverride || {
    async exists(descriptor: FixtureDescriptor): Promise<boolean> {
      const fixtureCheck = await sendOffscreenMessage<FixtureCheckResponse>("fs.hasFixture", { descriptor });
      if (!fixtureCheck.ok) {
        throw new Error(fixtureCheck.error || "Fixture lookup failed.");
      }

      return Boolean(fixtureCheck.exists);
    },
    async read(descriptor: FixtureDescriptor): Promise<StoredFixture | null> {
      const fixture = await sendOffscreenMessage<FixtureReadResponse>("fs.readFixture", { descriptor });
      if (!fixture.ok) {
        throw new Error(fixture.error || "Fixture lookup failed.");
      }

      if (!fixture.exists || !fixture.meta || !fixture.bodyBase64 || !fixture.request) {
        return null;
      }

      return {
        request: fixture.request,
        meta: fixture.meta,
        bodyBase64: fixture.bodyBase64,
        size: fixture.size || 0
      };
    },
    async writeIfAbsent(payload: {
      descriptor: FixtureWritePayload["descriptor"];
      request: FixtureWritePayload["request"];
      response: FixtureWritePayload["response"];
    }): Promise<unknown> {
      const result = await sendOffscreenMessage<{
        ok: boolean;
        error?: string;
      }>("fs.writeFixture", payload as unknown as Record<string, unknown>);
      if (!result.ok) {
        throw new Error(result.error || "Fixture write failed.");
      }

      return result;
    }
  };

  const middleware = createInterceptionMiddleware({
    capturePolicy,
    storageLayout,
    repository,
    populatePostData,
    continueRequest,
    fulfillRequest: (tabId, payload) => sendDebuggerCommand(tabId, "Fetch.fulfillRequest", payload),
    getResponseBody: (tabId, requestId) =>
      sendDebuggerCommand<ResponseBodyResponse>(tabId, "Network.getResponseBody", { requestId }),
    setLastError,
    onFixturePersisted
  });

  async function ensureDescriptor(entry: RequestEntry): Promise<FixtureDescriptor> {
    return middleware.ensureDescriptor(entry);
  }

  async function handleFetchRequestPaused(source: LifecycleSource, params: FetchRequestPausedParams): Promise<void> {
    const tabId = source.tabId;
    if (!tabId || !state.sessionActive || !state.attachedTabs.has(tabId)) {
      return;
    }

    if (!isHttpUrl(params.request.url)) {
      await continueRequest(tabId, params.requestId);
      return;
    }

    const networkRequestId = params.networkId || params.requestId;
    const entry = ensureRequestEntry(tabId, networkRequestId);
    entry.topOrigin = state.attachedTabs.get(tabId)?.topOrigin || entry.topOrigin;
    entry.method = params.request.method.toUpperCase();
    entry.url = params.request.url;
    entry.requestHeaders = arrayifyHeaders(params.request.headers);
    entry.resourceType = params.resourceType || entry.resourceType;
    if (params.responseStatusCode || params.responseErrorReason) {
      if (params.responseStatusCode) {
        entry.responseStatus = params.responseStatusCode;
      }
      if (params.responseHeaders) {
        entry.responseHeaders = arrayifyHeaders(params.responseHeaders);
      }

      if (!entry.replayOnResponse || params.responseErrorReason) {
        entry.replayOnResponse = false;
        await continueRequest(tabId, params.requestId);
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
          await continueRequest(tabId, params.requestId);
          return;
        }

        await middleware.fulfillReplay({
          entry,
          tabId,
          pausedRequestId: params.requestId,
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
        setLastError(error instanceof Error ? error.message : String(error));
        await continueRequest(tabId, params.requestId);
      }
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
        await continueRequest(tabId, params.requestId);
        return;
      }

      if (middleware.shouldReplayWithLiveResponseHeaders(replayFixture)) {
        entry.replayOnResponse = true;
        await continueRequest(tabId, params.requestId, { interceptResponse: true });
        return;
      }

      await middleware.fulfillReplay({
        entry,
        tabId,
        pausedRequestId: params.requestId,
        descriptor: replayFixture.descriptor,
        fixture: replayFixture.fixture
      });
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
      await continueRequest(tabId, params.requestId);
    }
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
    state.requests.delete(requestKey(source.tabId, params.requestId));
  }

  return {
    ensureRequestEntry,
    populatePostData,
    ensureDescriptor,
    handleFetchRequestPaused,
    handleNetworkRequestWillBeSent,
    handleNetworkResponseReceived,
    handleNetworkLoadingFinished,
    handleNetworkLoadingFailed
  };
}
