import { describe, expect, it } from "vitest";

import { classifyOffscreenMessage } from "../src/lib/offscreen-message.js";

describe("offscreen message classification", () => {
  it("ignores non-object values and non-offscreen targets", () => {
    expect(classifyOffscreenMessage(null)).toEqual({ kind: "ignore" });
    expect(classifyOffscreenMessage("fs.ensureRoot")).toEqual({
      kind: "ignore"
    });
    expect(classifyOffscreenMessage({ type: "fs.ensureRoot" })).toEqual({
      kind: "ignore"
    });
    expect(
      classifyOffscreenMessage({
        target: "background",
        type: "fs.ensureRoot"
      })
    ).toEqual({ kind: "ignore" });
  });

  it("classifies missing and unsupported offscreen message types as unknown", () => {
    expect(classifyOffscreenMessage({ target: "offscreen" })).toEqual({
      kind: "unknown",
      type: undefined
    });
    expect(
      classifyOffscreenMessage({
        target: "offscreen",
        type: "fs.unknown"
      })
    ).toEqual({
      kind: "unknown",
      type: "fs.unknown"
    });
  });

  it("classifies all supported offscreen message types as known", () => {
    const messages = [
      { target: "offscreen", type: "fs.ensureRoot" },
      { target: "offscreen", type: "fs.readConfiguredSiteConfigs" },
      { target: "offscreen", type: "fs.readEffectiveSiteConfigs" },
      {
        target: "offscreen",
        type: "fs.writeConfiguredSiteConfigs",
        payload: { siteConfigs: [] }
      },
      {
        target: "offscreen",
        type: "fs.hasFixture",
        payload: {
          descriptor: {
            bodyPath: "fixtures/a.body",
            requestPath: "fixtures/a.request.json",
            metaPath: "fixtures/a.response.json"
          }
        }
      },
      {
        target: "offscreen",
        type: "fs.readFixture",
        payload: {
          descriptor: {
            bodyPath: "fixtures/a.body",
            requestPath: "fixtures/a.request.json",
            metaPath: "fixtures/a.response.json"
          }
        }
      },
      {
        target: "offscreen",
        type: "fs.writeFixture",
        payload: {
          descriptor: {
            bodyPath: "fixtures/a.body",
            requestPath: "fixtures/a.request.json",
            metaPath: "fixtures/a.response.json"
          },
          request: {
            topOrigin: "https://app.example.com",
            url: "https://cdn.example.com/a.js",
            method: "GET",
            headers: [],
            body: "",
            bodyEncoding: "utf8",
            bodyHash: "",
            queryHash: "",
            capturedAt: "2026-04-03T00:00:00.000Z"
          },
          response: {
            body: "",
            bodyEncoding: "utf8",
            meta: {
              status: 200,
              statusText: "OK",
              headers: [],
              url: "https://cdn.example.com/a.js",
              method: "GET",
              capturedAt: "2026-04-03T00:00:00.000Z",
              bodyEncoding: "utf8"
            }
          }
        }
      },
      {
        target: "offscreen",
        type: "fs.generateContext",
        payload: {
          siteConfigs: [],
          editorId: "cursor"
        }
      }
    ] as const;

    for (const message of messages) {
      const classified = classifyOffscreenMessage(message);

      expect(classified.kind).toBe("known");
      if (classified.kind === "known") {
        expect(classified.message).toEqual(message);
      }
    }
  });
});
