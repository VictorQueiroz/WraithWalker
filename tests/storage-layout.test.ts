import { describe, expect, it, vi } from "vitest";

import { createStorageLayoutResolver } from "../src/lib/storage-layout.js";
import type { FixtureDescriptor } from "../src/lib/types.js";

describe("storage layout resolver", () => {
  it("passes the site mode into descriptor creation", async () => {
    const createFixtureDescriptor = vi.fn(async (payload): Promise<FixtureDescriptor> => ({
      requestUrl: payload.url,
      siteMode: payload.siteMode
    } as FixtureDescriptor));
    const resolver = createStorageLayoutResolver({ createFixtureDescriptor });

    const descriptor = await resolver.describeRequest(
      {
        topOrigin: "https://app.example.com",
        method: "GET",
        url: "https://cdn.example.com/app.js",
        headers: [],
        body: "",
        bodyEncoding: "utf8",
        resourceType: "Script",
        mimeType: "application/javascript"
      },
      { mode: "simple" }
    );

    expect(createFixtureDescriptor).toHaveBeenCalledWith(expect.objectContaining({
      topOrigin: "https://app.example.com",
      siteMode: "simple",
      resourceType: "Script"
    }));
    expect(descriptor).toEqual({
      requestUrl: "https://cdn.example.com/app.js",
      siteMode: "simple"
    });
  });
});
