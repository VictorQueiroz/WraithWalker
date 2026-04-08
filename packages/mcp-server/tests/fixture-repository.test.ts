import { describe, expect, it } from "vitest";

import { createFixtureDescriptor } from "@wraithwalker/core/fixture-layout";

import { createFixtureRepository } from "../src/fixture-repository.mts";

describe("fixture repository adapter", () => {
  it("throws a clear error when a body path disappears before read", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/app.js",
      siteMode: "simple",
      resourceType: "Script",
      mimeType: "application/javascript"
    });
    const repository = createFixtureRepository({
      rootPath: "/tmp/unused",
      sentinel: {
        rootId: "root-mcp-server",
        schemaVersion: 1,
        createdAt: "2026-04-07T00:00:00.000Z"
      },
      rootFs: {
        exists: async () => true,
        stat: async () => null,
        readOptionalJson: async () => null
      } as never
    });

    await expect(repository.read(descriptor)).rejects.toThrow(
      `Fixture body not found at ${descriptor.bodyPath}`
    );
  });
});
