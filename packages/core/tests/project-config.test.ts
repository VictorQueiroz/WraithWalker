import { describe, expect, it } from "vitest";

import { readSiteConfigs } from "../src/fixtures.mts";
import {
  readConfiguredSiteConfigs,
  readProjectConfig,
  resolveConfiguredSite,
  writeConfiguredSiteConfigs
} from "../src/project-config.mts";
import { PROJECT_CONFIG_RELATIVE_PATH, PROJECT_CONFIG_SCHEMA_VERSION } from "../src/constants.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

describe("project config helpers", () => {
  it("returns an empty config when the root config file is missing", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-project-config-"
    });

    await expect(readProjectConfig(root.rootPath)).resolves.toEqual({
      schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
      sites: []
    });
    await expect(readConfiguredSiteConfigs(root.rootPath)).resolves.toEqual([]);
  });

  it("writes and resolves configured sites from .wraithwalker/config.json", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-project-config-"
    });

    await writeConfiguredSiteConfigs(root.rootPath, [{
      origin: "app.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.svg$"]
    } as any]);

    await expect(root.readJson(PROJECT_CONFIG_RELATIVE_PATH)).resolves.toEqual({
      schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
      sites: [{
        origin: "https://app.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.svg$"]
      }]
    });

    await expect(resolveConfiguredSite(root.rootPath, "app.example.com")).resolves.toEqual({
      origin: "https://app.example.com",
      createdAt: "2026-04-08T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.svg$"]
    });
  });

  it("merges explicit config with discovered origins when reading effective site configs", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-project-config-"
    });

    await root.writeProjectConfig({
      schemaVersion: 1,
      sites: [{
        origin: "https://app.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.svg$"]
      }]
    });
    await root.ensureOrigin({ topOrigin: "https://app.example.com" });
    await root.ensureOrigin({ topOrigin: "https://admin.example.com" });

    await expect(readSiteConfigs(root.rootPath)).resolves.toEqual([
      expect.objectContaining({
        origin: "https://admin.example.com",
        dumpAllowlistPatterns: ["\\.m?(js|ts)x?$", "\\.css$", "\\.wasm$"]
      }),
      expect.objectContaining({
        origin: "https://app.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.svg$"]
      })
    ]);
  });

  it("rejects invalid project config shapes with the file path", async () => {
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-core-project-config-"
    });
    await root.writeProjectConfig({
      schemaVersion: 99,
      sites: "bad"
    });

    await expect(readProjectConfig(root.rootPath)).rejects.toThrow(PROJECT_CONFIG_RELATIVE_PATH);
    await expect(readProjectConfig(root.rootPath)).rejects.toThrow("unsupported schemaVersion");
  });
});
