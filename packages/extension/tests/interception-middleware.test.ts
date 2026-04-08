import { describe, expect, it, vi } from "vitest";

import { createInterceptionMiddleware } from "../src/lib/interception-middleware.js";
import type { RequestEntry } from "../src/lib/types.js";

function createEntry(overrides: Partial<RequestEntry> = {}): RequestEntry {
  return {
    tabId: 1,
    requestId: "req-1",
    requestedAt: "2026-04-08T00:00:00.000Z",
    topOrigin: "https://app.example.com",
    method: "GET",
    url: "https://cdn.example.com/app.js",
    requestHeaders: [],
    requestBody: "",
    requestBodyEncoding: "utf8",
    descriptor: null,
    resourceType: "Script",
    mimeType: "application/javascript",
    replayed: false,
    responseStatus: 200,
    responseStatusText: "OK",
    responseHeaders: [{ name: "Content-Type", value: "application/javascript" }],
    ...overrides
  };
}

describe("interception middleware", () => {
  it("fulfills a request from the repository when a fixture exists", async () => {
    const descriptor = { bodyHash: "", queryHash: "", topOrigin: "https://app.example.com" };
    const fulfillRequest = vi.fn();
    const middleware = createInterceptionMiddleware({
      capturePolicy: {
        getSiteConfig: vi.fn().mockReturnValue({ mode: "simple" }),
        shouldPersist: vi.fn().mockReturnValue(true)
      },
      storageLayout: {
        describeRequest: vi.fn().mockResolvedValue(descriptor)
      },
      repository: {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue({
          request: { method: "GET", url: "https://cdn.example.com/app.js" },
          meta: {
            status: 200,
            statusText: "OK",
            headers: [
              { name: "Content-Type", value: "application/javascript" },
              { name: "Content-Length", value: "123" }
            ]
          },
          bodyBase64: "Y29uc29sZS5sb2coJ2hpJyk7",
          size: 18
        }),
        writeIfAbsent: vi.fn()
      },
      populatePostData: vi.fn(),
      continueRequest: vi.fn(),
      fulfillRequest,
      getResponseBody: vi.fn(),
      setLastError: vi.fn()
    });
    const entry = createEntry();

    await middleware.replayFromRepository({
      entry,
      tabId: 1,
      pausedRequestId: "fetch-1",
      networkRequestId: "network-1"
    });

    expect(entry.replayed).toBe(true);
    expect(fulfillRequest).toHaveBeenCalledWith(1, expect.objectContaining({
      requestId: "fetch-1",
      responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/javascript" }]
    }));
    expect(fulfillRequest).toHaveBeenCalledWith(1, expect.objectContaining({
      responsePhrase: "OK"
    }));
  });

  it("sanitizes invalid replay status codes and omits unsafe response phrases", async () => {
    const fulfillRequest = vi.fn();
    const middleware = createInterceptionMiddleware({
      capturePolicy: {
        getSiteConfig: vi.fn().mockReturnValue({ mode: "simple" }),
        shouldPersist: vi.fn().mockReturnValue(true)
      },
      storageLayout: {
        describeRequest: vi.fn().mockResolvedValue({ bodyHash: "", queryHash: "", topOrigin: "https://app.example.com" })
      },
      repository: {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue({
          request: { method: "GET", url: "https://cdn.example.com/app.js" },
          meta: {
            status: 42,
            statusText: "Broken\nPhrase",
            headers: [{ name: "Content-Type", value: "application/javascript" }]
          },
          bodyBase64: "Y29uc29sZS5sb2coJ2hpJyk7",
          size: 18
        }),
        writeIfAbsent: vi.fn()
      },
      populatePostData: vi.fn(),
      continueRequest: vi.fn(),
      fulfillRequest,
      getResponseBody: vi.fn(),
      setLastError: vi.fn()
    });

    await middleware.replayFromRepository({
      entry: createEntry(),
      tabId: 1,
      pausedRequestId: "fetch-invalid",
      networkRequestId: "network-invalid"
    });

    expect(fulfillRequest).toHaveBeenCalledWith(1, expect.objectContaining({
      requestId: "fetch-invalid",
      responseCode: 200
    }));
    expect(fulfillRequest).not.toHaveBeenCalledWith(1, expect.objectContaining({
      responsePhrase: expect.anything()
    }));
  });

  it("omits empty response phrases after trimming", async () => {
    const fulfillRequest = vi.fn();
    const middleware = createInterceptionMiddleware({
      capturePolicy: {
        getSiteConfig: vi.fn().mockReturnValue({ mode: "simple" }),
        shouldPersist: vi.fn().mockReturnValue(true)
      },
      storageLayout: {
        describeRequest: vi.fn().mockResolvedValue({ bodyHash: "", queryHash: "", topOrigin: "https://app.example.com" })
      },
      repository: {
        exists: vi.fn().mockResolvedValue(true),
        read: vi.fn().mockResolvedValue({
          request: { method: "GET", url: "https://cdn.example.com/app.js" },
          meta: {
            status: 200,
            statusText: "   ",
            headers: [{ name: "Content-Type", value: "application/javascript" }]
          },
          bodyBase64: "Y29uc29sZS5sb2coJ2hpJyk7",
          size: 18
        }),
        writeIfAbsent: vi.fn()
      },
      populatePostData: vi.fn(),
      continueRequest: vi.fn(),
      fulfillRequest,
      getResponseBody: vi.fn(),
      setLastError: vi.fn()
    });

    await middleware.replayFromRepository({
      entry: createEntry(),
      tabId: 1,
      pausedRequestId: "fetch-empty-phrase",
      networkRequestId: "network-empty-phrase"
    });

    expect(fulfillRequest).toHaveBeenCalledWith(1, expect.objectContaining({
      requestId: "fetch-empty-phrase",
      responseCode: 200
    }));
    expect(fulfillRequest).not.toHaveBeenCalledWith(1, expect.objectContaining({
      responsePhrase: expect.anything()
    }));
  });

  it("continues the request when no fixture exists", async () => {
    const continueRequest = vi.fn();
    const middleware = createInterceptionMiddleware({
      capturePolicy: {
        getSiteConfig: vi.fn(),
        shouldPersist: vi.fn().mockReturnValue(true)
      },
      storageLayout: {
        describeRequest: vi.fn().mockResolvedValue({ bodyHash: "", queryHash: "", topOrigin: "https://app.example.com" })
      },
      repository: {
        exists: vi.fn().mockResolvedValue(false),
        read: vi.fn(),
        writeIfAbsent: vi.fn()
      },
      populatePostData: vi.fn(),
      continueRequest,
      fulfillRequest: vi.fn(),
      getResponseBody: vi.fn(),
      setLastError: vi.fn()
    });

    await middleware.replayFromRepository({
      entry: createEntry(),
      tabId: 1,
      pausedRequestId: "fetch-2",
      networkRequestId: "network-2"
    });

    expect(continueRequest).toHaveBeenCalledWith(1, "fetch-2");
  });

  it("writes live responses through the repository when capture policy allows it", async () => {
    const writeIfAbsent = vi.fn().mockResolvedValue({ written: true });
    const middleware = createInterceptionMiddleware({
      capturePolicy: {
        getSiteConfig: vi.fn().mockReturnValue({ mode: "advanced" }),
        shouldPersist: vi.fn().mockReturnValue(true)
      },
      storageLayout: {
        describeRequest: vi.fn().mockResolvedValue({
          bodyHash: "body-1",
          queryHash: "query-1",
          topOrigin: "https://app.example.com"
        })
      },
      repository: {
        exists: vi.fn(),
        read: vi.fn(),
        writeIfAbsent
      },
      populatePostData: vi.fn().mockResolvedValue({
        body: '{"seed":"one"}',
        encoding: "utf8"
      }),
      continueRequest: vi.fn(),
      fulfillRequest: vi.fn(),
      getResponseBody: vi.fn().mockResolvedValue({
        body: '{"ok":true}',
        base64Encoded: false
      }),
      setLastError: vi.fn()
    });
    const entry = createEntry({
      method: "POST",
      url: "https://api.example.com/graphql",
      requestBody: "",
      resourceType: "XHR",
      mimeType: "application/json",
      responseStatus: 201,
      responseStatusText: "Created",
      responseHeaders: [{ name: "Content-Type", value: "application/json" }]
    });

    await middleware.persistResponse({
      entry,
      tabId: 1,
      requestId: "req-3"
    });

    expect(writeIfAbsent).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        method: "POST",
        body: '{"seed":"one"}'
      }),
      response: expect.objectContaining({
        body: '{"ok":true}',
        meta: expect.objectContaining({
          status: 201,
          method: "POST"
        })
      })
    }));
  });

  it("notifies the fixture-persisted hook after a successful write", async () => {
    const onFixturePersisted = vi.fn();
    const middleware = createInterceptionMiddleware({
      capturePolicy: {
        getSiteConfig: vi.fn().mockReturnValue({ mode: "advanced" }),
        shouldPersist: vi.fn().mockReturnValue(true)
      },
      storageLayout: {
        describeRequest: vi.fn().mockResolvedValue({
          bodyHash: "body-1",
          queryHash: "query-1",
          topOrigin: "https://app.example.com"
        })
      },
      repository: {
        exists: vi.fn(),
        read: vi.fn(),
        writeIfAbsent: vi.fn().mockResolvedValue({ written: true })
      },
      populatePostData: vi.fn().mockResolvedValue({
        body: "",
        encoding: "utf8"
      }),
      continueRequest: vi.fn(),
      fulfillRequest: vi.fn(),
      getResponseBody: vi.fn().mockResolvedValue({
        body: "console.log('ok')",
        base64Encoded: false
      }),
      setLastError: vi.fn(),
      onFixturePersisted
    });

    const entry = createEntry();
    await middleware.persistResponse({
      entry,
      tabId: 1,
      requestId: "req-hook"
    });

    expect(onFixturePersisted).toHaveBeenCalledWith(expect.objectContaining({
      entry,
      descriptor: expect.objectContaining({
        topOrigin: "https://app.example.com"
      }),
      capturedAt: expect.any(String)
    }));
  });

  it("skips persistence when capture policy rejects the request", async () => {
    const writeIfAbsent = vi.fn();
    const middleware = createInterceptionMiddleware({
      capturePolicy: {
        getSiteConfig: vi.fn(),
        shouldPersist: vi.fn().mockReturnValue(false)
      },
      storageLayout: {
        describeRequest: vi.fn()
      },
      repository: {
        exists: vi.fn(),
        read: vi.fn(),
        writeIfAbsent
      },
      populatePostData: vi.fn(),
      continueRequest: vi.fn(),
      fulfillRequest: vi.fn(),
      getResponseBody: vi.fn(),
      setLastError: vi.fn()
    });

    await middleware.persistResponse({
      entry: createEntry(),
      tabId: 1,
      requestId: "req-skip"
    });

    expect(writeIfAbsent).not.toHaveBeenCalled();
  });
});
