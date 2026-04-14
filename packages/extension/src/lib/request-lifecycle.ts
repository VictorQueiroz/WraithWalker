import { createCapturePolicy } from "./capture-policy.js";
import { createFixtureDescriptor as defaultCreateFixtureDescriptor } from "./fixture-mapper.js";
import { createInterceptionMiddleware as defaultCreateInterceptionMiddleware } from "./interception-middleware.js";
import { createStorageLayoutResolver } from "./storage-layout.js";
import { createDefaultRequestLifecycleRepository } from "./request-lifecycle-repository.js";
import { createRequestLifecycleTracker } from "./request-lifecycle-tracker.js";
import { createRequestLifecycleFetchCoordinator } from "./request-lifecycle-fetch-coordinator.js";
import type {
  PostDataResult,
  RequestLifecycleDependencies,
  RequestLifecycleMiddleware
} from "./request-lifecycle-shared.js";
import type { HeaderEntry, RequestEntry } from "./types.js";

export function createRequestLifecycle({
  state,
  sendDebuggerCommand,
  sendOffscreenMessage,
  setLastError,
  repository: repositoryOverride,
  getSiteConfigForOrigin,
  createFixtureDescriptor = defaultCreateFixtureDescriptor,
  createInterceptionMiddleware = defaultCreateInterceptionMiddleware,
  requestKey = (tabId: number, requestId: string) => `${tabId}:${requestId}`,
  onFixturePersisted
}: RequestLifecycleDependencies) {
  const repository =
    repositoryOverride ||
    createDefaultRequestLifecycleRepository({
      sendOffscreenMessage
    });

  const capturePolicy = createCapturePolicy({ getSiteConfigForOrigin });
  const storageLayout = createStorageLayoutResolver({
    createFixtureDescriptor
  });

  let fetchCoordinator!: ReturnType<
    typeof createRequestLifecycleFetchCoordinator
  >;

  const middleware = createInterceptionMiddleware({
    capturePolicy,
    storageLayout,
    repository,
    populatePostData: (
      tabId: number,
      requestId: string,
      fallbackRequest?: { postData?: string }
    ): Promise<PostDataResult> =>
      fetchCoordinator.populatePostData(tabId, requestId, fallbackRequest),
    continueRequest: (
      tabId: number,
      requestId: string,
      options?: { interceptResponse?: boolean }
    ) =>
      sendDebuggerCommand(tabId, "Fetch.continueRequest", {
        requestId,
        ...(options?.interceptResponse ? { interceptResponse: true } : {})
      }),
    fulfillRequest: (
      tabId: number,
      payload: {
        requestId: string;
        responseCode: number;
        responseHeaders: HeaderEntry[];
        body: string;
        responsePhrase?: string;
      }
    ) => sendDebuggerCommand(tabId, "Fetch.fulfillRequest", payload),
    getResponseBody: (tabId: number, requestId: string) =>
      sendDebuggerCommand(tabId, "Network.getResponseBody", { requestId }),
    setLastError,
    onFixturePersisted
  }) as RequestLifecycleMiddleware;

  const tracker = createRequestLifecycleTracker({
    state,
    requestKey,
    setLastError,
    middleware
  });

  fetchCoordinator = createRequestLifecycleFetchCoordinator({
    state,
    sendDebuggerCommand,
    setLastError,
    tracker,
    middleware
  });

  return {
    ensureRequestEntry: tracker.ensureRequestEntry,
    populatePostData: fetchCoordinator.populatePostData,
    ensureDescriptor: (entry: RequestEntry) =>
      middleware.ensureDescriptor(entry),
    handleFetchRequestPaused: fetchCoordinator.handleFetchRequestPaused,
    handleNetworkRequestWillBeSent: tracker.handleNetworkRequestWillBeSent,
    handleNetworkResponseReceived: tracker.handleNetworkResponseReceived,
    handleNetworkLoadingFinished: tracker.handleNetworkLoadingFinished,
    handleNetworkLoadingFailed: tracker.handleNetworkLoadingFailed
  };
}
