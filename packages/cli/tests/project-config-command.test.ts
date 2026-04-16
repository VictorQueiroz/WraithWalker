import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PROJECT_CONFIG_RELATIVE_PATH } from "@wraithwalker/core/project-config";
import { DEFAULT_DUMP_ALLOWLIST_PATTERNS } from "@wraithwalker/core/site-config";

import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

const mocks = vi.hoisted(() => ({
  startServer: vi.fn().mockResolvedValue(undefined),
  startHttpServer: vi.fn().mockResolvedValue({
    rootPath: "/tmp/fixtures",
    host: "127.0.0.1",
    port: 4319,
    baseUrl: "http://127.0.0.1:4319",
    trpcUrl: "http://127.0.0.1:4319/trpc",
    url: "http://127.0.0.1:4319/mcp",
    tools: ["list-sites"],
    close: vi.fn().mockResolvedValue(undefined)
  })
}));

vi.mock("@wraithwalker/mcp-server/server", () => ({
  DEFAULT_HTTP_HOST: "127.0.0.1",
  DEFAULT_HTTP_PORT: 4319,
  startServer: mocks.startServer,
  startHttpServer: mocks.startHttpServer
}));

async function loadRunner() {
  vi.resetModules();
  return import("../src/lib/runner.mts");
}

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-cli-project-config-"));
}

function consoleCapture() {
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
    logs.push(String(value ?? ""));
  });
  vi.spyOn(console, "error").mockImplementation((value?: unknown) => {
    errors.push(String(value ?? ""));
  });
  return { logs, errors };
}

beforeEach(() => {
  mocks.startServer.mockClear();
  mocks.startHttpServer.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("config command", () => {
  it("falls back to the default WraithWalker root and bootstraps it when no local root exists", async () => {
    const { runCli } = await loadRunner();
    const cwd = await tmpdir();
    const homeDir = await tmpdir();
    const defaultRoot = path.join(homeDir, ".local", "share", "wraithwalker");

    expect(
      await runCli(["config", "add", 'site."https://app.example.com"'], {
        cwd,
        env: {},
        homeDir,
        platform: "linux",
        isTTY: false
      })
    ).toBe(0);

    await expect(
      fs.readFile(path.join(defaultRoot, ".wraithwalker", "root.json"), "utf8")
    ).resolves.toContain('"rootId"');
    await expect(
      fs.readFile(path.join(defaultRoot, PROJECT_CONFIG_RELATIVE_PATH), "utf8")
    ).resolves.toContain('"https://app.example.com"');
  });

  it("adds and updates nearest-root explicit site config from a nested cwd", async () => {
    const { runCli } = await loadRunner();
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-cli-project-config-"
    });
    const nestedCwd = root.resolve("deep/nested");
    await fs.mkdir(nestedCwd, { recursive: true });

    expect(
      await runCli(["config", "add", 'site."https://app.example.com"'], {
        cwd: nestedCwd,
        env: {},
        homeDir: await tmpdir(),
        platform: "linux",
        isTTY: false
      })
    ).toBe(0);

    expect(
      await runCli(
        [
          "config",
          "add",
          'site."https://app.example.com".dumpAllowlistPatterns',
          "\\.svg$"
        ],
        {
          cwd: nestedCwd,
          env: {},
          homeDir: await tmpdir(),
          platform: "linux",
          isTTY: false
        }
      )
    ).toBe(0);

    await expect(root.readJson(PROJECT_CONFIG_RELATIVE_PATH)).resolves.toEqual({
      schemaVersion: 1,
      sites: [
        expect.objectContaining({
          origin: "https://app.example.com",
          dumpAllowlistPatterns: [...DEFAULT_DUMP_ALLOWLIST_PATTERNS, "\\.svg$"]
        })
      ]
    });
  });

  it("gets, lists, and unsets explicit config values", async () => {
    const { runCli } = await loadRunner();
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-cli-project-config-"
    });
    await root.writeProjectConfig({
      schemaVersion: 1,
      sites: [
        {
          origin: "https://app.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.json$"]
        }
      ]
    });

    let capture = consoleCapture();
    expect(
      await runCli(
        [
          "config",
          "get",
          'site."https://app.example.com".dumpAllowlistPatterns'
        ],
        {
          cwd: root.rootPath,
          env: {},
          homeDir: await tmpdir(),
          platform: "linux",
          isTTY: false
        }
      )
    ).toBe(0);
    expect(capture.logs.join("\n")).toContain('["\\\\.json$"]');

    vi.restoreAllMocks();
    capture = consoleCapture();
    expect(
      await runCli(["config", "list"], {
        cwd: root.rootPath,
        env: {},
        homeDir: await tmpdir(),
        platform: "linux",
        isTTY: false
      })
    ).toBe(0);
    expect(capture.logs.join("\n")).toContain(
      'site."https://app.example.com".dumpAllowlistPatterns=["\\\\.json$"]'
    );

    expect(
      await runCli(
        [
          "config",
          "unset",
          'site."https://app.example.com".dumpAllowlistPatterns'
        ],
        {
          cwd: root.rootPath,
          env: {},
          homeDir: await tmpdir(),
          platform: "linux",
          isTTY: false
        }
      )
    ).toBe(0);

    await expect(root.readJson(PROJECT_CONFIG_RELATIVE_PATH)).resolves.toEqual({
      schemaVersion: 1,
      sites: [
        expect.objectContaining({
          origin: "https://app.example.com",
          dumpAllowlistPatterns: DEFAULT_DUMP_ALLOWLIST_PATTERNS
        })
      ]
    });
  });

  it("manages whole-site objects and full site collections", async () => {
    const { runCli } = await loadRunner();
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-cli-project-config-"
    });

    expect(
      await runCli(
        [
          "config",
          "set",
          "sites",
          JSON.stringify([
            {
              origin: "alpha.example.com",
              createdAt: "2026-04-09T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.js$"]
            },
            {
              origin: "https://alpha.example.com",
              createdAt: "2026-04-08T00:00:00.000Z",
              dumpAllowlistPatterns: ["\\.json$"]
            }
          ])
        ],
        {
          cwd: root.rootPath,
          env: {},
          homeDir: await tmpdir(),
          platform: "linux",
          isTTY: false
        }
      )
    ).toBe(0);

    await expect(root.readJson(PROJECT_CONFIG_RELATIVE_PATH)).resolves.toEqual({
      schemaVersion: 1,
      sites: [
        {
          origin: "https://alpha.example.com",
          createdAt: "2026-04-08T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$", "\\.json$"]
        }
      ]
    });

    let capture = consoleCapture();
    expect(
      await runCli(["config", "get", "sites"], {
        cwd: root.rootPath,
        env: {},
        homeDir: await tmpdir(),
        platform: "linux",
        isTTY: false
      })
    ).toBe(0);
    expect(capture.logs.join("\n")).toContain("https://alpha.example.com");
    expect(capture.logs.join("\n")).not.toContain('"alpha.example.com"');

    vi.restoreAllMocks();
    expect(
      await runCli(
        [
          "config",
          "set",
          'site."https://beta.example.com"',
          JSON.stringify({ dumpAllowlistPatterns: ["\\.svg$"] })
        ],
        {
          cwd: root.rootPath,
          env: {},
          homeDir: await tmpdir(),
          platform: "linux",
          isTTY: false
        }
      )
    ).toBe(0);

    capture = consoleCapture();
    expect(
      await runCli(["config", "get", 'site."https://beta.example.com"'], {
        cwd: root.rootPath,
        env: {},
        homeDir: await tmpdir(),
        platform: "linux",
        isTTY: false
      })
    ).toBe(0);
    expect(capture.logs.join("\n")).toContain("https://beta.example.com");
    expect(capture.logs.join("\n")).toContain("\\.svg$");

    expect(
      await runCli(["config", "unset", 'site."https://beta.example.com"'], {
        cwd: root.rootPath,
        env: {},
        homeDir: await tmpdir(),
        platform: "linux",
        isTTY: false
      })
    ).toBe(0);

    await expect(root.readJson(PROJECT_CONFIG_RELATIVE_PATH)).resolves.toEqual({
      schemaVersion: 1,
      sites: [
        expect.objectContaining({
          origin: "https://alpha.example.com",
          dumpAllowlistPatterns: ["\\.js$", "\\.json$"]
        })
      ]
    });

    expect(
      await runCli(["config", "unset", "sites"], {
        cwd: root.rootPath,
        env: {},
        homeDir: await tmpdir(),
        platform: "linux",
        isTTY: false
      })
    ).toBe(0);

    await expect(root.readJson(PROJECT_CONFIG_RELATIVE_PATH)).resolves.toEqual({
      schemaVersion: 1,
      sites: []
    });
  });

  it("lists and gets one canonical site when raw config contains duplicate normalized origins", async () => {
    const { runCli } = await loadRunner();
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-cli-project-config-"
    });
    await root.writeProjectConfig({
      schemaVersion: 1,
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
    });

    let capture = consoleCapture();
    expect(
      await runCli(["config", "list"], {
        cwd: root.rootPath,
        env: {},
        homeDir: await tmpdir(),
        platform: "linux",
        isTTY: false
      })
    ).toBe(0);
    const listOutput = capture.logs.join("\n");
    expect(
      listOutput.match(
        /site\."https:\/\/app\.example\.com"\.dumpAllowlistPatterns=/g
      )
    ).toHaveLength(1);
    expect(listOutput).toContain(
      'site."https://app.example.com".dumpAllowlistPatterns=["\\\\.js$","\\\\.json$"]'
    );

    vi.restoreAllMocks();
    capture = consoleCapture();
    expect(
      await runCli(["config", "get", 'site."https://app.example.com"'], {
        cwd: root.rootPath,
        env: {},
        homeDir: await tmpdir(),
        platform: "linux",
        isTTY: false
      })
    ).toBe(0);
    const getOutput = capture.logs.join("\n");
    expect(getOutput).toContain('"origin":"https://app.example.com"');
    expect(getOutput).toContain('"createdAt":"2026-04-08T00:00:00.000Z"');
    expect(getOutput).toContain('"dumpAllowlistPatterns":[');
    expect(getOutput).toContain("\\\\.js$");
    expect(getOutput).toContain("\\\\.json$");
  });

  it("reports missing keys and invalid values as command errors", async () => {
    const { runCli } = await loadRunner();
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-cli-project-config-"
    });
    const capture = consoleCapture();

    expect(
      await runCli(
        [
          "config",
          "get",
          'site."https://missing.example.com".dumpAllowlistPatterns'
        ],
        {
          cwd: root.rootPath,
          env: {},
          homeDir: await tmpdir(),
          platform: "linux",
          isTTY: false
        }
      )
    ).toBe(1);
    expect(capture.errors.join("\n")).toContain("No config entry found");

    vi.restoreAllMocks();
    const invalidCapture = consoleCapture();
    expect(
      await runCli(
        [
          "config",
          "add",
          'site."https://app.example.com".dumpAllowlistPatterns',
          "["
        ],
        {
          cwd: root.rootPath,
          env: {},
          homeDir: await tmpdir(),
          platform: "linux",
          isTTY: false
        }
      )
    ).toBe(1);
    expect(invalidCapture.errors.join("\n")).toContain(
      "Invalid regular expression"
    );
  });

  it("covers usage and parsing failures across config branches", async () => {
    const { runCli } = await loadRunner();
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-cli-project-config-"
    });
    const cases: Array<{ argv: string[]; message: string; cwd?: string }> = [
      {
        argv: ["config", "get"],
        message: "Usage: wraithwalker config get <key>"
      },
      {
        argv: ["config", "set"],
        message: "Usage: wraithwalker config set <key> <value>"
      },
      {
        argv: ["config", "add"],
        message: "Usage: wraithwalker config add <key> [value]"
      },
      {
        argv: ["config", "unset"],
        message: "Usage: wraithwalker config unset <key>"
      },
      {
        argv: ["config", "mystery"],
        message: "Usage: wraithwalker config {list|get|set|add|unset}"
      },
      {
        argv: ["config", "add", "sites"],
        message:
          "Use `wraithwalker config set sites '<json-array>'` to replace all sites.",
        cwd: root.rootPath
      },
      {
        argv: ["config", "get", "unsupported"],
        message: "Unsupported config key: unsupported",
        cwd: root.rootPath
      },
      {
        argv: ["config", "set", "sites", "{"],
        message: "sites must be a JSON array",
        cwd: root.rootPath
      },
      {
        argv: ["config", "set", 'site."https://app.example.com"', "["],
        message: 'site "https://app.example.com" must be a JSON object',
        cwd: root.rootPath
      },
      {
        argv: ["config", "unset", 'site."https://missing.example.com"'],
        message: "No config entry found for https://missing.example.com",
        cwd: root.rootPath
      }
    ];

    for (const { argv, message, cwd } of cases) {
      const capture = consoleCapture();
      expect(
        await runCli(argv, {
          cwd: cwd ?? (await tmpdir()),
          env: {},
          homeDir: await tmpdir(),
          platform: "linux",
          isTTY: false
        })
      ).toBe(1);
      expect(capture.errors.join("\n")).toContain(message);
      vi.restoreAllMocks();
    }
  });
});
