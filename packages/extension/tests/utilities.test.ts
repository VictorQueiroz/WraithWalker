import { describe, expect, it, vi } from "vitest";

import { queryRequired } from "../src/lib/dom.ts";
import {
  arrayBufferToBase64,
  base64ToBytes,
  bytesToBase64,
  textToBase64
} from "../src/lib/encoding.ts";
import { sha256Hex, shortHash } from "../src/lib/hash.ts";
import {
  getConfiguredSiteConfigs,
  getEffectiveSiteConfigs,
  setConfiguredSiteConfigs
} from "../src/lib/root-config.ts";

describe("dom helpers", () => {
  it("returns a required element and throws when it is missing", () => {
    const expectedElement = { id: "root" } as unknown as Element;
    const root = {
      querySelector(selector: string) {
        return selector === "#root" ? expectedElement : null;
      }
    } as ParentNode;

    expect(queryRequired("#root", root)).toBe(expectedElement);
    expect(() => queryRequired(".missing", root)).toThrow(
      "Missing required element: .missing"
    );
  });
});

describe("encoding helpers", () => {
  it("round-trips bytes, text, and array buffers through base64", () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]);

    expect(bytesToBase64(bytes)).toBe("SGVsbG8=");
    expect(base64ToBytes("SGVsbG8=")).toEqual(bytes);
    expect(textToBase64("Hello")).toBe("SGVsbG8=");
    expect(arrayBufferToBase64(bytes.buffer)).toBe("SGVsbG8=");
  });
});

describe("hash helpers", () => {
  it("creates deterministic SHA-256 hashes", async () => {
    const full = await sha256Hex("wraithwalker");

    expect(full).toBe(
      "eefaea2b0179d2707e2f2adf6f6bd81c88fb9d412f6e245c88a81f4c0bfc28cc"
    );
    await expect(shortHash("wraithwalker", 8)).resolves.toBe(full.slice(0, 8));
  });
});

describe("root config helpers", () => {
  const runtime = {
    sendMessage: vi.fn()
  };

  it("reads configured and effective site configs through the background runtime", async () => {
    runtime.sendMessage
      .mockResolvedValueOnce({
        ok: true,
        siteConfigs: [
          {
            origin: "https://app.example.com",
            createdAt: "2026-04-09T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ],
        sentinel: { rootId: "root-123" }
      })
      .mockResolvedValueOnce({
        ok: true,
        siteConfigs: [
          {
            origin: "https://app.example.com",
            createdAt: "2026-04-09T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          }
        ],
        sentinel: { rootId: "root-123" }
      });

    await expect(getConfiguredSiteConfigs(runtime)).resolves.toEqual([
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }
    ]);
    await expect(getEffectiveSiteConfigs(runtime)).resolves.toEqual([
      {
        origin: "https://app.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }
    ]);
  });

  it("treats missing or unavailable root configs as empty config lists", async () => {
    runtime.sendMessage
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ok: false,
        error: "No root directory selected."
      })
      .mockResolvedValueOnce({
        ok: false,
        error: "Root directory access is not granted."
      });

    await expect(getConfiguredSiteConfigs(runtime)).resolves.toEqual([]);
    await expect(getConfiguredSiteConfigs(runtime)).resolves.toEqual([]);
    await expect(getEffectiveSiteConfigs(runtime)).resolves.toEqual([]);
  });

  it("throws unexpected config read and write errors", async () => {
    runtime.sendMessage
      .mockResolvedValueOnce({ ok: false, error: "Boom." })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ok: false, error: "Still broken." });

    await expect(getConfiguredSiteConfigs(runtime)).rejects.toThrow("Boom.");
    await expect(setConfiguredSiteConfigs([], runtime)).rejects.toThrow(
      "Failed to update root config."
    );
    await expect(setConfiguredSiteConfigs([], runtime)).rejects.toThrow(
      "Still broken."
    );
  });

  it("writes configured site configs through the background runtime", async () => {
    runtime.sendMessage.mockResolvedValueOnce({
      ok: true,
      siteConfigs: [],
      sentinel: { rootId: "root-123" }
    });

    await expect(
      setConfiguredSiteConfigs([], runtime)
    ).resolves.toBeUndefined();
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: "config.writeConfiguredSiteConfigs",
      siteConfigs: []
    });
  });
});
