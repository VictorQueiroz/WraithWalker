import { describe, expect, it, vi } from "vitest";

import { whitelistSiteOrigin } from "../src/lib/site-whitelist.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

describe("site whitelist lifecycle", () => {
  it("requests host permission before loading or writing site configs", async () => {
    const callOrder: string[] = [];
    const readDeferred = createDeferred<
      Array<{
        origin: string;
        createdAt: string;
        dumpAllowlistPatterns: string[];
      }>
    >();
    const requestHostPermission = vi.fn(async () => {
      callOrder.push("request");
      return true;
    });
    const readSiteConfigs = vi.fn(() => {
      callOrder.push("read");
      return readDeferred.promise;
    });
    const writeSiteConfigs = vi.fn();

    const pending = whitelistSiteOrigin({
      originInput: "app.example.com",
      requestHostPermission,
      readSiteConfigs,
      writeSiteConfigs
    });

    await Promise.resolve();

    expect(requestHostPermission).toHaveBeenCalledWith(
      "https://app.example.com/*"
    );
    expect(callOrder).toEqual(["request", "read"]);
    expect(writeSiteConfigs).not.toHaveBeenCalled();

    readDeferred.resolve([]);
    await pending;

    expect(writeSiteConfigs).toHaveBeenCalledTimes(1);
  });

  it("stops before config reads and writes when host permission is denied", async () => {
    const requestHostPermission = vi.fn().mockResolvedValue(false);
    const readSiteConfigs = vi.fn();
    const writeSiteConfigs = vi.fn();

    await expect(
      whitelistSiteOrigin({
        originInput: "app.example.com",
        requestHostPermission,
        readSiteConfigs,
        writeSiteConfigs
      })
    ).rejects.toThrow(
      "Host access was not granted for https://app.example.com/*."
    );

    expect(readSiteConfigs).not.toHaveBeenCalled();
    expect(writeSiteConfigs).not.toHaveBeenCalled();
  });

  it("writes the same configured-site shape used by settings", async () => {
    const requestHostPermission = vi.fn().mockResolvedValue(true);
    const readSiteConfigs = vi.fn().mockResolvedValue([
      {
        origin: "https://alpha.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }
    ]);
    const writeSiteConfigs = vi.fn().mockResolvedValue(undefined);

    const result = await whitelistSiteOrigin({
      originInput: "docs.example.com",
      requestHostPermission,
      readSiteConfigs,
      writeSiteConfigs
    });

    expect(result.origin).toBe("https://docs.example.com");
    expect(result.permissionPattern).toBe("https://docs.example.com/*");
    expect(writeSiteConfigs).toHaveBeenCalledWith([
      expect.objectContaining({
        origin: "https://alpha.example.com"
      }),
      expect.objectContaining({
        origin: "https://docs.example.com",
        dumpAllowlistPatterns: [
          "\\.m?(js|ts)x?$",
          "\\.css$",
          "\\.wasm$",
          "\\.json$"
        ]
      })
    ]);
  });

  it("returns an already-enabled outcome for a duplicate origin after normalization without writing configs", async () => {
    const requestHostPermission = vi.fn().mockResolvedValue(true);
    const readSiteConfigs = vi.fn().mockResolvedValue([
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }
    ]);
    const writeSiteConfigs = vi.fn().mockResolvedValue(undefined);

    const result = await whitelistSiteOrigin({
      originInput: "app.example.com",
      requestHostPermission,
      readSiteConfigs,
      writeSiteConfigs
    });

    expect(requestHostPermission).toHaveBeenCalledWith(
      "https://app.example.com/*"
    );
    expect(readSiteConfigs).toHaveBeenCalledTimes(1);
    expect(writeSiteConfigs).not.toHaveBeenCalled();
    expect(result).toEqual({
      outcome: "already_enabled",
      origin: "https://app.example.com",
      permissionPattern: "https://app.example.com/*",
      siteConfigs: [
        {
          origin: "https://app.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }
      ]
    });
  });
});
