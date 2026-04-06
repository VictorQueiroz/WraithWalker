import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import { importHarFile, parseHarArchive, type HarImportEvent } from "../src/har-import.mts";
import { createFixtureDescriptor } from "../src/fixture-layout.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

async function tmpdir(prefix = "wraithwalker-core-har-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeHarFile(payload: unknown): Promise<string> {
  const filePath = path.join(await tmpdir(), "capture.har");
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

function createHarEntry({
  startedDateTime,
  method = "GET",
  url,
  requestHeaders = [],
  postData,
  status = 200,
  statusText = "OK",
  responseHeaders = [],
  mimeType = "",
  text,
  encoding,
  timings = {}
}: {
  startedDateTime: string;
  method?: string;
  url: string;
  requestHeaders?: Array<{ name: string; value: string }>;
  postData?: unknown;
  status?: number;
  statusText?: string;
  responseHeaders?: Array<{ name: string; value: string }>;
  mimeType?: string;
  text?: string;
  encoding?: string;
  timings?: Record<string, number>;
}) {
  return {
    startedDateTime,
    time: 12,
    request: {
      method,
      url,
      headers: requestHeaders,
      postData
    },
    response: {
      status,
      statusText,
      headers: responseHeaders,
      content: {
        mimeType,
        ...(text === undefined ? {} : { text }),
        ...(encoding ? { encoding } : {})
      }
    },
    cache: {},
    timings: {
      blocked: 0,
      connect: 1,
      dns: 1,
      receive: 1,
      send: 1,
      wait: 1,
      ssl: -1,
      ...timings
    }
  };
}

describe("har import", () => {
  it("rejects invalid json, invalid har shape, and invalid entry shapes", () => {
    const validEntry = createHarEntry({
      startedDateTime: "2026-04-06T00:00:00.000Z",
      url: "https://app.example.com",
      mimeType: "text/html",
      text: "<html></html>"
    });

    expect(() => parseHarArchive("{oops")).toThrow("Failed to parse HAR JSON.");
    expect(() => parseHarArchive(JSON.stringify({ nope: true }))).toThrow("HAR file must contain a top-level log object.");
    expect(() => parseHarArchive(JSON.stringify({ log: {} }))).toThrow("HAR file must contain log.entries.");
    expect(() => parseHarArchive(JSON.stringify({ log: { entries: [null] } }))).toThrow("HAR entry 0 must be an object.");
    expect(() => parseHarArchive(JSON.stringify({
      log: { entries: [{ ...validEntry, startedDateTime: "oops" }] }
    }))).toThrow("HAR entry 0 is missing a valid startedDateTime.");
    expect(() => parseHarArchive(JSON.stringify({
      log: { entries: [{ ...validEntry, time: -1 }] }
    }))).toThrow("HAR entry 0 has an invalid time value.");
    expect(() => parseHarArchive(JSON.stringify({
      log: { entries: [{ ...validEntry, time: "12" }] }
    }))).not.toThrow();
    expect(() => parseHarArchive(JSON.stringify({
      log: { entries: [{ ...validEntry, request: undefined }] }
    }))).toThrow("HAR entry 0 is missing a request object.");
    expect(() => parseHarArchive(JSON.stringify({
      log: { entries: [{ ...validEntry, request: {} }] }
    }))).toThrow("HAR entry 0 request must include method and url strings.");
    expect(() => parseHarArchive(JSON.stringify({
      log: { entries: [{ ...validEntry, response: undefined }] }
    }))).toThrow("HAR entry 0 is missing a response object.");
    expect(() => parseHarArchive(JSON.stringify({
      log: { entries: [{ ...validEntry, response: {} }] }
    }))).toThrow("HAR entry 0 response must include status and statusText.");
    expect(() => parseHarArchive(JSON.stringify({
      log: {
        entries: [
          {
            ...validEntry,
            timings: {
              wait: "-1"
            }
          }
        ]
      }
    }))).not.toThrow();
    expect(() => parseHarArchive(JSON.stringify({
      log: {
        entries: [
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:00.000Z",
            url: "https://app.example.com",
            mimeType: "text/html",
            text: "<html></html>",
            timings: { blocked: -2 }
          })
        ]
      }
    }))).toThrow('Invalid HAR timing "blocked" for https://app.example.com. Timings must be numbers >= -1.');
  });

  it("fails when the top origin is ambiguous without an explicit override", async () => {
    const harPath = await writeHarFile({
      log: {
        entries: [
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:00.000Z",
            url: "https://app.example.com/",
            mimeType: "text/html",
            text: "<html>app</html>"
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:01.000Z",
            url: "https://admin.example.com/",
            mimeType: "text/html",
            text: "<html>admin</html>"
          })
        ]
      }
    });

    await expect(importHarFile({
      harPath,
      dir: await tmpdir()
    })).rejects.toThrow(
      "Unable to infer a single top origin from the HAR. Use --top-origin with one of: https://admin.example.com, https://app.example.com"
    );
  });

  it("infers the top origin from a single page title url when document origins are ambiguous", async () => {
    const harPath = await writeHarFile({
      log: {
        pages: [
          {
            id: "page_1",
            startedDateTime: "2026-04-06T00:00:00.000Z",
            title: "https://app.example.com/"
          }
        ],
        entries: [
          {
            ...createHarEntry({
              startedDateTime: "2026-04-06T00:00:00.000Z",
              url: "https://app.example.com/",
              mimeType: "text/html",
              text: "<html>app</html>"
            }),
            pageref: "page_1"
          },
          {
            ...createHarEntry({
              startedDateTime: "2026-04-06T00:00:01.000Z",
              url: "https://cdn.example.com/embed.html",
              mimeType: "text/html",
              text: "<html>embed</html>"
            }),
            pageref: "page_1"
          }
        ]
      }
    });

    const result = await importHarFile({
      harPath,
      dir: await tmpdir()
    });

    expect(result.topOrigin).toBe("https://app.example.com");
    expect(result.imported.map((entry) => entry.requestUrl)).toEqual([
      "https://app.example.com/",
      "https://cdn.example.com/embed.html"
    ]);
  });

  it("ignores blank and invalid page titles when inferring the top origin", async () => {
    const harPath = await writeHarFile({
      log: {
        pages: [
          {
            id: "page_1",
            startedDateTime: "2026-04-06T00:00:00.000Z",
            title: ""
          },
          {
            id: "page_2",
            startedDateTime: "2026-04-06T00:00:01.000Z",
            title: "not a url"
          },
          {
            id: "page_3",
            startedDateTime: "2026-04-06T00:00:02.000Z",
            title: "file:///tmp/index.html"
          }
        ],
        entries: [
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:00.000Z",
            url: "https://app.example.com/",
            mimeType: "text/html",
            text: "<html>app</html>"
          })
        ]
      }
    });

    const result = await importHarFile({
      harPath,
      dir: await tmpdir()
    });

    expect(result.topOrigin).toBe("https://app.example.com");
    expect(result.imported.map((entry) => entry.requestUrl)).toEqual(["https://app.example.com/"]);
  });

  it("imports sorted fixtures into a fresh simple-mode root, reports skips, and writes manifests", async () => {
    const harPath = await writeHarFile({
      log: {
        entries: [
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:03.000Z",
            method: "POST",
            url: "https://api.example.com/graphql",
            requestHeaders: [{ name: "Content-Type", value: "application/x-www-form-urlencoded" }],
            postData: {
              mimeType: "application/x-www-form-urlencoded",
              params: [
                { name: "query", value: "{viewer{id}}" },
                { name: "draft", value: "true" }
              ]
            },
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            mimeType: "application/json",
            text: '{"data":{"viewer":{"id":1}}}'
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:01.000Z",
            url: "https://app.example.com/",
            responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
            mimeType: "text/html",
            text: "<html>home</html>"
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:02.000Z",
            url: "https://cdn.example.com/assets/app.js?v=1",
            responseHeaders: [{ name: "Content-Type", value: "application/javascript" }],
            mimeType: "application/javascript",
            text: "console.log('asset');"
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:04.000Z",
            method: "PATCH",
            url: "https://api.example.com/users/1",
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            mimeType: "application/json",
            text: '{"ok":true}'
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:05.000Z",
            url: "https://cdn.example.com/assets/missing.js",
            responseHeaders: [{ name: "Content-Type", value: "application/javascript" }],
            mimeType: "application/javascript"
          })
        ]
      }
    });
    const dir = await tmpdir();
    const events: HarImportEvent[] = [];

    const result = await importHarFile({
      harPath,
      dir,
      onEvent(event) {
        events.push(event);
      }
    });

    expect(result.topOrigin).toBe("https://app.example.com");
    expect(result.imported.map((entry) => entry.requestUrl)).toEqual([
      "https://app.example.com/",
      "https://cdn.example.com/assets/app.js?v=1",
      "https://api.example.com/graphql"
    ]);
    expect(result.skipped).toEqual([
      {
        requestUrl: "https://api.example.com/users/1",
        method: "PATCH",
        reason: "Cannot reconstruct a stable request body for hashing"
      },
      {
        requestUrl: "https://cdn.example.com/assets/missing.js",
        method: "GET",
        reason: "Response body is missing from HAR content.text"
      }
    ]);

    const htmlDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://app.example.com/",
      siteMode: "simple",
      mimeType: "text/html",
      resourceType: "Document"
    });
    const scriptDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/app.js?v=1",
      siteMode: "simple",
      mimeType: "application/javascript",
      resourceType: "Script"
    });
    const apiDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/graphql",
      postData: "query=%7Bviewer%7Bid%7D%7D&draft=true",
      postDataEncoding: "utf8",
      siteMode: "simple",
      mimeType: "application/json",
      resourceType: "Fetch"
    });

    expect(await fs.readFile(path.join(dir, htmlDescriptor.bodyPath), "utf8")).toBe("<html>home</html>");
    expect(await fs.readFile(path.join(dir, scriptDescriptor.bodyPath), "utf8")).toBe("console.log('asset');");
    expect(await fs.readFile(path.join(dir, apiDescriptor.bodyPath), "utf8")).toBe('{"data":{"viewer":{"id":1}}}');

    const manifest = JSON.parse(await fs.readFile(path.join(dir, ".wraithwalker/simple/https__app.example.com/RESOURCE_MANIFEST.json"), "utf8"));
    expect(manifest.resourcesByPathname["/"]).toHaveLength(1);
    expect(manifest.resourcesByPathname["/assets/app.js"]).toHaveLength(1);

    expect(events[0]).toEqual({
      type: "scan-complete",
      totalEntries: 5,
      totalCandidates: 3,
      topOrigin: "https://app.example.com"
    });
    expect(events.filter((event) => event.type === "entry-skipped")).toHaveLength(2);
    expect(events.filter((event) => event.type === "entry-complete")).toHaveLength(3);
  });

  it("accepts an explicit top origin, imports binary bodies, and supports har files without pages", async () => {
    const binaryPayload = Buffer.from([1, 2, 3, 4]);
    const harPath = await writeHarFile({
      log: {
        entries: [
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:00.000Z",
            url: "https://assets.example.com/fonts/app.woff2",
            responseHeaders: [{ name: "Content-Type", value: "font/woff2" }],
            mimeType: "font/woff2",
            text: binaryPayload.toString("base64"),
            encoding: "base64"
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:01.000Z",
            method: "POST",
            url: "https://api.example.com/login",
            requestHeaders: [{ name: "Content-Type", value: "application/json" }],
            postData: {
              mimeType: "application/json",
              text: '{"email":"a@example.com"}'
            },
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            mimeType: "application/json",
            text: '{"ok":true}'
          })
        ]
      }
    });
    const dir = await tmpdir();

    const result = await importHarFile({
      harPath,
      dir,
      topOrigin: "https://app.example.com"
    });

    expect(result.topOrigin).toBe("https://app.example.com");

    const fontDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://assets.example.com/fonts/app.woff2",
      siteMode: "simple",
      mimeType: "font/woff2",
      resourceType: "Font"
    });

    expect(await fs.readFile(path.join(dir, fontDescriptor.bodyPath))).toEqual(binaryPayload);
  });

  it("falls back to a single request origin when there is no unique document origin", async () => {
    const harPath = await writeHarFile({
      log: {
        entries: [
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:00.000Z",
            method: "POST",
            url: "https://api.example.com/orders",
            requestHeaders: [{ name: "Content-Type", value: "application/json" }],
            postData: {
              mimeType: "application/json",
              text: '{"sku":"A1"}'
            },
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            mimeType: "application/json",
            text: '{"ok":true}'
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:01.000Z",
            method: "POST",
            url: "chrome-extension://abcdef/background",
            requestHeaders: [{ name: "Content-Type", value: "application/json" }],
            postData: {
              mimeType: "application/json",
              text: '{"skip":true}'
            },
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            mimeType: "application/json",
            text: '{"ok":false}'
          })
        ]
      }
    });

    const result = await importHarFile({
      harPath,
      dir: await tmpdir()
    });

    expect(result.topOrigin).toBe("https://api.example.com");
  });

  it("infers mime types from headers, records resource types, and skips invalid or unsupported urls", async () => {
    const harPath = await writeHarFile({
      log: {
        entries: [
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:00.000Z",
            url: "https://cdn.example.com/styles/theme",
            responseHeaders: [{ name: "Content-Type", value: "text/css; charset=utf-8" }],
            text: "body{}"
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:01.000Z",
            url: "https://cdn.example.com/logo",
            responseHeaders: [{ name: "Content-Type", value: "image/png" }],
            text: "png-body"
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:02.000Z",
            url: "https://cdn.example.com/font",
            responseHeaders: [{ name: "Content-Type", value: "font/woff2" }],
            text: "font-body"
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:03.000Z",
            url: "https://cdn.example.com/video",
            responseHeaders: [{ name: "Content-Type", value: "video/mp4" }],
            text: "video-body"
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:04.000Z",
            url: "https://cdn.example.com/blob",
            responseHeaders: [{ name: "Content-Type", value: "application/octet-stream" }],
            text: "blob-body"
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:04.500Z",
            url: "https://cdn.example.com/no-headers",
            responseHeaders: {} as never,
            text: "headerless-body"
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:05.000Z",
            method: "POST",
            url: "https://api.example.com/orders",
            requestHeaders: [{ name: "Content-Type", value: "application/json" }],
            postData: {
              mimeType: "application/json",
              text: '{"sku":"A1"}'
            },
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            text: '{"ok":true}'
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:06.000Z",
            url: "not a valid url",
            responseHeaders: [{ name: "Content-Type", value: "text/plain" }],
            text: "nope"
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:07.000Z",
            url: "chrome-extension://abcdef/background",
            responseHeaders: [{ name: "Content-Type", value: "application/javascript" }],
            text: "ignored"
          })
        ]
      }
    });
    const dir = await tmpdir();

    const result = await importHarFile({
      harPath,
      dir,
      topOrigin: "https://app.example.com"
    });

    const cssDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/styles/theme",
      siteMode: "simple",
      mimeType: "text/css",
      resourceType: "Stylesheet"
    });
    const imageDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/logo",
      siteMode: "simple",
      mimeType: "image/png",
      resourceType: "Image"
    });
    const fontDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/font",
      siteMode: "simple",
      mimeType: "font/woff2",
      resourceType: "Font"
    });
    const mediaDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/video",
      siteMode: "simple",
      mimeType: "video/mp4",
      resourceType: "Media"
    });
    const otherDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/blob",
      siteMode: "simple",
      mimeType: "application/octet-stream",
      resourceType: "Other"
    });
    const headerlessDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/no-headers",
      siteMode: "simple",
      mimeType: "",
      resourceType: "Other"
    });
    const fetchDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/orders",
      postData: '{"sku":"A1"}',
      siteMode: "simple",
      mimeType: "application/json",
      resourceType: "Fetch"
    });

    expect(JSON.parse(await fs.readFile(path.join(dir, cssDescriptor.metaPath), "utf8")).resourceType).toBe("Stylesheet");
    expect(JSON.parse(await fs.readFile(path.join(dir, imageDescriptor.metaPath), "utf8")).resourceType).toBe("Image");
    expect(JSON.parse(await fs.readFile(path.join(dir, fontDescriptor.metaPath), "utf8")).resourceType).toBe("Font");
    expect(JSON.parse(await fs.readFile(path.join(dir, mediaDescriptor.metaPath), "utf8")).resourceType).toBe("Media");
    expect(JSON.parse(await fs.readFile(path.join(dir, otherDescriptor.metaPath), "utf8")).resourceType).toBe("Other");
    expect(JSON.parse(await fs.readFile(path.join(dir, headerlessDescriptor.metaPath), "utf8")).mimeType).toBe("");
    expect(JSON.parse(await fs.readFile(path.join(dir, fetchDescriptor.metaPath), "utf8")).resourceType).toBe("Fetch");
    expect(result.skipped).toEqual([
      {
        requestUrl: "not a valid url",
        method: "GET",
        reason: "Invalid request URL"
      },
      {
        requestUrl: "chrome-extension://abcdef/background",
        method: "GET",
        reason: "Unsupported request protocol"
      }
    ]);
  });

  it("reconstructs form bodies, skips unstable post bodies, and rejects extra metadata inside the sentinel folder", async () => {
    const harPath = await writeHarFile({
      log: {
        entries: [
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:00.000Z",
            url: "https://app.example.com/",
            mimeType: "text/html",
            text: "<html>home</html>"
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:01.000Z",
            method: "POST",
            url: "https://api.example.com/search",
            requestHeaders: [{ name: "Content-Type", value: "application/x-www-form-urlencoded" }],
            postData: {
              mimeType: "application/x-www-form-urlencoded",
              params: [{ name: "query" }]
            },
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            mimeType: "application/json",
            text: '{"ok":true}'
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:02.000Z",
            method: "POST",
            url: "https://api.example.com/invalid-form",
            requestHeaders: [{ name: "Content-Type", value: "application/x-www-form-urlencoded" }],
            postData: {
              mimeType: "application/x-www-form-urlencoded",
              params: [{}]
            },
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            mimeType: "application/json",
            text: '{"ok":false}'
          }),
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:03.000Z",
            method: "POST",
            url: "https://api.example.com/raw",
            requestHeaders: [{ name: "Content-Type", value: "text/plain" }],
            postData: {
              mimeType: "text/plain"
            },
            responseHeaders: [{ name: "Content-Type", value: "text/plain" }],
            mimeType: "text/plain",
            text: "raw"
          })
        ]
      }
    });
    const dir = await tmpdir();

    const result = await importHarFile({
      harPath,
      dir
    });

    const formDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/search",
      postData: "query=",
      siteMode: "simple",
      mimeType: "application/json",
      resourceType: "Fetch"
    });
    const formRequest = JSON.parse(await fs.readFile(path.join(dir, formDescriptor.requestPath), "utf8"));

    expect(formRequest.body).toBe("query=");
    expect(result.skipped).toEqual([
      {
        requestUrl: "https://api.example.com/invalid-form",
        method: "POST",
        reason: "Cannot reconstruct a stable request body for hashing"
      },
      {
        requestUrl: "https://api.example.com/raw",
        method: "POST",
        reason: "Cannot reconstruct a stable request body for hashing"
      }
    ]);

    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-import-sentinel-"
    });
    await root.writeText(".wraithwalker/notes.txt", "busy");

    await expect(importHarFile({
      harPath,
      dir: root.rootPath
    })).rejects.toThrow(
      "Target directory must be empty or contain only a fresh .wraithwalker/root.json sentinel."
    );
  });

  it("refuses to import into a populated fixture root", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-import-populated-"
    });
    await root.writeText("cdn.example.com/app.js", "console.log('existing');");

    const harPath = await writeHarFile({
      log: {
        entries: [
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:00.000Z",
            url: "https://app.example.com/",
            mimeType: "text/html",
            text: "<html>home</html>"
          })
        ]
      }
    });

    await expect(importHarFile({
      harPath,
      dir: root.rootPath
    })).rejects.toThrow(
      "Target directory must be empty or contain only a fresh .wraithwalker/root.json sentinel."
    );
  });
});
