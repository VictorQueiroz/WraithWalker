import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

const mocks = vi.hoisted(() => ({
  startServer: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@wraithwalker/mcp-server/server", () => ({
  startServer: mocks.startServer
}));

async function loadRunner() {
  vi.resetModules();
  return import("../src/lib/runner.mts");
}

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-cli-runner-"));
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function createFixtureRoot() {
  return createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-cli-runner-"
  });
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cli runner", () => {
  it("prints help and usage", async () => {
    const { runCli } = await loadRunner();
    const capture = consoleCapture();

    const exitCode = await runCli([], {
      cwd: await tmpdir(),
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    });

    expect(exitCode).toBe(0);
    expect(capture.errors.join("\n")).toContain("Usage: wraithwalker <command>");
  });

  it("initializes a fixture root using only global config", async () => {
    const { runCli } = await loadRunner();
    const homeDir = await tmpdir();
    const targetDir = await tmpdir();
    const configPath = path.join(homeDir, ".config", "wraithwalker", "config.json");
    await writeJson(configPath, {
      theme: {
        overrides: {
          banner: {
            art: ["GLOBAL"],
            phrases: ["From global theme"]
          }
        }
      }
    });

    const capture = consoleCapture();
    const exitCode = await runCli(["init", targetDir], {
      cwd: await tmpdir(),
      env: {},
      homeDir,
      platform: "linux",
      isTTY: false
    });

    expect(exitCode).toBe(0);
    expect(await fs.readFile(path.join(targetDir, ".wraithwalker", "root.json"), "utf8")).toContain("rootId");
    expect(capture.logs.join("\n")).toContain("From global theme");
  });

  it("applies project config on root commands and ignores it for help", async () => {
    const { runCli } = await loadRunner();
    const homeDir = await tmpdir();
    const root = await createFixtureRoot();
    await root.writeCliConfig({
      theme: {
        overrides: {
          banner: {
            phrases: ["PROJECT ONLY"]
          },
          labelWidth: 20
        }
      }
    });

    const helpCapture = consoleCapture();
    const helpCode = await runCli(["--help"], {
      cwd: root.rootPath,
      env: {},
      homeDir,
      platform: "linux",
      isTTY: false
    });

    expect(helpCode).toBe(0);
    expect(helpCapture.logs.join("\n")).not.toContain("PROJECT ONLY");

    vi.restoreAllMocks();
    const statusCapture = consoleCapture();
    const statusCode = await runCli(["status"], {
      cwd: root.rootPath,
      env: {},
      homeDir,
      platform: "linux",
      isTTY: false
    });

    expect(statusCode).toBe(0);
    expect(statusCapture.logs).toContain(`Root${" ".repeat(17)}${root.rootPath}`);
  });

  it("reports invalid project config paths on root commands", async () => {
    const { runCli } = await loadRunner();
    const root = await createFixtureRoot();
    const projectConfigPath = root.resolve(".wraithwalker/cli.json");
    await fs.writeFile(projectConfigPath, "{oops", "utf8");
    const capture = consoleCapture();

    const exitCode = await runCli(["status"], {
      cwd: root.rootPath,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    });

    expect(exitCode).toBe(1);
    expect(capture.errors.join("\n")).toContain(projectConfigPath);
  });

  it("runs context and scenario commands with existing behavior", async () => {
    const { runCli } = await loadRunner();
    const root = await createFixtureRoot();

    await root.writeApiFixture({
      mode: "advanced",
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta: {
        status: 200,
        statusText: "OK",
        mimeType: "application/json",
        resourceType: "XHR",
        url: "https://api.example.com/users",
        method: "GET",
        capturedAt: "2026-04-03T00:00:00.000Z"
      },
      body: JSON.stringify({ users: [{ id: 1 }] })
    });
    await root.writeText("cdn.example.com/assets/app.js", "console.log('v1');");

    expect(await runCli(["context", "--editor", "cursor"], {
      cwd: root.rootPath,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    })).toBe(0);
    expect(await fs.readFile(root.resolve(".cursorrules"), "utf8")).toContain("WraithWalker");

    expect(await runCli(["scenarios", "save", "baseline"], {
      cwd: root.rootPath,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    })).toBe(0);
    expect(await runCli(["scenarios", "switch", "baseline"], {
      cwd: root.rootPath,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    })).toBe(0);

    const capture = consoleCapture();
    expect(await runCli(["scenarios", "diff", "baseline", "baseline"], {
      cwd: root.rootPath,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    })).toBe(0);
    expect(capture.logs.join("\n")).toContain("No differences found.");
  });

  it("reports scenarios usage errors through the runner", async () => {
    const { runCli } = await loadRunner();
    const root = await createFixtureRoot();
    const capture = consoleCapture();

    const exitCode = await runCli(["scenarios", "save"], {
      cwd: root.rootPath,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    });

    expect(exitCode).toBe(1);
    expect(capture.errors.join("\n")).toContain("Usage: wraithwalker scenarios save <name>");
  });

  it("starts the MCP server through the exported API", async () => {
    const { runCli } = await loadRunner();
    const root = await createFixtureRoot();

    const exitCode = await runCli(["serve"], {
      cwd: root.rootPath,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    });

    expect(exitCode).toBe(0);
    expect(mocks.startServer).toHaveBeenCalledWith(root.rootPath);
  });
});
