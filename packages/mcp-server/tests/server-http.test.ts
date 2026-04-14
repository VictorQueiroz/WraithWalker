import http, { type IncomingMessage, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeHttpListener,
  closeHttpSession,
  createJsonRpcError,
  createLoopbackHttpApp,
  formatUrlHost,
  getSessionId,
  isLoopbackHost
} from "../src/server-http.mts";

const activeListeners: Server[] = [];

afterEach(async () => {
  await Promise.allSettled(activeListeners.splice(0).map((listener) => closeHttpListener(listener)));
  vi.restoreAllMocks();
});

async function startLoopbackApp(): Promise<Server> {
  const app = createLoopbackHttpApp();
  app.get("/", (_req, res) => {
    res.status(200).send("ok");
  });

  const listener = await new Promise<Server>((resolve, reject) => {
    const nextListener = app.listen(0, "127.0.0.1", () => resolve(nextListener));
    nextListener.once("error", reject);
  });
  activeListeners.push(listener);
  return listener;
}

function invokeLoopbackHostGuard(hostHeader?: string) {
  const app = createLoopbackHttpApp();
  const middleware = app.router.stack[0]?.handle as ((req: unknown, res: unknown, next: () => void) => void) | undefined;
  if (!middleware) {
    throw new Error("Expected the loopback app to register a host-validation middleware.");
  }

  const result = {
    statusCode: 200,
    payload: null as unknown
  };
  const res = {
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      result.payload = payload;
      return this;
    }
  };
  const next = vi.fn();

  middleware(
    {
      headers: hostHeader ? { host: hostHeader } : {}
    },
    res,
    next
  );

  return {
    ...result,
    next
  };
}

async function requestLoopbackApp(
  listener: Server,
  {
    hostHeader,
    setHost
  }: {
    hostHeader?: string;
    setHost?: boolean;
  } = {}
): Promise<{ statusCode: number; body: string }> {
  const address = listener.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve test server address.");
  }

  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      path: "/",
      method: "GET",
      ...(typeof setHost === "boolean" ? { setHost } : {}),
      ...(hostHeader ? { headers: { host: hostHeader } } : {})
    }, (res: IncomingMessage) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          body
        });
      });
    });

    req.on("error", reject);
    req.end();
  });
}

describe("server http helpers", () => {
  it("rejects loopback requests without a Host header", async () => {
    const response = invokeLoopbackHostGuard();

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual(createJsonRpcError(-32000, "Missing Host header"));
    expect(response.next).not.toHaveBeenCalled();
  });

  it("rejects malformed and non-loopback Host headers", async () => {
    const listener = await startLoopbackApp();

    const malformedResponse = await requestLoopbackApp(listener, { hostHeader: "[::1" });
    expect(malformedResponse.statusCode).toBe(403);
    expect(JSON.parse(malformedResponse.body)).toEqual(
      createJsonRpcError(-32000, "Invalid Host header: [::1")
    );

    const disallowedResponse = await requestLoopbackApp(listener, { hostHeader: "example.com" });
    expect(disallowedResponse.statusCode).toBe(403);
    expect(JSON.parse(disallowedResponse.body)).toEqual(
      createJsonRpcError(-32000, "Invalid Host: example.com")
    );
  });

  it("allows recognized loopback Host headers through the middleware", async () => {
    const listener = await startLoopbackApp();

    const localhostResponse = await requestLoopbackApp(listener, { hostHeader: "localhost" });
    expect(localhostResponse).toEqual({
      statusCode: 200,
      body: "ok"
    });

    const ipv6Response = await requestLoopbackApp(listener, { hostHeader: "[::1]" });
    expect(ipv6Response).toEqual({
      statusCode: 200,
      body: "ok"
    });
  });

  it("normalizes session IDs and loopback hostnames", () => {
    expect(getSessionId(["session-1", "session-2"])).toBe("session-1");
    expect(getSessionId("session-3")).toBe("session-3");
    expect(getSessionId(undefined)).toBeUndefined();

    expect(formatUrlHost("[::1]")).toBe("[::1]");
    expect(formatUrlHost("::1")).toBe("[::1]");
    expect(formatUrlHost("127.0.0.1")).toBe("127.0.0.1");

    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("example.com")).toBe(false);
  });

  it("closes HTTP sessions even when one side rejects", async () => {
    const session = {
      transport: {
        close: vi.fn().mockRejectedValue(new Error("transport failed"))
      },
      server: {
        close: vi.fn().mockResolvedValue(undefined)
      }
    };

    await expect(closeHttpSession(session as never)).resolves.toBeUndefined();
    expect(session.transport.close).toHaveBeenCalledTimes(1);
    expect(session.server.close).toHaveBeenCalledTimes(1);
  });

  it("propagates listener close failures", async () => {
    const listener = {
      close: vi.fn((callback: (error?: Error | null) => void) => {
        callback(new Error("listener close failed"));
        return listener;
      })
    };

    await expect(closeHttpListener(listener as unknown as Server)).rejects.toThrow("listener close failed");
  });
});
