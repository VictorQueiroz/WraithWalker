import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { describe, expect, it } from "vitest";

import { createFixtureDescriptor } from "@wraithwalker/core/fixture-layout";

import { createServerRootRuntime } from "../src/root-runtime.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

describe("server root runtime adapter", () => {
  it("reuses a provided sentinel and shares fixture plus context behavior", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-mcp-root-runtime-"
    });
    const runtime = createServerRootRuntime({
      rootPath: root.rootPath,
      sentinel: root.sentinel
    });
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://api.example.com/users",
      siteMode: "simple",
      resourceType: "Fetch",
      mimeType: "application/json"
    });

    expect(await runtime.ensureReady()).toEqual(root.sentinel);

    await runtime.writeIfAbsent({
      descriptor,
      request: {
        topOrigin: descriptor.topOrigin,
        url: descriptor.requestUrl,
        method: descriptor.method,
        headers: [],
        body: "",
        bodyEncoding: "utf8",
        bodyHash: descriptor.bodyHash,
        queryHash: descriptor.queryHash,
        capturedAt: "2026-04-07T00:00:00.000Z"
      },
      response: {
        body: JSON.stringify({ users: [{ id: 1 }] }),
        bodyEncoding: "utf8",
        meta: {
          status: 200,
          statusText: "OK",
          headers: [{ name: "Content-Type", value: "application/json" }],
          mimeType: "application/json",
          resourceType: "Fetch",
          url: descriptor.requestUrl,
          method: descriptor.method,
          capturedAt: "2026-04-07T00:00:00.000Z",
          bodyEncoding: "utf8",
          bodySuggestedExtension: "json"
        }
      }
    });

    expect(await runtime.has(descriptor)).toBe(true);
    const fixture = await runtime.read(descriptor);
    expect(fixture?.size).toBeGreaterThan(0);

    await runtime.generateContext({
      editorId: "cursor",
      siteConfigs: [{
        origin: "https://app.example.com",
        mode: "simple"
      }]
    });

    await expect(fs.readFile(path.join(root.rootPath, "CLAUDE.md"), "utf8")).resolves.toContain("WraithWalker Fixture Context");
    await expect(fs.readFile(path.join(root.rootPath, ".cursorrules"), "utf8")).resolves.toContain("Cursor Agent Brief");
  });

  it("creates a sentinel on demand and throws a clear error when a body disappears mid-read", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-mcp-root-runtime-"));
    const runtime = createServerRootRuntime({ rootPath });

    const sentinel = await runtime.ensureReady();
    expect(sentinel.rootId).toBeTruthy();

    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/app.js",
      siteMode: "simple",
      resourceType: "Script",
      mimeType: "application/javascript"
    });
    const brokenRuntime = createServerRootRuntime({
      rootPath,
      sentinel,
      rootFs: {
        rootPath,
        exists: async () => true,
        stat: async () => null,
        readOptionalJson: async () => null,
        readBodyAsBase64: async () => "",
        readText: async () => "",
        writeText: async () => {},
        writeJson: async () => {},
        writeBody: async () => {},
        listDirectory: async () => [],
        resolve: () => null,
        readOptionalText: async () => null,
        readJson: async () => ({}),
        ensureDir: async () => {},
        listOptionalDirectory: async () => [],
        listDirectories: async () => [],
        listOptionalDirectories: async () => [],
        remove: async () => {},
        copyRecursive: async () => {}
      } as never
    });

    await expect(brokenRuntime.read(descriptor)).rejects.toThrow(
      `Fixture body not found at ${descriptor.bodyPath}`
    );
  });
});
