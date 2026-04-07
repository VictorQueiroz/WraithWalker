import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startServer: vi.fn().mockResolvedValue(undefined),
  startHttpServer: vi.fn().mockResolvedValue({
    rootPath: "/tmp/fixtures",
    host: "127.0.0.1",
    port: 4319,
    baseUrl: "http://127.0.0.1:4319",
    trpcUrl: "http://127.0.0.1:4319/trpc",
    url: "http://127.0.0.1:4319/mcp",
    tools: ["list-origins"],
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
  return fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-cli-runner-more-"));
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cli runner coverage gaps", () => {
  it("reports unknown commands through themed output when color is forced", async () => {
    const { runCli, USAGE } = await loadRunner();
    const capture = consoleCapture();

    const exitCode = await runCli(["mystery"], {
      cwd: await tmpdir(),
      env: { FORCE_COLOR: "1" },
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    });

    expect(exitCode).toBe(1);
    expect(capture.errors.join("\n")).toContain("Unknown command: mystery");
    expect(capture.errors.join("\n")).toContain(USAGE);
    expect(capture.errors.join("\n")).toContain("\u001b[");
  });
});
