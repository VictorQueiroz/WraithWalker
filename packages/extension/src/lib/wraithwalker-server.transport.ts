import {
  DEFAULT_WRAITHWALKER_SERVER_TRPC_URL,
  WRAITHWALKER_SERVER_CACHE_TTL_MS,
  WRAITHWALKER_SERVER_REQUEST_TIMEOUT_MS,
  WRAITHWALKER_SERVER_SOURCE_HEADER,
  type WraithWalkerServerClientOptions
} from "./wraithwalker-server.shared.js";

export function createTimedFetch(
  timeoutMs = WRAITHWALKER_SERVER_REQUEST_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch
): typeof fetch {
  return async (input, init) => {
    const requestInit: RequestInit = init ?? {};
    const controller = new AbortController();
    const upstreamSignal = requestInit.signal;
    const onAbort = () => controller.abort(upstreamSignal?.reason);
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        controller.abort(upstreamSignal.reason);
      } else {
        upstreamSignal.addEventListener("abort", onAbort, { once: true });
      }
    }

    try {
      return await fetchImpl(input, {
        ...requestInit,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener("abort", onAbort);
    }
  };
}

export function isServerCacheFresh(
  checkedAt: number,
  ttlMs = WRAITHWALKER_SERVER_CACHE_TTL_MS,
  now = Date.now()
): boolean {
  return checkedAt > 0 && now - checkedAt < ttlMs;
}

export function createWraithWalkerServerTransportOptions(
  url = DEFAULT_WRAITHWALKER_SERVER_TRPC_URL,
  {
    timeoutMs = WRAITHWALKER_SERVER_REQUEST_TIMEOUT_MS,
    fetchImpl = fetch
  }: WraithWalkerServerClientOptions = {}
) {
  return {
    url,
    // Force POST for batched queries so the browser never builds oversized loopback URLs.
    methodOverride: "POST" as const,
    headers() {
      return {
        "x-trpc-source": WRAITHWALKER_SERVER_SOURCE_HEADER
      };
    },
    fetch: createTimedFetch(timeoutMs, fetchImpl)
  };
}
