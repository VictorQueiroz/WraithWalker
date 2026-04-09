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

    expect(await runCli(["config", "add", 'site."https://app.example.com"'], {
      cwd,
      env: {},
      homeDir,
      platform: "linux",
      isTTY: false
    })).toBe(0);

    await expect(fs.readFile(path.join(defaultRoot, ".wraithwalker", "root.json"), "utf8")).resolves.toContain("\"rootId\"");
    await expect(fs.readFile(path.join(defaultRoot, PROJECT_CONFIG_RELATIVE_PATH), "utf8")).resolves.toContain(
      "\"https://app.example.com\""
    );
  });

  it("adds and updates nearest-root explicit site config from a nested cwd", async () => {
    const { runCli } = await loadRunner();
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-cli-project-config-"
    });
    const nestedCwd = root.resolve("deep/nested");
    await fs.mkdir(nestedCwd, { recursive: true });

    expect(await runCli(["config", "add", 'site."https://app.example.com"'], {
      cwd: nestedCwd,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    })).toBe(0);

    expect(await runCli(["config", "add", 'site."https://app.example.com".dumpAllowlistPatterns', "\\.svg$"], {
      cwd: nestedCwd,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    })).toBe(0);

    await expect(root.readJson(PROJECT_CONFIG_RELATIVE_PATH)).resolves.toEqual({
      schemaVersion: 1,
      sites: [expect.objectContaining({
        origin: "https://app.example.com",
        dumpAllowlistPatterns: [...DEFAULT_DUMP_ALLOWLIST_PATTERNS, "\\.svg$"]
      })]
    });
  });

  it("gets, lists, and unsets explicit config values", async () => {
    const { runCli } = await loadRunner();
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-cli-project-config-"
    });
    await root.writeProjectConfig({
      schemaVersion: 1,
      sites: [{
        origin: "https://app.example.com",
        createdAt: "2026-04-08T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.json$"]
      }]
    });

    let capture = consoleCapture();
    expect(await runCli(["config", "get", 'site."https://app.example.com".dumpAllowlistPatterns'], {
      cwd: root.rootPath,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    })).toBe(0);
    expect(capture.logs.join("\n")).toContain('["\\\\.json$"]');

    vi.restoreAllMocks();
    capture = consoleCapture();
    expect(await runCli(["config", "list"], {
      cwd: root.rootPath,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    })).toBe(0);
    expect(capture.logs.join("\n")).toContain('site."https://app.example.com".dumpAllowlistPatterns=["\\\\.json$"]');

    expect(await runCli(["config", "unset", 'site."https://app.example.com".dumpAllowlistPatterns'], {
      cwd: root.rootPath,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    })).toBe(0);

    await expect(root.readJson(PROJECT_CONFIG_RELATIVE_PATH)).resolves.toEqual({
      schemaVersion: 1,
      sites: [expect.objectContaining({
        origin: "https://app.example.com",
        dumpAllowlistPatterns: DEFAULT_DUMP_ALLOWLIST_PATTERNS
      })]
    });
  });

  it("reports missing keys and invalid values as command errors", async () => {
    const { runCli } = await loadRunner();
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-cli-project-config-"
    });
    const capture = consoleCapture();

    expect(await runCli(["config", "get", 'site."https://missing.example.com".dumpAllowlistPatterns'], {
      cwd: root.rootPath,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    })).toBe(1);
    expect(capture.errors.join("\n")).toContain("No config entry found");

    vi.restoreAllMocks();
    const invalidCapture = consoleCapture();
    expect(await runCli(["config", "add", 'site."https://app.example.com".dumpAllowlistPatterns', "["], {
      cwd: root.rootPath,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    })).toBe(1);
    expect(invalidCapture.errors.join("\n")).toContain("Invalid regular expression");
  });
});
