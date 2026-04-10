import { buildRequestPayload, buildResponseMeta, replayResponseHeaders } from "./background-helpers.js";
import type { FixtureDescriptor, HeaderEntry, RequestEntry, RequestPayload, ResponseMeta, SiteConfig, StoredFixture } from "./types.js";

interface PostDataResult {
  body: string;
  encoding: "utf8" | "base64";
}

interface ResponseBodyResponse {
  body: string;
  base64Encoded?: boolean;
}

function normalizeReplayStatusCode(value: number): number {
  return Number.isInteger(value) && value >= 100 && value <= 999
    ? value
    : 200;
}

function normalizeResponsePhrase(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return /^[\t\x20-\x7E]+$/.test(trimmed)
    ? trimmed
    : undefined;
}

interface InterceptionMiddlewareDependencies {
  capturePolicy: {
    getSiteConfig: (topOrigin: string) => SiteConfig | undefined;
    shouldPersist: (context: { topOrigin: string; method: string; url: string }) => boolean;
  };
  storageLayout: {
    describeRequest: (
      context: {
        topOrigin: string;
        method: string;
        url: string;
        headers: HeaderEntry[];
        body: string;
        bodyEncoding: string;
        resourceType: string;
        mimeType: string;
      },
      siteConfig?: SiteConfig
    ) => Promise<FixtureDescriptor>;
  };
  repository: {
    exists: (descriptor: FixtureDescriptor) => Promise<boolean>;
    read: (descriptor: FixtureDescriptor) => Promise<StoredFixture | null>;
    writeIfAbsent: (payload: {
      descriptor: FixtureDescriptor;
      request: RequestPayload;
      response: {
        body: string;
        bodyEncoding: "utf8" | "base64";
        meta: ResponseMeta;
      };
    }) => Promise<unknown>;
  };
  populatePostData: (
    tabId: number,
    requestId: string,
    fallbackRequest?: { postData?: string }
  ) => Promise<PostDataResult>;
  continueRequest: (tabId: number, requestId: string, options?: { interceptResponse?: boolean }) => Promise<void>;
  fulfillRequest: (tabId: number, payload: {
    requestId: string;
    responseCode: number;
    responseHeaders: HeaderEntry[];
    body: string;
    responsePhrase?: string;
  }) => Promise<void>;
  getResponseBody: (tabId: number, requestId: string) => Promise<ResponseBodyResponse>;
  setLastError: (message: string) => void;
  onFixturePersisted?: (payload: {
    descriptor: FixtureDescriptor;
    entry: RequestEntry;
    capturedAt: string;
  }) => Promise<void> | void;
}

export function createInterceptionMiddleware({
  capturePolicy,
  storageLayout,
  repository,
  populatePostData,
  continueRequest,
  fulfillRequest,
  getResponseBody,
  setLastError,
  onFixturePersisted
}: InterceptionMiddlewareDependencies) {
  async function ensureRequestBody(
    entry: RequestEntry,
    tabId: number,
    requestId: string,
    fallbackRequest?: { postData?: string }
  ): Promise<void> {
    if (entry.method === "GET" || entry.requestBody) {
      return;
    }

    const requestData = await populatePostData(tabId, requestId, fallbackRequest);
    entry.requestBody = requestData.body;
    entry.requestBodyEncoding = requestData.encoding;
  }

  async function ensureDescriptor(entry: RequestEntry): Promise<FixtureDescriptor> {
    if (entry.descriptor) {
      return entry.descriptor;
    }

    entry.descriptor = await storageLayout.describeRequest(
      {
        topOrigin: entry.topOrigin,
        method: entry.method,
        url: entry.url,
        headers: entry.requestHeaders,
        body: entry.requestBody,
        bodyEncoding: entry.requestBodyEncoding,
        resourceType: entry.resourceType,
        mimeType: entry.mimeType
      },
      capturePolicy.getSiteConfig(entry.topOrigin)
    );

    return entry.descriptor;
  }

  async function loadReplayFixture({
    entry,
    tabId,
    networkRequestId,
    fallbackRequest
  }: {
    entry: RequestEntry;
    tabId: number;
    networkRequestId: string;
    fallbackRequest?: { postData?: string };
  }): Promise<{ descriptor: FixtureDescriptor; fixture: StoredFixture } | null> {
    await ensureRequestBody(entry, tabId, networkRequestId, fallbackRequest);
    const descriptor = await ensureDescriptor(entry);
    const fixtureExists = await repository.exists(descriptor);

    if (!fixtureExists) {
      return null;
    }

    const fixture = await repository.read(descriptor);
    if (!fixture) {
      setLastError("Fixture lookup failed.");
      return null;
    }

    return {
      descriptor,
      fixture
    };
  }

  function shouldReplayWithLiveResponseHeaders({
    descriptor,
    fixture
  }: {
    descriptor: FixtureDescriptor;
    fixture: StoredFixture;
  }): boolean {
    return descriptor.assetLike && fixture.meta.headerStrategy === "live";
  }

  async function fulfillReplay({
    entry,
    tabId,
    pausedRequestId,
    descriptor,
    fixture,
    liveResponse
  }: {
    entry: RequestEntry;
    tabId: number;
    pausedRequestId: string;
    descriptor: FixtureDescriptor;
    fixture: StoredFixture;
    liveResponse?: {
      status?: number;
      statusText?: string;
      headers?: HeaderEntry[];
    };
  }): Promise<void> {
    entry.replayed = true;
    entry.replayOnResponse = false;

    const responseCode = normalizeReplayStatusCode(liveResponse?.status ?? fixture.meta.status);
    const responsePhrase = normalizeResponsePhrase(liveResponse?.statusText ?? fixture.meta.statusText);
    const responseHeaders = liveResponse?.headers?.length
      ? liveResponse.headers
      : fixture.meta.headers;

    await fulfillRequest(tabId, {
      requestId: pausedRequestId,
      responseCode,
      responseHeaders: replayResponseHeaders(responseHeaders, {
        assetLike: descriptor.assetLike,
        requestHeaders: entry.requestHeaders,
        topOrigin: entry.topOrigin
      }),
      body: fixture.bodyBase64,
      ...(responsePhrase ? { responsePhrase } : {})
    });
  }

  async function replayFromRepository({
    entry,
    tabId,
    pausedRequestId,
    networkRequestId,
    fallbackRequest
    }: {
      entry: RequestEntry;
      tabId: number;
      pausedRequestId: string;
      networkRequestId: string;
      fallbackRequest?: { postData?: string };
    }): Promise<void> {
    try {
      const replayFixture = await loadReplayFixture({
        entry,
        tabId,
        networkRequestId,
        fallbackRequest
      });
      if (!replayFixture) {
        await continueRequest(tabId, pausedRequestId);
        return;
      }

      await fulfillReplay({
        entry,
        tabId,
        pausedRequestId,
        descriptor: replayFixture.descriptor,
        fixture: replayFixture.fixture
      });
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
      await continueRequest(tabId, pausedRequestId);
    }
  }

  async function persistResponse({
    entry,
    tabId,
    requestId
  }: {
    entry: RequestEntry;
    tabId: number;
    requestId: string;
  }): Promise<void> {
    if (!capturePolicy.shouldPersist({
      topOrigin: entry.topOrigin,
      method: entry.method,
      url: entry.url
    })) {
      return;
    }

    await ensureRequestBody(entry, tabId, requestId);
    const descriptor = await ensureDescriptor(entry);
    const responseBody = await getResponseBody(tabId, requestId);
    const bodyEncoding = responseBody.base64Encoded ? "base64" : "utf8";
    const capturedAt = new Date().toISOString();
    const meta = buildResponseMeta(entry, bodyEncoding, capturedAt);

    await repository.writeIfAbsent({
      descriptor,
      request: buildRequestPayload(entry, capturedAt),
      response: {
        body: responseBody.body,
        bodyEncoding,
        meta
      }
    });

    await onFixturePersisted?.({
      descriptor,
      entry,
      capturedAt: meta.capturedAt
    });
  }

  return {
    ensureDescriptor,
    ensureRequestBody,
    loadReplayFixture,
    shouldReplayWithLiveResponseHeaders,
    fulfillReplay,
    replayFromRepository,
    persistResponse
  };
}
