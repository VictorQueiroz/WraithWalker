import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { describe, expect, it } from "vitest";

import { syncOverridesDirectory } from "../src/overrides-sync.mts";

async function tmpdir(
  prefix = "wraithwalker-core-overrides-"
): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(
  root: string,
  relativePath: string,
  content: string | Uint8Array
): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function readJson<T>(root: string, relativePath: string): Promise<T> {
  return JSON.parse(
    await fs.readFile(path.join(root, relativePath), "utf8")
  ) as T;
}

describe("syncOverridesDirectory", () => {
  it("syncs Chrome Overrides into .wraithwalker metadata, applies .headers rules, and rebuilds manifests", async () => {
    const dir = await tmpdir();
    const events: Array<{
      type: string;
      requestUrl?: string;
      reason?: string;
      bodyPath?: string;
    }> = [];

    await writeFile(
      dir,
      ".headers",
      JSON.stringify(
        [
          {
            applyTo: "*.html",
            headers: [{ name: "Cache-Control", value: "no-store" }]
          }
        ],
        null,
        2
      )
    );
    await writeFile(dir, "app.example.com/index.html", "<!doctype html>");
    await writeFile(
      dir,
      "app.example.com/styles/app.css",
      "body { color: red; }"
    );
    await writeFile(
      dir,
      "app.example.com/scripts/.headers",
      JSON.stringify(
        [
          {
            applyTo: "*.js",
            headers: [
              { name: "Content-Type", value: "application/x-custom-js" },
              { name: "Set-Cookie", value: "a=1" }
            ]
          },
          {
            applyTo: "*.js",
            headers: [{ name: "Set-Cookie", value: "b=2" }]
          }
        ],
        null,
        2
      )
    );
    await writeFile(
      dir,
      "app.example.com/scripts/app.js",
      "console.log('hi');"
    );
    await writeFile(
      dir,
      "app.example.com/fonts/site.woff2",
      new Uint8Array([239, 187, 191, 65])
    );
    await writeFile(
      dir,
      "app.example.com/media/clip.mp3",
      new Uint8Array([73, 68, 51, 4])
    );
    await writeFile(
      dir,
      "app.example.com/images/logo.png",
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    );
    await writeFile(
      dir,
      "app.example.com/data/blob.json?lang=en",
      '{"ok":true}'
    );
    await writeFile(dir, "notes/readme.txt", "skip me");
    await writeFile(dir, ".wraithwalker/ignored.txt", "ignore me");

    const first = await syncOverridesDirectory({
      dir,
      onEvent(event) {
        events.push(event);
      }
    });

    expect(first.topOrigins).toEqual([
      "http://app.example.com",
      "https://app.example.com"
    ]);
    expect(first.topOrigin).toBe("http://app.example.com");
    expect(first.imported).toHaveLength(14);
    expect(first.skipped).toEqual([
      {
        requestUrl: "notes/readme.txt",
        method: "GET",
        reason: "Override path does not start with a valid host segment"
      }
    ]);
    expect(events[0]).toEqual({
      type: "scan-complete",
      totalEntries: 8,
      totalCandidates: 14,
      topOrigin: "http://app.example.com",
      topOrigins: ["http://app.example.com", "https://app.example.com"]
    });
    expect(
      events.some(
        (event) =>
          event.type === "entry-skipped" &&
          event.requestUrl === "notes/readme.txt"
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "entry-start" &&
          event.bodyPath === "app.example.com/index.html"
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "entry-progress" &&
          event.bodyPath === "app.example.com/index.html"
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "entry-complete" &&
          event.bodyPath === "app.example.com/index.html"
      )
    ).toBe(true);

    const httpsManifest = await readJson<{
      topOrigin: string;
      resourcesByPathname: Record<
        string,
        Array<{
          bodyPath: string;
          projectionPath?: string | null;
          mimeType: string;
          resourceType: string;
        }>
      >;
    }>(
      dir,
      ".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json"
    );
    expect(httpsManifest.topOrigin).toBe("https://app.example.com");
    expect(
      Object.values(httpsManifest.resourcesByPathname).flat()
    ).toHaveLength(7);
    expect(httpsManifest.resourcesByPathname["/scripts/app.js"]).toEqual([
      expect.objectContaining({
        bodyPath:
          ".wraithwalker/captures/assets/https__app.example.com/app.example.com/scripts/app.js.__body",
        projectionPath: "app.example.com/scripts/app.js",
        mimeType: "application/javascript",
        resourceType: "Script"
      })
    ]);
    expect(httpsManifest.resourcesByPathname["/data/blob.json"]).toEqual([
      expect.objectContaining({
        bodyPath:
          ".wraithwalker/captures/assets/https__app.example.com/app.example.com/data/blob.json?lang=en.__body",
        projectionPath: "app.example.com/data/blob.json?lang=en",
        search: "?lang=en",
        mimeType: "application/json",
        resourceType: "Other"
      })
    ]);

    const htmlMeta = await readJson<{
      headers: Array<{ name: string; value: string }>;
      resourceType: string;
      bodyEncoding: string;
    }>(
      dir,
      ".wraithwalker/captures/assets/https__app.example.com/app.example.com/index.html.__response.json"
    );
    expect(htmlMeta.resourceType).toBe("Document");
    expect(htmlMeta.bodyEncoding).toBe("utf8");
    expect(htmlMeta.headers).toContainEqual({
      name: "Cache-Control",
      value: "no-store"
    });

    const cssMeta = await readJson<{ resourceType: string }>(
      dir,
      ".wraithwalker/captures/assets/https__app.example.com/app.example.com/styles/app.css.__response.json"
    );
    expect(cssMeta.resourceType).toBe("Stylesheet");
    expect((cssMeta as { headerStrategy?: string }).headerStrategy).toBe(
      "live"
    );

    const jsMeta = await readJson<{
      headers: Array<{ name: string; value: string }>;
      resourceType: string;
    }>(
      dir,
      ".wraithwalker/captures/assets/https__app.example.com/app.example.com/scripts/app.js.__response.json"
    );
    expect(jsMeta.resourceType).toBe("Script");
    expect(jsMeta.headers).toEqual(
      expect.arrayContaining([
        { name: "Content-Type", value: "application/x-custom-js" },
        { name: "Set-Cookie", value: "a=1" },
        { name: "Set-Cookie", value: "b=2" }
      ])
    );
    expect((jsMeta as { headerStrategy?: string }).headerStrategy).toBe(
      "stored"
    );

    const fontMeta = await readJson<{
      resourceType: string;
      bodyEncoding: string;
    }>(
      dir,
      ".wraithwalker/captures/assets/https__app.example.com/app.example.com/fonts/site.woff2.__response.json"
    );
    expect(fontMeta.resourceType).toBe("Font");
    expect(fontMeta.bodyEncoding).toBe("base64");

    const mediaMeta = await readJson<{ resourceType: string }>(
      dir,
      ".wraithwalker/captures/assets/https__app.example.com/app.example.com/media/clip.mp3.__response.json"
    );
    expect(mediaMeta.resourceType).toBe("Media");

    const imageMeta = await readJson<{
      resourceType: string;
      bodyEncoding: string;
    }>(
      dir,
      ".wraithwalker/captures/assets/https__app.example.com/app.example.com/images/logo.png.__response.json"
    );
    expect(imageMeta.resourceType).toBe("Image");
    expect(imageMeta.bodyEncoding).toBe("base64");

    const otherMeta = await readJson<{ resourceType: string }>(
      dir,
      ".wraithwalker/captures/assets/https__app.example.com/app.example.com/data/blob.json?lang=en.__response.json"
    );
    expect(otherMeta.resourceType).toBe("Other");

    const requestPayload = await readJson<{
      topOrigin: string;
      queryHash: string;
      bodyHash: string;
    }>(
      dir,
      ".wraithwalker/captures/assets/https__app.example.com/app.example.com/index.html.__request.json"
    );
    expect(requestPayload.topOrigin).toBe("https://app.example.com");
    expect(requestPayload.queryHash).toHaveLength(12);
    expect(requestPayload.bodyHash).toHaveLength(12);

    await fs.rm(path.join(dir, "app.example.com", "data", "blob.json?lang=en"));
    const second = await syncOverridesDirectory({ dir });
    expect(second.sentinel.rootId).toBe(first.sentinel.rootId);

    const rebuiltManifest = await readJson<{
      resourcesByPathname: Record<string, unknown[]>;
    }>(
      dir,
      ".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json"
    );
    expect(
      Object.values(rebuiltManifest.resourcesByPathname).flat()
    ).toHaveLength(6);
    expect(
      rebuiltManifest.resourcesByPathname["/data/blob.json"]
    ).toBeUndefined();
  });

  it("skips unsupported override paths and invalid .headers files and returns an empty origin set when nothing is usable", async () => {
    const dir = await tmpdir();

    await writeFile(dir, "broken.example.com/.headers", "{oops");
    await writeFile(
      dir,
      "shape.example.com/.headers",
      JSON.stringify([{ applyTo: "*.js", headers: [] }])
    );
    await writeFile(dir, "bad%ZZ/file.js", "console.log('bad');");
    await writeFile(dir, "bad host/file.js", "console.log('host');");
    await writeFile(dir, "file:/tmp/test.txt", "file override");
    await writeFile(dir, "orphan.example.com", "no nested path");
    await writeFile(
      dir,
      "site.example.com/longurls/abc123.js",
      "console.log('hashed');"
    );
    await writeFile(dir, "notes/readme.txt", "still not a host");

    const result = await syncOverridesDirectory({ dir });

    expect(result.topOrigin).toBe("");
    expect(result.topOrigins).toEqual([]);
    expect(result.imported).toEqual([]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        {
          requestUrl: "bad%ZZ/file.js",
          method: "GET",
          reason: "Override path contains invalid percent-encoding"
        },
        {
          requestUrl: "bad host/file.js",
          method: "GET",
          reason: "Override path does not start with a valid host segment"
        },
        {
          requestUrl: "file:/tmp/test.txt",
          method: "GET",
          reason: "Only http and https override paths are supported"
        },
        {
          requestUrl: "orphan.example.com",
          method: "GET",
          reason: "Override file does not map to a request path"
        },
        {
          requestUrl: "site.example.com/longurls/abc123.js",
          method: "GET",
          reason:
            "Cannot reconstruct original URLs from DevTools longurls overrides"
        },
        {
          requestUrl: "notes/readme.txt",
          method: "GET",
          reason: "Override path does not start with a valid host segment"
        }
      ])
    );
    expect(
      result.skipped.find(
        (entry) => entry.requestUrl === "broken.example.com/.headers"
      )?.reason
    ).toMatch(/^Failed to parse broken\.example\.com\/\.headers: /);
    expect(
      result.skipped.find(
        (entry) => entry.requestUrl === "shape.example.com/.headers"
      )?.reason
    ).toBe(
      "Failed to parse shape.example.com/.headers: Invalid .headers JSON payload"
    );
  });

  it("reports non-Error .headers parse failures with String(error)", async () => {
    const dir = await tmpdir();
    const originalParse = JSON.parse;

    await writeFile(dir, "app.example.com/.headers", "[]");

    try {
      JSON.parse = (() => {
        throw "string failure";
      }) as typeof JSON.parse;

      const result = await syncOverridesDirectory({ dir });
      expect(result.skipped).toEqual([
        {
          requestUrl: "app.example.com/.headers",
          method: "GET",
          reason: "Failed to parse app.example.com/.headers: string failure"
        }
      ]);
    } finally {
      JSON.parse = originalParse;
    }
  });

  it("respects root and nested .gitignore rules during sync", async () => {
    const dir = await tmpdir();

    await writeFile(
      dir,
      ".gitignore",
      [
        "ignored.example.com/",
        "app.example.com/scripts/*.skip.js",
        "!app.example.com/scripts/keep.skip.js"
      ].join("\n")
    );
    await writeFile(dir, "ignored.example.com/.headers", "{oops");
    await writeFile(
      dir,
      "ignored.example.com/index.html",
      "<html>ignored</html>"
    );
    await writeFile(dir, "app.example.com/index.html", "<!doctype html>");
    await writeFile(
      dir,
      "app.example.com/scripts/keep.skip.js",
      "console.log('keep');"
    );
    await writeFile(
      dir,
      "app.example.com/scripts/drop.skip.js",
      "console.log('drop');"
    );
    await writeFile(
      dir,
      "app.example.com/styles/.gitignore",
      ["*.css", "!keep.css"].join("\n")
    );
    await writeFile(dir, "app.example.com/styles/keep.css", "body{color:red}");
    await writeFile(dir, "app.example.com/styles/drop.css", "body{color:blue}");

    const result = await syncOverridesDirectory({ dir });

    expect(result.topOrigins).toEqual([
      "http://app.example.com",
      "https://app.example.com"
    ]);
    expect(result.imported).toHaveLength(6);
    expect(result.imported.map((entry) => entry.bodyPath)).toEqual([
      "app.example.com/index.html",
      "app.example.com/index.html",
      "app.example.com/scripts/keep.skip.js",
      "app.example.com/scripts/keep.skip.js",
      "app.example.com/styles/keep.css",
      "app.example.com/styles/keep.css"
    ]);
    expect(result.skipped).toEqual([]);

    const manifest = await readJson<{
      resourcesByPathname: Record<
        string,
        Array<{ projectionPath?: string | null }>
      >;
    }>(
      dir,
      ".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json"
    );
    expect(
      Object.values(manifest.resourcesByPathname)
        .flat()
        .map((entry) => entry.projectionPath)
    ).toEqual([
      "app.example.com/index.html",
      "app.example.com/scripts/keep.skip.js",
      "app.example.com/styles/keep.css"
    ]);

    await expect(
      fs.access(
        path.join(
          dir,
          ".wraithwalker/manifests/https__ignored.example.com/RESOURCE_MANIFEST.json"
        )
      )
    ).rejects.toThrow();
  });

  it("throws when the overrides path does not exist or is not a directory", async () => {
    const missingDir = path.join(await tmpdir(), "missing-overrides");
    await expect(syncOverridesDirectory({ dir: missingDir })).rejects.toThrow(
      `Overrides directory not found: ${path.resolve(missingDir)}`
    );

    const filePath = path.join(await tmpdir(), "not-a-directory.txt");
    await fs.writeFile(filePath, "hello", "utf8");
    await expect(syncOverridesDirectory({ dir: filePath })).rejects.toThrow(
      `Overrides path is not a directory: ${path.resolve(filePath)}`
    );
  });
});
