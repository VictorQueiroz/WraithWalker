import { describe, expect, it, vi } from "vitest";

import {
  createTimedFetch,
  createWraithWalkerServerTransportOptions,
  isServerCacheFresh,
  WRAITHWALKER_SERVER_SOURCE_HEADER,
  WRAITHWALKER_SERVER_REQUEST_TIMEOUT_MS
} from "../src/lib/wraithwalker-server.js";

describe("wraithwalker server client helpers", () => {
  it("reports freshness based on the configured ttl", () => {
    expect(isServerCacheFresh(1_000, 5_000, 5_500)).toBe(true);
    expect(isServerCacheFresh(1_000, 5_000, 6_001)).toBe(false);
    expect(isServerCacheFresh(0, 5_000, 1_000)).toBe(false);
  });

  it("wraps fetch without changing successful responses", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    const timedFetch = createTimedFetch(100, fetchImpl);

    const response = await timedFetch("http://127.0.0.1:4319/trpc/system.info");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("aborts slow requests with the default timeout budget", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_, reject) => {
          const signal = init?.signal;
          signal?.addEventListener(
            "abort",
            () => {
              reject(signal.reason);
            },
            { once: true }
          );
        })
    );

    const timedFetch = createTimedFetch(1, fetchImpl);

    await expect(
      timedFetch("http://127.0.0.1:4319/trpc/system.info")
    ).rejects.toThrow(`Timed out after 1ms`);
  });

  it("keeps the exported default timeout meaningful for local server probes", () => {
    expect(WRAITHWALKER_SERVER_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(WRAITHWALKER_SERVER_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(1_000);
  });

  it("forces POST batching for extension-side local server traffic", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    const transport = createWraithWalkerServerTransportOptions(
      "http://127.0.0.1:4319/trpc",
      {
        timeoutMs: 42,
        fetchImpl
      }
    );

    expect(transport.url).toBe("http://127.0.0.1:4319/trpc");
    expect(transport.methodOverride).toBe("POST");
    expect(await transport.headers()).toEqual({
      "x-trpc-source": WRAITHWALKER_SERVER_SOURCE_HEADER
    });

    await transport.fetch("http://127.0.0.1:4319/trpc/system.info", {
      method: "POST"
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:4319/trpc/system.info",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal)
      })
    );
  });
});
