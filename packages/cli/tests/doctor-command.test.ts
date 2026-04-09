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
  return fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-cli-doctor-command-"));
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

describe("doctor command", () => {
  it("rejects unsupported flags and duplicate positional directories", async () => {
    const { runCli } = await loadRunner();
    const cases = [
      ["doctor", "--bogus"],
      ["doctor", "fixtures-a", "fixtures-b"]
    ];

    for (const argv of cases) {
      const capture = consoleCapture();
      expect(await runCli(argv, {
        cwd: await tmpdir(),
        env: {},
        homeDir: await tmpdir(),
        platform: "linux",
        isTTY: false
      })).toBe(1);
      expect(capture.errors.join("\n")).toContain("Usage: wraithwalker doctor [dir] [--json]");
      vi.restoreAllMocks();
    }
  });

  it("reports missing project config, origins, captures, and context files for a bare root", async () => {
    const { runCli } = await loadRunner();
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-cli-doctor-command-"
    });
    const capture = consoleCapture();

    expect(await runCli(["doctor", "--json"], {
      cwd: root.rootPath,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    })).toBe(0);

    const output = capture.logs.join("\n");
    expect(output).toContain('"rootFound": true');
    expect(output).toContain('"projectConfigExists": false');
    expect(output).toContain("Project config is missing.");
    expect(output).toContain("No enabled origins are configured.");
    expect(output).toContain("No captured fixtures were found.");
    expect(output).toContain("No editor context files are present.");
  });

  it("renders a clean report when captures, assets, context, and scenarios are present", async () => {
    const { runCli } = await loadRunner();
    const root = await createWraithwalkerFixtureRoot({
      prefix: "wraithwalker-cli-doctor-command-"
    });
    await root.writeProjectConfig({
      schemaVersion: 1,
      sites: [{
        origin: "https://app.example.com",
        createdAt: "2026-04-09T00:00:00.000Z",
        dumpAllowlistPatterns: ["\\.js$"]
      }]
    });
    await root.writeText("CLAUDE.md", "# WraithWalker Fixture Context");
    await root.ensureScenario("smoke");
    await root.writeManifest({
      topOrigin: "https://app.example.com",
      manifest: {
        schemaVersion: 1,
        topOrigin: "https://app.example.com",
        topOriginKey: "https__app.example.com",
        generatedAt: "2026-04-09T00:00:00.000Z",
        resourcesByPathname: {
          "/app.js": [{
            requestUrl: "https://cdn.example.com/app.js",
            requestOrigin: "https://cdn.example.com",
            pathname: "/app.js",
            search: "",
            bodyPath: "cdn.example.com/app.js",
            requestPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/app.js.__request.json",
            metaPath: ".wraithwalker/captures/assets/https__app.example.com/cdn.example.com/app.js.__response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-09T00:00:00.000Z"
          }]
        }
      }
    });
    const capture = consoleCapture();

    expect(await runCli(["doctor"], {
      cwd: root.rootPath,
      env: {},
      homeDir: await tmpdir(),
      platform: "linux",
      isTTY: false
    })).toBe(0);

    const output = capture.logs.join("\n");
    expect(output).toContain("WraithWalker Doctor");
    expect(output).toContain("Scenarios");
    expect(output).toContain("smoke");
    expect(output).toContain("Assets");
    expect(output).toContain("No obvious problems found.");
  });
});
