import { describe, expect, it, vi } from "vitest";

import {
  createProjectConfigStore,
  PROJECT_CONFIG_RELATIVE_PATH,
  PROJECT_CONFIG_SCHEMA_VERSION
} from "../src/project-config.mts";
import { CAPTURE_HTTP_DIR, MANIFESTS_DIR } from "../src/constants.mts";

type DirectoryEntry = {
  name: string;
  kind: "file" | "directory";
};

function createStoreHarness({
  rawConfig = null,
  manifestEntries = [],
  httpEntries = [],
  manifestError = null,
  httpError = null
}: {
  rawConfig?: unknown;
  manifestEntries?: DirectoryEntry[];
  httpEntries?: DirectoryEntry[];
  manifestError?: Error | null;
  httpError?: Error | null;
} = {}) {
  let currentRawConfig = rawConfig;
  const readOptionalJson = vi.fn(async () => currentRawConfig);
  const writeJson = vi.fn(
    async (_root: string, _path: string, value: unknown) => {
      currentRawConfig = value;
    }
  );
  const listDirectory = vi.fn(
    async (_root: string, relativePath: string): Promise<DirectoryEntry[]> => {
      if (relativePath === MANIFESTS_DIR) {
        if (manifestError) {
          throw manifestError;
        }

        return manifestEntries;
      }

      if (relativePath === CAPTURE_HTTP_DIR) {
        if (httpError) {
          throw httpError;
        }

        return httpEntries;
      }

      throw new Error(`Unexpected directory listing for ${relativePath}`);
    }
  );

  return {
    store: createProjectConfigStore({
      root: "root-under-test",
      rootPathLabel: "/tmp/root-under-test",
      storage: {
        readOptionalJson,
        writeJson,
        listDirectory
      }
    }),
    readOptionalJson,
    writeJson,
    listDirectory,
    getCurrentRawConfig() {
      return currentRawConfig;
    }
  };
}

describe("project config store", () => {
  it("rejects invalid config shapes through direct store validation", async () => {
    const cases = [
      {
        name: "config root must be an object",
        rawConfig: [],
        message: "config root must be an object."
      },
      {
        name: "unsupported top-level keys",
        rawConfig: {
          schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
          sites: [],
          mystery: true
        },
        message: 'unsupported top-level key "mystery".'
      },
      {
        name: "sites must be an array",
        rawConfig: {
          schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
          sites: "bad"
        },
        message: "sites must be an array."
      },
      {
        name: "site entries must be objects",
        rawConfig: {
          schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
          sites: ["bad"]
        },
        message: "sites[0] must be an object."
      },
      {
        name: "site origins must be present",
        rawConfig: {
          schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
          sites: [{}]
        },
        message: "sites[0].origin must be a non-empty string."
      },
      {
        name: "site origins must not be blank",
        rawConfig: {
          schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
          sites: [{ origin: "   " }]
        },
        message: "sites[0].origin must be a non-empty string."
      }
    ] as const;

    for (const testCase of cases) {
      const { store } = createStoreHarness({
        rawConfig: testCase.rawConfig
      });

      await expect(store.readProjectConfig(), testCase.name).rejects.toThrow(
        `${PROJECT_CONFIG_RELATIVE_PATH}: ${testCase.message}`
      );
    }
  });

  it("derives effective sites from directory listings while ignoring files and falling back for non-matching keys", async () => {
    const { store } = createStoreHarness({
      manifestEntries: [
        { name: "not-a-key", kind: "directory" },
        { name: "ignored.json", kind: "file" }
      ],
      httpEntries: [
        { name: "https__api.example.com", kind: "directory" },
        { name: "ignored.http", kind: "file" }
      ]
    });

    await expect(store.readEffectiveSiteConfigs()).resolves.toEqual([
      {
        origin: "https://api.example.com",
        createdAt: "1970-01-01T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.m?(js|ts)x?$", "\\.css$", "\\.wasm$"]
      },
      {
        origin: "https://not-a-key",
        createdAt: "1970-01-01T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.m?(js|ts)x?$", "\\.css$", "\\.wasm$"]
      }
    ]);
  });

  it("tolerates a missing manifests tree when HTTP captures exist", async () => {
    const { store } = createStoreHarness({
      manifestError: new Error("missing manifests"),
      httpEntries: [{ name: "https__api.example.com", kind: "directory" }]
    });

    await expect(store.readEffectiveSiteConfigs()).resolves.toEqual([
      {
        origin: "https://api.example.com",
        createdAt: "1970-01-01T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.m?(js|ts)x?$", "\\.css$", "\\.wasm$"]
      }
    ]);
  });

  it("tolerates a missing HTTP capture tree when manifests exist", async () => {
    const { store } = createStoreHarness({
      manifestEntries: [{ name: "https__app.example.com", kind: "directory" }],
      httpError: new Error("missing http captures")
    });

    await expect(store.readEffectiveSiteConfigs()).resolves.toEqual([
      {
        origin: "https://app.example.com",
        createdAt: "1970-01-01T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.m?(js|ts)x?$", "\\.css$", "\\.wasm$"]
      }
    ]);
  });

  it("defaults omitted sites to an empty array and returns null for missing configured origins", async () => {
    const { store } = createStoreHarness({
      rawConfig: {
        schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION
      }
    });

    await expect(store.readProjectConfig()).resolves.toEqual({
      schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
      sites: []
    });
    await expect(
      store.resolveConfiguredSite("https://missing.example.com")
    ).resolves.toBeNull();
  });

  it("writes canonicalized project config through the direct store surface", async () => {
    const { store, writeJson, getCurrentRawConfig } = createStoreHarness();

    await expect(
      store.writeProjectConfig({
        schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
        sites: [
          {
            origin: "app.example.com",
            createdAt: "2026-04-09T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$"]
          },
          {
            origin: "https://app.example.com",
            createdAt: "2026-04-08T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.json$", "\\.js$"]
          }
        ]
      })
    ).resolves.toEqual({
      schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
      sites: [
        {
          origin: "https://app.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$", "\\.json$"]
        }
      ]
    });

    expect(writeJson).toHaveBeenCalledWith(
      "root-under-test",
      PROJECT_CONFIG_RELATIVE_PATH,
      {
        schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
        sites: [
          {
            origin: "https://app.example.com",
            createdAt: "2026-04-08T00:00:00.000Z",
            dumpAllowlistPatterns: ["\\.js$", "\\.json$"]
          }
        ]
      }
    );
    expect(getCurrentRawConfig()).toEqual({
      schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
      sites: [
        {
          origin: "https://app.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$", "\\.json$"]
        }
      ]
    });
  });
});
