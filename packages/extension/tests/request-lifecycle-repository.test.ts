import { describe, expect, it, vi } from "vitest";

import { createDefaultRequestLifecycleRepository } from "../src/lib/request-lifecycle-repository.js";

describe("default request lifecycle repository", () => {
  it("checks fixture existence through the offscreen bridge", async () => {
    const sendOffscreenMessage = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, exists: true })
      .mockResolvedValueOnce({ ok: true, exists: false });
    const repository = createDefaultRequestLifecycleRepository({
      sendOffscreenMessage
    });
    const descriptor = { bodyPath: "body" } as any;

    await expect(repository.exists(descriptor)).resolves.toBe(true);
    await expect(repository.exists(descriptor)).resolves.toBe(false);
    expect(sendOffscreenMessage).toHaveBeenNthCalledWith(1, "fs.hasFixture", {
      descriptor
    });
  });

  it("throws when fixture existence checks fail", async () => {
    const repository = createDefaultRequestLifecycleRepository({
      sendOffscreenMessage: vi.fn().mockResolvedValue({
        ok: false,
        error: "Remote lookup failed."
      })
    });

    await expect(
      repository.exists({ bodyPath: "body" } as any)
    ).rejects.toThrow("Remote lookup failed.");
  });

  it("returns null for missing or incomplete fixture reads", async () => {
    const sendOffscreenMessage = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, exists: false })
      .mockResolvedValueOnce({
        ok: true,
        exists: true,
        request: { method: "GET" },
        meta: null,
        bodyBase64: "body"
      });
    const repository = createDefaultRequestLifecycleRepository({
      sendOffscreenMessage
    });

    await expect(
      repository.read({ bodyPath: "body" } as any)
    ).resolves.toBeNull();
    await expect(
      repository.read({ bodyPath: "body" } as any)
    ).resolves.toBeNull();
  });

  it("returns stored fixtures when the offscreen bridge has complete data", async () => {
    const repository = createDefaultRequestLifecycleRepository({
      sendOffscreenMessage: vi.fn().mockResolvedValue({
        ok: true,
        exists: true,
        request: {
          method: "GET",
          url: "https://api.example.com/items"
        },
        meta: {
          status: 200
        },
        bodyBase64: "eyJvayI6dHJ1ZX0=",
        size: 18
      })
    });

    await expect(repository.read({ bodyPath: "body" } as any)).resolves.toEqual(
      {
        request: {
          method: "GET",
          url: "https://api.example.com/items"
        },
        meta: {
          status: 200
        },
        bodyBase64: "eyJvayI6dHJ1ZX0=",
        size: 18
      }
    );
  });

  it("writes fixtures once and surfaces write failures", async () => {
    const sendOffscreenMessage = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "Write rejected." });
    const repository = createDefaultRequestLifecycleRepository({
      sendOffscreenMessage
    });
    const payload = {
      descriptor: { bodyPath: "body" } as any,
      request: {
        method: "GET"
      },
      response: {
        body: "fixture-body",
        bodyEncoding: "utf8" as const,
        meta: {
          status: 200
        }
      }
    };

    await expect(repository.writeIfAbsent(payload)).resolves.toEqual({
      ok: true
    });
    expect(sendOffscreenMessage).toHaveBeenNthCalledWith(
      1,
      "fs.writeFixture",
      payload
    );

    await expect(repository.writeIfAbsent(payload)).rejects.toThrow(
      "Write rejected."
    );
  });
});
