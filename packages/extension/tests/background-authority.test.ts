import { afterEach, describe, expect, it, vi } from "vitest";

import { getRequiredRootId } from "../src/lib/background-authority.js";
import { createAuthorityHarness } from "./helpers/background-authority-test-helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("background authority facade", () => {
  it("prefers the server root when ensuring root readiness", async () => {
    const { authority, state } = createAuthorityHarness({
      stateOverrides: {
        lastError: "stale error"
      }
    });

    await expect(authority.ensureRootReady()).resolves.toEqual({
      ok: true,
      sentinel: { rootId: "server-root" },
      permission: "granted"
    });
    expect(state.lastError).toBe("");
  });

  it("falls back to the local root through the stable facade when the server is unavailable", async () => {
    const { authority } = createAuthorityHarness({
      serverClientOverrides: {
        heartbeat: vi.fn().mockRejectedValue(new Error("offline"))
      },
      chromeApi: (() => {
        const chromeApi = createAuthorityHarness().chromeApi;
        chromeApi.runtime.getContexts.mockResolvedValue([{}]);
        chromeApi.runtime.sendMessage.mockImplementation(async (message) => {
          if (message?.type === "fs.ensureRoot") {
            return { ok: true, sentinel: { rootId: "local-root" }, permission: "granted" };
          }
          return { ok: true };
        });
        return chromeApi;
      })()
    });

    await expect(authority.ensureRootReady()).resolves.toEqual({
      ok: true,
      sentinel: { rootId: "local-root" },
      permission: "granted"
    });
  });

  it("re-exports getRequiredRootId", () => {
    expect(getRequiredRootId({
      ok: true,
      permission: "granted",
      sentinel: { rootId: "root-1" }
    })).toBe("root-1");
    expect(getRequiredRootId({
      ok: true,
      permission: "granted",
      sentinel: { rootId: "   " }
    })).toBeNull();
  });
});
