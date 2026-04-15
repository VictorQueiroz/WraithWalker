import { afterEach, describe, expect, it, vi } from "vitest";

import { createRequestLifecycleFetchCoordinator } from "../src/lib/request-lifecycle-fetch-coordinator.js";
import type {
  AttachedTabState,
  FixtureDescriptor,
  RequestEntry,
  StoredFixture
} from "../src/lib/types.js";
import type {
  FetchRequestPausedParams,
  RequestLifecycleMiddleware,
  RequestLifecycleState
} from "../src/lib/request-lifecycle-shared.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function createRequestEntry(overrides: Partial<RequestEntry> = {}): RequestEntry {
  return {
    tabId: 1,
    requestId: "network-1",
    requestedAt: "2026-04-08T00:00:00.000Z",
    topOrigin: "https://existing.example.com",
    method: "GET",
    url: "https://cdn.example.com/app.js",
    requestHeaders: [],
    requestBody: "",
    requestBodyEncoding: "utf8",
    descriptor: null,
    resourceType: "Script",
    mimeType: "application/javascript",
    replayed: false,
    replayOnResponse: false,
    responseStatus: 200,
    responseStatusText: "OK",
    responseHeaders: [],
    ...overrides
  };
}

function createFetchPausedParams(
  overrides: Omit<Partial<FetchRequestPausedParams>, "request"> & {
    request?: Partial<FetchRequestPausedParams["request"]>;
  } = {}
): FetchRequestPausedParams {
  const { request: requestOverrides = {}, ...restOverrides } = overrides;

  return {
    requestId: "fetch-1",
    networkId: "network-1",
    request: {
      method: "GET",
      url: "https://cdn.example.com/app.js",
      headers: {},
      ...requestOverrides
    },
    resourceType: "Script",
    ...restOverrides
  };
}

function createReplayFixture(): {
  descriptor: FixtureDescriptor;
  fixture: StoredFixture;
} {
  return {
    descriptor: {
      bodyPath: "body",
      requestPath: "request.json",
      metaPath: "response.meta.json"
    } as FixtureDescriptor,
    fixture: {
      request: {
        topOrigin: "https://existing.example.com",
        url: "https://cdn.example.com/app.js",
        method: "GET",
        headers: [],
        body: "",
        bodyEncoding: "utf8",
        bodyHash: "",
        queryHash: "",
        capturedAt: "2026-04-08T00:00:00.000Z"
      },
      meta: {
        status: 200,
        statusText: "OK",
        headers: [{ name: "Content-Type", value: "application/json" }]
      },
      bodyBase64: "e30=",
      size: 2
    }
  };
}

function createCoordinatorHarness({
  entry = createRequestEntry(),
  attachedTab = { topOrigin: "https://app.example.com" },
  loadReplayFixture = vi.fn(async () => null),
  shouldReplayWithLiveResponseHeaders = vi.fn(() => false),
  fulfillReplay = vi.fn(async () => {})
}: {
  entry?: RequestEntry;
  attachedTab?: AttachedTabState;
  loadReplayFixture?: Pick<
    RequestLifecycleMiddleware,
    "loadReplayFixture"
  >["loadReplayFixture"];
  shouldReplayWithLiveResponseHeaders?: Pick<
    RequestLifecycleMiddleware,
    "shouldReplayWithLiveResponseHeaders"
  >["shouldReplayWithLiveResponseHeaders"];
  fulfillReplay?: Pick<
    RequestLifecycleMiddleware,
    "fulfillReplay"
  >["fulfillReplay"];
} = {}) {
  const state: RequestLifecycleState = {
    sessionActive: true,
    attachedTabs: new Map([[1, attachedTab]]),
    requests: new Map([["1:network-1", entry]])
  };
  const sendDebuggerCommand = vi.fn(
    async (
      _tabId: number,
      method: string,
      params?: Record<string, unknown>
    ) => ({ method, params })
  );
  const setLastError = vi.fn();
  const tracker = {
    ensureRequestEntry: vi.fn(() => entry),
    clearTrackedRequest: vi.fn()
  };
  const middleware = {
    loadReplayFixture,
    shouldReplayWithLiveResponseHeaders,
    fulfillReplay
  };
  const coordinator = createRequestLifecycleFetchCoordinator({
    state,
    sendDebuggerCommand,
    setLastError,
    tracker,
    middleware
  });

  return {
    coordinator,
    entry,
    sendDebuggerCommand,
    setLastError,
    tracker
  };
}

describe("request lifecycle fetch coordinator", () => {
  it("falls back to an empty utf8 body when the debugger returns no request postData", async () => {
    const harness = createCoordinatorHarness();
    harness.sendDebuggerCommand.mockResolvedValueOnce({});

    const result = await harness.coordinator.populatePostData(1, "req-empty");

    expect(result).toEqual({
      body: "",
      encoding: "utf8"
    });
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Network.getRequestPostData",
      { requestId: "req-empty" }
    );
  });

  it("returns base64 encoding when the debugger marks request postData as base64", async () => {
    const harness = createCoordinatorHarness();
    harness.sendDebuggerCommand.mockResolvedValueOnce({
      postData: "eyJtb2RlIjoiYmFzZTY0In0=",
      base64Encoded: true
    });

    const result = await harness.coordinator.populatePostData(1, "req-base64");

    expect(result).toEqual({
      body: "eyJtb2RlIjoiYmFzZTY0In0=",
      encoding: "base64"
    });
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Network.getRequestPostData",
      { requestId: "req-base64" }
    );
  });

  it("preserves the tracked top origin and resource type when paused params omit usable values", async () => {
    const entry = createRequestEntry({
      topOrigin: "https://existing.example.com",
      resourceType: "Script"
    });
    const harness = createCoordinatorHarness({
      entry,
      attachedTab: { topOrigin: "" }
    });
    const params: FetchRequestPausedParams = {
      requestId: "fetch-1",
      networkId: "network-1",
      request: {
        method: "post",
        url: "https://cdn.example.com/updated.js",
        headers: {
          Accept: "text/javascript"
        }
      }
    };

    await harness.coordinator.handleFetchRequestPaused({ tabId: 1 }, params);

    expect(harness.tracker.ensureRequestEntry).toHaveBeenCalledWith(
      1,
      "network-1"
    );
    expect(entry.topOrigin).toBe("https://existing.example.com");
    expect(entry.resourceType).toBe("Script");
    expect(entry.method).toBe("POST");
    expect(entry.url).toBe("https://cdn.example.com/updated.js");
    expect(entry.requestHeaders).toEqual([
      { name: "Accept", value: "text/javascript" }
    ]);
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      { requestId: "fetch-1" }
    );
    expect(harness.setLastError).not.toHaveBeenCalled();
  });

  it("reports non-Error request-stage replay failures and falls back to continueRequest", async () => {
    const replayFixture = createReplayFixture();
    const harness = createCoordinatorHarness({
      loadReplayFixture: vi.fn(async () => replayFixture),
      fulfillReplay: vi.fn(async () => {
        throw 404;
      })
    });

    await harness.coordinator.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams()
    );

    expect(harness.setLastError).toHaveBeenCalledWith("404");
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      { requestId: "fetch-1" }
    );
  });

  it("reports non-Error response-stage replay failures, resets replayOnResponse, and falls back to continueRequest", async () => {
    const replayFixture = createReplayFixture();
    const entry = createRequestEntry({ replayOnResponse: true });
    const harness = createCoordinatorHarness({
      entry,
      loadReplayFixture: vi.fn(async () => replayFixture),
      fulfillReplay: vi.fn(async () => {
        throw 503;
      })
    });

    await harness.coordinator.handleFetchRequestPaused(
      { tabId: 1 },
      createFetchPausedParams({
        responseStatusCode: 202,
        responseHeaders: {
          "Content-Type": "application/json"
        }
      })
    );

    expect(entry.replayOnResponse).toBe(false);
    expect(entry.responseStatus).toBe(202);
    expect(entry.responseHeaders).toEqual([
      { name: "Content-Type", value: "application/json" }
    ]);
    expect(harness.setLastError).toHaveBeenCalledWith("503");
    expect(harness.sendDebuggerCommand).toHaveBeenCalledWith(
      1,
      "Fetch.continueRequest",
      { requestId: "fetch-1" }
    );
  });
});
