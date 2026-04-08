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
  timings?: Record<string, number | string | null>;
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
          {
            ...validEntry,
            timings: {
              wait: null
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

  it("rejects har files with no entries to import", async () => {
    const harPath = await writeHarFile({
      log: {
        entries: []
      }
    });

    await expect(importHarFile({
      harPath,
      dir: await tmpdir()
    })).rejects.toThrow("Unable to infer a top origin from an empty HAR entry set.");
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
            })
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
              url: "https://app.example.com/dashboard",
              mimeType: "text/html",
              text: "<html>dashboard</html>"
            }),
            pageref: "page_2"
          },
          {
            ...createHarEntry({
              startedDateTime: "2026-04-06T00:00:02.000Z",
              url: "https://app.example.com/settings",
              mimeType: "text/html",
              text: "<html>settings</html>"
            }),
            pageref: "page_3"
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
      "https://app.example.com/dashboard",
      "https://app.example.com/settings"
    ]);
  });

  it("falls back to ungrouped entry inference when pages are present but no page origin resolves", async () => {
    const harPath = await writeHarFile({
      log: {
        pages: [
          {
            id: "page_1",
            startedDateTime: "2026-04-06T00:00:00.000Z",
            title: "Dashboard"
          }
        ],
        entries: [
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:00.000Z",
            method: "POST",
            url: "https://api.example.com/orders",
            postData: {
              mimeType: "application/json",
              text: "{\"sku\":\"A1\"}"
            },
            mimeType: "application/json",
            text: "{\"ok\":true}"
          })
        ]
      }
    });

    const result = await importHarFile({
      harPath,
      dir: await tmpdir()
    });

    expect(result.topOrigin).toBe("https://api.example.com");
    expect(result.topOrigins).toEqual(["https://api.example.com"]);
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
    expect(result.topOrigins).toEqual(["https://app.example.com"]);
    expect(result.imported.map((entry) => entry.requestUrl)).toEqual([
      "https://app.example.com/",
      "https://cdn.example.com/assets/app.js?v=1",
      "https://api.example.com/graphql"
    ]);
    expect(result.skipped).toEqual([
      {
        requestUrl: "https://api.example.com/users/1",
        method: "PATCH",
        reason: "Cannot reconstruct a stable request body for hashing",
        topOrigin: "https://app.example.com"
      },
      {
        requestUrl: "https://cdn.example.com/assets/missing.js",
        method: "GET",
        reason: "Response body is missing from HAR content.text",
        topOrigin: "https://app.example.com"
      }
    ]);

    const htmlDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://app.example.com/",
      mimeType: "text/html",
      resourceType: "Document"
    });
    const scriptDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/app.js?v=1",
      mimeType: "application/javascript",
      resourceType: "Script"
    });
    const apiDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/graphql",
      postData: "query=%7Bviewer%7Bid%7D%7D&draft=true",
      postDataEncoding: "utf8",
      mimeType: "application/json",
      resourceType: "Fetch"
    });

    expect(await fs.readFile(path.join(dir, htmlDescriptor.bodyPath), "utf8")).toBe("<html>home</html>");
    expect(await fs.readFile(path.join(dir, scriptDescriptor.bodyPath), "utf8")).toBe("console.log('asset');");
    expect(await fs.readFile(path.join(dir, apiDescriptor.bodyPath), "utf8")).toBe('{"data":{"viewer":{"id":1}}}');

    const manifest = JSON.parse(await fs.readFile(path.join(dir, ".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json"), "utf8"));
    expect(manifest.resourcesByPathname["/"]).toHaveLength(1);
    expect(manifest.resourcesByPathname["/assets/app.js"]).toHaveLength(1);

    expect(events[0]).toEqual({
      type: "scan-complete",
      totalEntries: 5,
      totalCandidates: 3,
      topOrigin: "https://app.example.com",
      topOrigins: ["https://app.example.com"]
    });
    expect(events.filter((event) => event.type === "entry-skipped")).toHaveLength(2);
    expect(events.filter((event) => event.type === "entry-complete")).toHaveLength(3);
  });

  it("imports entries whose HAR timings use null for optional timing fields", async () => {
    const harPath = await writeHarFile({
      log: {
        entries: [
          createHarEntry({
            startedDateTime: "2026-04-06T00:00:00.000Z",
            url: "https://assets.example.com/polyfills.js",
            responseHeaders: [{ name: "Content-Type", value: "application/javascript" }],
            mimeType: "application/javascript",
            text: "console.log('polyfills');",
            timings: {
              blocked: 22.349999999278225,
              wait: null,
              receive: 0.0010000003385357559
            }
          })
        ]
      }
    });

    const result = await importHarFile({
      harPath,
      dir: await tmpdir(),
      topOrigin: "https://app.example.com"
    });

    expect(result.topOrigins).toEqual(["https://app.example.com"]);
    expect(result.imported).toEqual([
      expect.objectContaining({
        requestUrl: "https://assets.example.com/polyfills.js",
        topOrigin: "https://app.example.com"
      })
    ]);
  });

  it("allows duplicate asset entries when only metadata differs", async () => {
    const harPath = await writeHarFile({
      log: {
        pages: [
          {
            id: "page_app",
            startedDateTime: "2026-04-06T00:00:00.000Z",
            title: "https://app.example.com/"
          }
        ],
        entries: [
          {
            ...createHarEntry({
              startedDateTime: "2026-04-06T00:00:00.500Z",
              url: "https://cdn.example.com/assets/shared.js",
              requestHeaders: [{ name: "Referer", value: "https://app.example.com/" }],
              responseHeaders: [{ name: "Date", value: "Thu, 02 Apr 2026 19:06:16 GMT" }],
              mimeType: "application/javascript",
              text: "console.log('shared');"
            }),
            pageref: "page_app"
          },
          {
            ...createHarEntry({
              startedDateTime: "2026-04-06T00:00:01.500Z",
              url: "https://cdn.example.com/assets/shared.js",
              requestHeaders: [{ name: "Referer", value: "https://app.example.com/dashboard" }],
              responseHeaders: [{ name: "Date", value: "Thu, 02 Apr 2026 19:06:17 GMT" }],
              mimeType: "application/javascript",
              text: "console.log('shared');"
            }),
            pageref: "page_app"
          }
        ]
      }
    });
    const dir = await tmpdir();

    await expect(importHarFile({
      harPath,
      dir
    })).resolves.toEqual(
      expect.objectContaining({
        topOrigins: ["https://app.example.com"]
      })
    );
  });

  it("keeps the latest same-origin asset body when repeated GET entries change over time", async () => {
    const harPath = await writeHarFile({
      log: {
        pages: [
          {
            id: "page_app",
            startedDateTime: "2026-04-06T00:00:00.000Z",
            title: "https://app.example.com/"
          }
        ],
        entries: [
          {
            ...createHarEntry({
              startedDateTime: "2026-04-06T00:00:00.500Z",
              url: "https://cdn.example.com/assets/live.js",
              mimeType: "application/javascript",
              text: "console.log('first');"
            }),
            pageref: "page_app"
          },
          {
            ...createHarEntry({
              startedDateTime: "2026-04-06T00:00:01.500Z",
              url: "https://cdn.example.com/assets/live.js",
              mimeType: "application/javascript",
              text: "console.log('second');"
            }),
            pageref: "page_app"
          }
        ]
      }
    });
    const dir = await tmpdir();

    await importHarFile({
      harPath,
      dir
    });

    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/live.js",
      mimeType: "application/javascript",
      resourceType: "Script"
    });

    expect(await fs.readFile(path.join(dir, descriptor.bodyPath), "utf8")).toBe("console.log('second');");
  });

  it("stores simple-mode GET json endpoints as API fixtures to avoid file-directory collisions", async () => {
    const harPath = await writeHarFile({
      log: {
        pages: [
          {
            id: "page_app",
            startedDateTime: "2026-04-06T00:00:00.000Z",
            title: "https://app.example.com/"
          }
        ],
        entries: [
          {
            ...createHarEntry({
              startedDateTime: "2026-04-06T00:00:00.500Z",
              url: "https://api.example.com/agents",
              mimeType: "application/json",
              text: '{"items":[1]}'
            }),
            pageref: "page_app"
          },
          {
            ...createHarEntry({
              startedDateTime: "2026-04-06T00:00:01.500Z",
              url: "https://api.example.com/agents/all",
              mimeType: "application/json",
              text: '{"items":[1,2]}'
            }),
            pageref: "page_app"
          }
        ]
      }
    });
    const dir = await tmpdir();

    await importHarFile({
      harPath,
      dir
    });

    const parentDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://api.example.com/agents",
      mimeType: "application/json",
      resourceType: "Other"
    });
    const childDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://api.example.com/agents/all",
      mimeType: "application/json",
      resourceType: "Other"
    });

    expect(parentDescriptor.storageMode).toBe("api");
    expect(childDescriptor.storageMode).toBe("api");
    expect(await fs.readFile(path.join(dir, parentDescriptor.bodyPath), "utf8")).toBe('{"items":[1]}');
    expect(await fs.readFile(path.join(dir, childDescriptor.bodyPath), "utf8")).toBe('{"items":[1,2]}');
  });

  it("accepts an explicit top origin, imports binary bodies, and supports har files without pages", async () => {
    const binaryPayload = Buffer.from([0xff, 0xfe, 0xfd, 0x00]);
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
    expect(result.topOrigins).toEqual(["https://app.example.com"]);

    const fontDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://assets.example.com/fonts/app.woff2",
      mimeType: "font/woff2",
      resourceType: "Font"
    });

    expect(await fs.readFile(path.join(dir, fontDescriptor.bodyPath))).toEqual(binaryPayload);
    expect(await fs.readFile(path.join(dir, fontDescriptor.projectionPath!))).toEqual(binaryPayload);
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
    expect(result.topOrigins).toEqual(["https://api.example.com"]);
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
      mimeType: "text/css",
      resourceType: "Stylesheet"
    });
    const imageDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/logo",
      mimeType: "image/png",
      resourceType: "Image"
    });
    const fontDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/font",
      mimeType: "font/woff2",
      resourceType: "Font"
    });
    const mediaDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/video",
      mimeType: "video/mp4",
      resourceType: "Media"
    });
    const otherDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/blob",
      mimeType: "application/octet-stream",
      resourceType: "Other"
    });
    const headerlessDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/no-headers",
      mimeType: "",
      resourceType: "Other"
    });
    const fetchDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "POST",
      url: "https://api.example.com/orders",
      postData: '{"sku":"A1"}',
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
        reason: "Invalid request URL",
        topOrigin: "https://app.example.com"
      },
      {
        requestUrl: "chrome-extension://abcdef/background",
        method: "GET",
        reason: "Unsupported request protocol",
        topOrigin: "https://app.example.com"
      }
    ]);
  });

  it("reconstructs form bodies, skips unstable post bodies, and allows additive imports into initialized roots", async () => {
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
      mimeType: "application/json",
      resourceType: "Fetch"
    });
    const formRequest = JSON.parse(await fs.readFile(path.join(dir, formDescriptor.requestPath), "utf8"));

    expect(formRequest.body).toBe("query=");
    expect(result.skipped).toEqual([
      {
        requestUrl: "https://api.example.com/invalid-form",
        method: "POST",
        reason: "Cannot reconstruct a stable request body for hashing",
        topOrigin: "https://app.example.com"
      },
      {
        requestUrl: "https://api.example.com/raw",
        method: "POST",
        reason: "Cannot reconstruct a stable request body for hashing",
        topOrigin: "https://app.example.com"
      }
    ]);

    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-import-sentinel-"
    });
    await root.writeText(".wraithwalker/notes.txt", "busy");

    const additiveResult = await importHarFile({
      harPath,
      dir: root.rootPath
    });

    expect(additiveResult.topOrigins).toEqual(["https://app.example.com"]);
    expect(await fs.readFile(root.resolve(".wraithwalker/notes.txt"), "utf8")).toBe("busy");
  });

  it("imports multiple top origins from page groups and reuses shared visible assets when content matches", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-import-multi-origin-"
    });

    const harPath = await writeHarFile({
      log: {
        pages: [
          {
            id: "page_app",
            startedDateTime: "2026-04-06T00:00:00.000Z",
            title: "https://app.example.com/"
          },
          {
            id: "page_admin",
            startedDateTime: "2026-04-06T00:00:01.000Z",
            title: "https://admin.example.com/"
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
            pageref: "page_app"
          },
          {
            ...createHarEntry({
              startedDateTime: "2026-04-06T00:00:00.500Z",
              url: "https://cdn.example.com/assets/shared.js",
              mimeType: "application/javascript",
              text: "console.log('shared');"
            }),
            pageref: "page_app"
          },
          {
            ...createHarEntry({
              startedDateTime: "2026-04-06T00:00:01.000Z",
              url: "https://admin.example.com/",
              mimeType: "text/html",
              text: "<html>admin</html>"
            }),
            pageref: "page_admin"
          },
          {
            ...createHarEntry({
              startedDateTime: "2026-04-06T00:00:01.500Z",
              url: "https://cdn.example.com/assets/shared.js",
              mimeType: "application/javascript",
              text: "console.log('shared');"
            }),
            pageref: "page_admin"
          }
        ]
      }
    });

    const result = await importHarFile({
      harPath,
      dir: root.rootPath
    });

    expect(result.topOrigin).toBe("https://admin.example.com");
    expect(result.topOrigins).toEqual([
      "https://admin.example.com",
      "https://app.example.com"
    ]);
    expect(result.imported).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requestUrl: "https://app.example.com/",
        topOrigin: "https://app.example.com"
      }),
      expect.objectContaining({
        requestUrl: "https://admin.example.com/",
        topOrigin: "https://admin.example.com"
      })
    ]));

    const appHtmlDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://app.example.com/",
      mimeType: "text/html",
      resourceType: "Document"
    });
    const adminHtmlDescriptor = await createFixtureDescriptor({
      topOrigin: "https://admin.example.com",
      method: "GET",
      url: "https://admin.example.com/",
      mimeType: "text/html",
      resourceType: "Document"
    });
    const sharedAppDescriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/shared.js",
      mimeType: "application/javascript",
      resourceType: "Script"
    });
    const sharedAdminDescriptor = await createFixtureDescriptor({
      topOrigin: "https://admin.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/shared.js",
      mimeType: "application/javascript",
      resourceType: "Script"
    });

    expect(sharedAppDescriptor.bodyPath).not.toBe(sharedAdminDescriptor.bodyPath);
    expect(sharedAppDescriptor.projectionPath).toBe(sharedAdminDescriptor.projectionPath);
    expect(await fs.readFile(path.join(root.rootPath, appHtmlDescriptor.bodyPath), "utf8")).toBe("<html>app</html>");
    expect(await fs.readFile(path.join(root.rootPath, adminHtmlDescriptor.bodyPath), "utf8")).toBe("<html>admin</html>");
    expect(await fs.readFile(path.join(root.rootPath, sharedAppDescriptor.bodyPath), "utf8")).toBe("console.log('shared');");
    expect(await fs.readFile(path.join(root.rootPath, sharedAdminDescriptor.bodyPath), "utf8")).toBe("console.log('shared');");
    expect(await fs.readFile(path.join(root.rootPath, sharedAppDescriptor.projectionPath!), "utf8")).toBe("console.log(\"shared\");");
    expect(await fs.readFile(path.join(root.rootPath, ".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json"), "utf8")).toContain('"topOrigin": "https://app.example.com"');
    expect(await fs.readFile(path.join(root.rootPath, ".wraithwalker/manifests/https__admin.example.com/RESOURCE_MANIFEST.json"), "utf8")).toContain('"topOrigin": "https://admin.example.com"');
  });

  it("allows additive imports for different top origins in the same root", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-import-additive-"
    });

    const appHarPath = await writeHarFile({
      log: {
        pages: [{
          id: "page_app",
          startedDateTime: "2026-04-06T00:00:00.000Z",
          title: "https://app.example.com/"
        }],
        entries: [{
          ...createHarEntry({
            startedDateTime: "2026-04-06T00:00:00.000Z",
            url: "https://app.example.com/",
            mimeType: "text/html",
            text: "<html>app</html>"
          }),
          pageref: "page_app"
        }]
      }
    });
    const adminHarPath = await writeHarFile({
      log: {
        pages: [{
          id: "page_admin",
          startedDateTime: "2026-04-06T00:00:01.000Z",
          title: "https://admin.example.com/"
        }],
        entries: [{
          ...createHarEntry({
            startedDateTime: "2026-04-06T00:00:01.000Z",
            url: "https://admin.example.com/",
            mimeType: "text/html",
            text: "<html>admin</html>"
          }),
          pageref: "page_admin"
        }]
      }
    });

    await importHarFile({
      harPath: appHarPath,
      dir: root.rootPath
    });
    const result = await importHarFile({
      harPath: adminHarPath,
      dir: root.rootPath
    });

    expect(result.topOrigins).toEqual(["https://admin.example.com"]);
    expect(await root.readJson(".wraithwalker/manifests/https__app.example.com/RESOURCE_MANIFEST.json")).toEqual(
      expect.objectContaining({ topOrigin: "https://app.example.com" })
    );
    expect(await root.readJson(".wraithwalker/manifests/https__admin.example.com/RESOURCE_MANIFEST.json")).toEqual(
      expect.objectContaining({ topOrigin: "https://admin.example.com" })
    );
  });

  it("rejects conflicting writes within a single multi-origin import and across existing files", async () => {
    const sameRunConflictHarPath = await writeHarFile({
      log: {
        pages: [
          {
            id: "page_app",
            startedDateTime: "2026-04-06T00:00:00.000Z",
            title: "https://app.example.com/"
          },
          {
            id: "page_admin",
            startedDateTime: "2026-04-06T00:00:01.000Z",
            title: "https://admin.example.com/"
          }
        ],
        entries: [
          {
            ...createHarEntry({
              startedDateTime: "2026-04-06T00:00:00.500Z",
              url: "https://cdn.example.com/assets/shared.js",
              mimeType: "application/javascript",
              text: "console.log('app');"
            }),
            pageref: "page_app"
          },
          {
            ...createHarEntry({
              startedDateTime: "2026-04-06T00:00:01.500Z",
              url: "https://cdn.example.com/assets/shared.js",
              mimeType: "application/javascript",
              text: "console.log('admin');"
            }),
            pageref: "page_admin"
          }
        ]
      }
    });

    await expect(importHarFile({
      harPath: sameRunConflictHarPath,
      dir: await tmpdir()
    })).rejects.toThrow(
      "Cannot import HAR because multiple entries would write different content to cdn.example.com/assets/shared.js."
    );

    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-import-conflict-"
    });
    const firstHarPath = await writeHarFile({
      log: {
        pages: [{
          id: "page_app",
          startedDateTime: "2026-04-06T00:00:00.000Z",
          title: "https://app.example.com/"
        }],
        entries: [{
          ...createHarEntry({
            startedDateTime: "2026-04-06T00:00:00.000Z",
            url: "https://cdn.example.com/assets/shared.js",
            mimeType: "application/javascript",
            text: "console.log('first');"
          }),
          pageref: "page_app"
        }]
      }
    });
    const secondHarPath = await writeHarFile({
      log: {
        pages: [{
          id: "page_admin",
          startedDateTime: "2026-04-06T00:00:01.000Z",
          title: "https://admin.example.com/"
        }],
        entries: [{
          ...createHarEntry({
            startedDateTime: "2026-04-06T00:00:01.000Z",
            url: "https://cdn.example.com/assets/shared.js",
            mimeType: "application/javascript",
            text: "console.log('second');"
          }),
          pageref: "page_admin"
        }]
      }
    });

    await importHarFile({
      harPath: firstHarPath,
      dir: root.rootPath
    });

    await expect(importHarFile({
      harPath: secondHarPath,
      dir: root.rootPath
    })).rejects.toThrow(
      "Cannot import HAR because cdn.example.com/assets/shared.js already exists with different content."
    );

    const directoryConflictRoot = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-import-directory-conflict-"
    });
    await fs.mkdir(path.join(directoryConflictRoot.rootPath, "cdn.example.com/assets/shared.js"), { recursive: true });

    await expect(importHarFile({
      harPath: firstHarPath,
      dir: directoryConflictRoot.rootPath
    })).rejects.toThrow(
      "Cannot import HAR because cdn.example.com/assets/shared.js already exists as a directory."
    );
  });

  it("overwrites existing metadata files when the fixture body matches", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-import-metadata-overwrite-"
    });
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/app.js",
      mimeType: "application/javascript",
      resourceType: "Script"
    });

    await root.writeJson(descriptor.requestPath, {
      topOrigin: "https://app.example.com",
      url: "https://cdn.example.com/assets/app.js",
      method: "GET"
    });
    await root.writeText(descriptor.metaPath, "{not-json");

    const harPath = await writeHarFile({
      log: {
        pages: [{
          id: "page_app",
          startedDateTime: "2026-04-06T00:00:00.000Z",
          title: "https://app.example.com/"
        }],
        entries: [{
          ...createHarEntry({
            startedDateTime: "2026-04-06T00:00:00.000Z",
            url: "https://cdn.example.com/assets/app.js",
            mimeType: "application/javascript",
            text: "console.log('app');"
          }),
          pageref: "page_app"
        }]
      }
    });

    const result = await importHarFile({
      harPath,
      dir: root.rootPath
    });

    expect(result.topOrigins).toEqual(["https://app.example.com"]);
    expect(await root.readJson(descriptor.requestPath)).toEqual(
      expect.objectContaining({
        topOrigin: "https://app.example.com",
        url: "https://cdn.example.com/assets/app.js",
        capturedAt: "2026-04-06T00:00:00.000Z"
      })
    );
    expect(await root.readJson(descriptor.metaPath)).toEqual(
      expect.objectContaining({
        url: "https://cdn.example.com/assets/app.js",
        capturedAt: "2026-04-06T00:00:00.000Z"
      })
    );
  });
});
