import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  return fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-cli-serve-command-"));
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
  mocks.startHttpServer.mockReset();
  mocks.startHttpServer.mockResolvedValue({
    rootPath: "/tmp/fixtures",
    host: "127.0.0.1",
    port: 4319,
    baseUrl: "http://127.0.0.1:4319",
    trpcUrl: "http://127.0.0.1:4319/trpc",
    url: "http://127.0.0.1:4319/mcp",
    tools: ["list-sites"],
    close: vi.fn().mockResolvedValue(undefined)
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("serve command", () => {
  it("validates missing flag values, invalid ports, and malformed argument shapes", async () => {
    const { runCli } = await loadRunner();
    const cases: Array<{ argv: string[]; message: string }> = [
      {
        argv: ["serve", "--host"],
        message:
          "Usage: wraithwalker serve [dir] [--http] [--host <host>] [--port <port>]"
      },
      {
        argv: ["serve", "--port"],
        message:
          "Usage: wraithwalker serve [dir] [--http] [--host <host>] [--port <port>]"
      },
      {
        argv: ["serve", "--port", "0"],
        message: "Invalid port: 0. Expected an integer between 1 and 65535."
      },
      {
        argv: ["serve", "--bogus"],
        message:
          "Usage: wraithwalker serve [dir] [--http] [--host <host>] [--port <port>]"
      },
      {
        argv: ["serve", "fixtures-a", "fixtures-b"],
        message:
          "Usage: wraithwalker serve [dir] [--http] [--host <host>] [--port <port>]"
      }
    ];

    for (const { argv, message } of cases) {
      const capture = consoleCapture();
      expect(
        await runCli(argv, {
          cwd: await tmpdir(),
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

  it("starts the local server and renders the combined endpoints", async () => {
    const { runCli } = await loadRunner();
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-cli-serve-command-"
    });
    mocks.startHttpServer.mockResolvedValue({
      rootPath: root.rootPath,
      host: "0.0.0.0",
      port: 9876,
      baseUrl: "http://0.0.0.0:9876",
      trpcUrl: "http://0.0.0.0:9876/trpc",
      url: "http://0.0.0.0:9876/mcp",
      tools: ["list-sites", "read-file"],
      close: vi.fn().mockResolvedValue(undefined)
    });
    const capture = consoleCapture();

    expect(
      await runCli(
        [
          "serve",
          "--http",
          "--host",
          "0.0.0.0",
          "--port",
          "9876",
          root.rootPath
        ],
        {
          cwd: await tmpdir(),
          env: {},
          homeDir: await tmpdir(),
          platform: "linux",
          isTTY: false
        }
      )
    ).toBe(0);

    expect(mocks.startHttpServer).toHaveBeenCalledWith(root.rootPath, {
      host: "0.0.0.0",
      port: 9876
    });

    const output = capture.logs.join("\n");
    expect(output).toContain("WraithWalker Server Ready");
    expect(output).toContain("http://0.0.0.0:9876/trpc");
    expect(output).toContain("http://0.0.0.0:9876/mcp");
    expect(output).toContain("list-sites");
    expect(output).toContain("read-file");
    expect(output).toContain("Press Ctrl+C to close the local server.");
  });
});
