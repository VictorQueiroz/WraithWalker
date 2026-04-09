import { describe, expect, it } from "vitest";

import { createFixtureDescriptor } from "@wraithwalker/core/fixture-layout";

import { createFixtureRepository } from "../src/fixture-repository.mts";

describe("fixture repository adapter", () => {
  it("returns null when canonical metadata is missing for a simple-mode fixture", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/app.js",
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

    await expect(repository.read(descriptor)).resolves.toBeNull();
  });

  it("surfaces missing canonical bodies when metadata exists", async () => {
    const descriptor = await createFixtureDescriptor({
      topOrigin: "https://app.example.com",
      method: "GET",
      url: "https://cdn.example.com/assets/app.js",
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
        rootPath: "/tmp/unused",
        exists: async (relativePath: string) => relativePath === descriptor.bodyPath,
        stat: async () => null,
        readOptionalJson: async (relativePath: string) => {
          if (relativePath === descriptor.metaPath) {
            return {
              status: 200,
              statusText: "OK",
              headers: [{ name: "Content-Type", value: "application/javascript" }],
              mimeType: "application/javascript",
              resourceType: "Script",
              url: descriptor.requestUrl,
              method: descriptor.method,
              capturedAt: "2026-04-07T00:00:00.000Z",
              bodyEncoding: "utf8",
              bodySuggestedExtension: "js"
            };
          }

          return null;
        },
        readBodyAsBase64: async () => {
          throw new Error("readBodyAsBase64 should not be reached when the body stat is missing");
        }
      } as never
    });

    await expect(repository.read(descriptor)).rejects.toThrow(`Fixture body not found at ${descriptor.bodyPath}`);
  });
});
