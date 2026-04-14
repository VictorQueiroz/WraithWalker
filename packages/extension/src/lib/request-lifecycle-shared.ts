import type {
  AttachedTabState,
  FixtureDescriptor,
  HeaderInput,
  RequestEntry,
  RequestPayload,
  ResponseMeta,
  SiteConfig,
  StoredFixture
} from "./types.js";

export interface LifecycleSource {
  tabId?: number;
}

export interface LifecycleRequest {
  method: string;
  url: string;
  headers: HeaderInput;
  postData?: string;
}

export interface FetchRequestPausedParams {
  requestId: string;
  networkId?: string;
  request: LifecycleRequest;
  resourceType?: string;
  responseStatusCode?: number;
  responseHeaders?: HeaderInput;
  responseErrorReason?: string;
}

export interface NetworkRequestWillBeSentParams {
  requestId: string;
  request: LifecycleRequest;
  type?: string;
}

export interface NetworkResponseReceivedParams {
  requestId: string;
  response: {
    status: number;
    statusText: string;
    headers: HeaderInput;
    mimeType?: string;
  };
  type?: string;
}

export interface NetworkLoadingParams {
  requestId: string;
}

export interface PostDataResult {
  body: string;
  encoding: "utf8" | "base64";
}

export interface PostDataResponse {
  postData?: string;
  base64Encoded?: boolean;
}

export interface ResponseBodyResponse {
  body: string;
  base64Encoded?: boolean;
}

export interface FixtureCheckResponse {
  ok: boolean;
  exists?: boolean;
  error?: string;
}

export interface FixtureReadResponse extends FixtureCheckResponse {
  request?: RequestPayload;
  bodyBase64?: string;
  meta?: ResponseMeta;
  size?: number;
}

export interface RequestLifecycleState {
  sessionActive: boolean;
  attachedTabs: Map<number, AttachedTabState>;
  requests: Map<string, RequestEntry>;
}

export interface FixtureWritePayload {
  descriptor: FixtureDescriptor;
  request: RequestPayload;
  response: {
    body: string;
    bodyEncoding: "utf8" | "base64";
    meta: ResponseMeta;
  };
}

export interface RequestLifecycleRepository {
  exists: (descriptor: FixtureDescriptor) => Promise<boolean>;
  read: (descriptor: FixtureDescriptor) => Promise<StoredFixture | null>;
  writeIfAbsent: (payload: FixtureWritePayload) => Promise<unknown>;
}

export interface RequestLifecycleMiddleware {
  ensureDescriptor(entry: RequestEntry): Promise<FixtureDescriptor>;
  loadReplayFixture(args: {
    entry: RequestEntry;
    tabId: number;
    networkRequestId: string;
    fallbackRequest?: { postData?: string };
  }): Promise<{ descriptor: FixtureDescriptor; fixture: StoredFixture } | null>;
  shouldReplayWithLiveResponseHeaders(args: {
    descriptor: FixtureDescriptor;
    fixture: StoredFixture;
  }): boolean;
  fulfillReplay(args: {
    entry: RequestEntry;
    tabId: number;
    pausedRequestId: string;
    descriptor: FixtureDescriptor;
    fixture: StoredFixture;
    liveResponse?: {
      status?: number;
      statusText?: string;
      headers?: ResponseMeta["headers"];
    };
  }): Promise<void>;
  persistResponse(args: {
    entry: RequestEntry;
    tabId: number;
    requestId: string;
  }): Promise<void>;
}

export interface RequestLifecycleDependencies {
  state: RequestLifecycleState;
  sendDebuggerCommand: <T = unknown>(tabId: number, method: string, params?: Record<string, unknown>) => Promise<T>;
  sendOffscreenMessage: <T = unknown>(type: string, payload?: Record<string, unknown>) => Promise<T>;
  setLastError: (message: string) => void;
  repository?: RequestLifecycleRepository;
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
  createInterceptionMiddleware?: (...args: any[]) => RequestLifecycleMiddleware;
  requestKey?: (tabId: number, requestId: string) => string;
  onFixturePersisted?: (payload: {
    descriptor: FixtureDescriptor;
    entry: RequestEntry;
    capturedAt: string;
  }) => Promise<void> | void;
}
