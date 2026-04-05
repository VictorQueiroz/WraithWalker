import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import { createRoot } from "@wraithwalker/core/root";

import {
  getGlobalConfigPath,
  loadGlobalCliConfig,
  loadProjectCliConfig,
  mergeCliConfigs,
  resolveCliConfig
} from "../src/lib/cli-config.mts";
import { command as scenariosCommand } from "../src/commands/scenarios.mts";
import { command as statusCommand } from "../src/commands/status.mts";

const SCENARIOS_DIR = path.join(".wraithwalker", "scenarios");
const STATIC_RESOURCE_MANIFEST_FILE = "RESOURCE_MANIFEST.json";

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-cli-coverage-"));
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function createOutputRecorder() {
  const calls = {
    banner: 0,
    success: [] as string[],
    error: [] as string[],
    warn: [] as string[],
    heading: [] as string[],
    keyValue: [] as Array<[string, string | number]>,
    info: [] as string[],
    listItem: [] as string[],
    block: [] as string[],
    usage: [] as string[]
  };

  return {
    calls,
    output: {
      banner() {
        calls.banner += 1;
      },
      success(message: string) {
        calls.success.push(message);
      },
      error(message: string) {
        calls.error.push(message);
      },
      warn(message: string) {
        calls.warn.push(message);
      },
      heading(message: string) {
        calls.heading.push(message);
      },
      keyValue(key: string, value: string | number) {
        calls.keyValue.push([key, value]);
      },
      info(message: string) {
        calls.info.push(message);
      },
      listItem(item: string) {
        calls.listItem.push(item);
      },
      block(content: string) {
        calls.block.push(content);
      },
      usage(message: string) {
        calls.usage.push(message);
      }
    }
  };
}

describe("cli config coverage gaps", () => {
  it("returns empty configs when global and project files are missing", async () => {
    const homeDir = await tmpdir();
    const rootPath = await tmpdir();
    await createRoot(rootPath);

    await expect(loadGlobalCliConfig({ platform: "linux", env: {}, homeDir })).resolves.toEqual({});
    await expect(loadProjectCliConfig(rootPath)).resolves.toEqual({});
  });

  it("resolves platform-specific config paths", async () => {
    const homeDir = await tmpdir();

    expect(getGlobalConfigPath({ platform: "darwin", env: {}, homeDir })).toBe(
      path.join(homeDir, "Library", "Application Support", "WraithWalker", "config.json")
    );

    expect(getGlobalConfigPath({
      platform: "win32",
      env: { APPDATA: "C:\\Users\\victor\\AppData\\Roaming" },
      homeDir
    })).toBe(path.join("C:\\Users\\victor\\AppData\\Roaming", "WraithWalker", "config.json"));

    expect(getGlobalConfigPath({ platform: "win32", env: {}, homeDir })).toBe(
      path.join(homeDir, "AppData", "Roaming", "WraithWalker", "config.json")
    );
  });

  it.each([
    ["config root", [], "config root must be an object."],
    ["top-level key", { invalid: true }, "unsupported top-level key \"invalid\"."],
    ["theme shape", { theme: [] }, "theme must be an object."],
    ["theme name", { theme: { name: 42 } }, "theme.name must be a string."],
    ["overrides shape", { theme: { overrides: [] } }, "theme.overrides must be an object."],
    ["styles shape", { theme: { overrides: { styles: [] } } }, "theme.overrides.styles must be an object."],
    ["style key", { theme: { overrides: { styles: { mystery: ["bold"] } } } }, "theme.overrides.styles.mystery is not supported."],
    ["style token list", { theme: { overrides: { styles: { heading: "bold" } } } }, "theme.overrides.styles.heading must be an array of style tokens."],
    ["style token value", { theme: { overrides: { styles: { heading: ["spectral"] } } } }, "theme.overrides.styles.heading contains unsupported tokens: spectral."],
    ["icon key", { theme: { overrides: { icons: { mystery: "?" } } } }, "theme.overrides.icons.mystery is not supported."],
    ["icon value", { theme: { overrides: { icons: { success: 7 } } } }, "theme.overrides.icons.success must be a string."],
    ["banner shape", { theme: { overrides: { banner: [] } } }, "theme.overrides.banner must be an object."],
    ["banner art", { theme: { overrides: { banner: { art: [1] } } } }, "theme.overrides.banner.art must be an array of strings."],
    ["banner phrases", { theme: { overrides: { banner: { phrases: [1] } } } }, "theme.overrides.banner.phrases must be an array of strings."],
    ["indent", { theme: { overrides: { indent: 12 } } }, "theme.overrides.indent must be a string."],
    ["label width", { theme: { overrides: { labelWidth: -1 } } }, "theme.overrides.labelWidth must be a non-negative integer."]
  ])("rejects invalid %s config values", async (_label, config, message) => {
    const rootPath = await tmpdir();
    await createRoot(rootPath);
    await writeJson(path.join(rootPath, ".wraithwalker", "cli.json"), config);

    await expect(loadProjectCliConfig(rootPath)).rejects.toThrow(message);
  });

  it("merges banner and scalar overrides across config layers", () => {
    const merged = mergeCliConfigs(
      {
        theme: {
          overrides: {
            banner: {
              art: ["GLOBAL"],
              phrases: ["Global phrase"]
            },
            indent: "g ",
            labelWidth: 12
          }
        }
      },
      {
        theme: {
          overrides: {
            banner: {
              phrases: ["Project phrase"]
            },
            indent: "p "
          }
        }
      }
    );

    const resolved = resolveCliConfig(merged);
    expect(resolved.theme.banner.art).toEqual(["GLOBAL"]);
    expect(resolved.theme.banner.phrases).toEqual(["Project phrase"]);
    expect(resolved.theme.indent).toBe("p ");
    expect(resolved.theme.labelWidth).toBe(12);
  });

  it("rejects unknown themes during resolution when given an invalid in-memory config", () => {
    expect(() => resolveCliConfig({
      theme: {
        name: "ghost-theme"
      }
    } as never)).toThrow("Unknown theme \"ghost-theme\".");
  });
});

describe("cli command coverage gaps", () => {
  it("parses scenario subcommands and reports usage errors", () => {
    expect(scenariosCommand.parse(["list"])).toEqual({ action: "list" });
    expect(scenariosCommand.parse(["save", "baseline"])).toEqual({ action: "save", name: "baseline" });
    expect(scenariosCommand.parse(["switch", "baseline"])).toEqual({ action: "switch", name: "baseline" });
    expect(scenariosCommand.parse(["diff", "baseline", "candidate"])).toEqual({
      action: "diff",
      scenarioA: "baseline",
      scenarioB: "candidate"
    });

    expect(() => scenariosCommand.parse(["save"])).toThrow("Usage: wraithwalker scenarios save <name>");
    expect(() => scenariosCommand.parse(["switch"])).toThrow("Usage: wraithwalker scenarios switch <name>");
    expect(() => scenariosCommand.parse(["diff", "baseline"])).toThrow(
      "Usage: wraithwalker scenarios diff <scenarioA> <scenarioB>"
    );
    expect(() => scenariosCommand.parse(["unknown"])).toThrow(
      "Usage: wraithwalker scenarios {list|save|switch|diff}"
    );
  });

  it("lists scenarios from disk and renders each scenario result shape", async () => {
    const rootPath = await tmpdir();
    await createRoot(rootPath);
    await fs.mkdir(path.join(rootPath, SCENARIOS_DIR, "baseline"), { recursive: true });
    await fs.mkdir(path.join(rootPath, SCENARIOS_DIR, "candidate"), { recursive: true });

    const listResult = await scenariosCommand.execute({
      cwd: rootPath,
      env: {},
      output: createOutputRecorder().output,
      cliConfig: resolveCliConfig({})
    }, { action: "list" });

    expect(listResult.action).toBe("list");
    expect([...listResult.scenarios].sort()).toEqual(["baseline", "candidate"]);

    const emptyOutput = createOutputRecorder();
    scenariosCommand.render(emptyOutput.output, { action: "list", scenarios: [] });
    expect(emptyOutput.calls.info).toEqual(["No scenarios saved."]);

    const listOutput = createOutputRecorder();
    scenariosCommand.render(listOutput.output, { action: "list", scenarios: ["baseline", "candidate"] });
    expect(listOutput.calls.listItem).toEqual(["baseline", "candidate"]);

    const actionOutput = createOutputRecorder();
    scenariosCommand.render(actionOutput.output, { action: "save", name: "baseline" });
    scenariosCommand.render(actionOutput.output, { action: "switch", name: "candidate" });
    scenariosCommand.render(actionOutput.output, { action: "diff", markdown: "## Scenario diff" });

    expect(actionOutput.calls.success).toEqual([
      "Scenario \"baseline\" saved.",
      "Switched to \"candidate\"."
    ]);
    expect(actionOutput.calls.block).toEqual(["## Scenario diff"]);
  });

  it("computes status counts from fixture metadata and manifests", async () => {
    const rootPath = await tmpdir();
    const sentinel = await createRoot(rootPath);

    await writeJson(
      path.join(rootPath, "https__app.example.com", STATIC_RESOURCE_MANIFEST_FILE),
      {
        schemaVersion: 1,
        topOrigin: "https://app.example.com",
        topOriginKey: "https__app.example.com",
        generatedAt: "2026-04-04T00:00:00.000Z",
        resourcesByPathname: {
          "/app.js": [{
            requestUrl: "https://cdn.example.com/app.js",
            requestOrigin: "https://cdn.example.com",
            pathname: "/app.js",
            search: "",
            bodyPath: "cdn.example.com/app.js",
            requestPath: "https__app.example.com/request.json",
            metaPath: "https__app.example.com/response.json",
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-04T00:00:00.000Z"
          }],
          "/styles.css": [{
            requestUrl: "https://cdn.example.com/styles.css",
            requestOrigin: "https://cdn.example.com",
            pathname: "/styles.css",
            search: "",
            bodyPath: "cdn.example.com/styles.css",
            requestPath: "https__app.example.com/request.json",
            metaPath: "https__app.example.com/response.json",
            mimeType: "text/css",
            resourceType: "Stylesheet",
            capturedAt: "2026-04-04T00:00:00.000Z"
          }, {
            requestUrl: "https://cdn.example.com/styles.css?v=2",
            requestOrigin: "https://cdn.example.com",
            pathname: "/styles.css",
            search: "?v=2",
            bodyPath: "cdn.example.com/styles-v2.css",
            requestPath: "https__app.example.com/request-v2.json",
            metaPath: "https__app.example.com/response-v2.json",
            mimeType: "text/css",
            resourceType: "Stylesheet",
            capturedAt: "2026-04-04T00:00:01.000Z"
          }]
        }
      }
    );

    await writeJson(
      path.join(
        rootPath,
        "https__app.example.com",
        "origins",
        "https__api.example.com",
        "http",
        "GET",
        "users",
        "response.meta.json"
      ),
      {
        status: 200,
        statusText: "OK",
        mimeType: "application/json",
        resourceType: "XHR",
        url: "https://api.example.com/users",
        method: "GET",
        capturedAt: "2026-04-04T00:00:00.000Z"
      }
    );

    await writeJson(
      path.join(
        rootPath,
        "https__app.example.com",
        "origins",
        "https__api.example.com",
        "http",
        "POST",
        "login",
        "response.meta.json"
      ),
      {
        status: 201,
        statusText: "Created",
        mimeType: "application/json",
        resourceType: "Fetch",
        url: "https://api.example.com/login",
        method: "POST",
        capturedAt: "2026-04-04T00:00:00.000Z"
      }
    );

    await fs.mkdir(path.join(rootPath, SCENARIOS_DIR, "baseline"), { recursive: true });
    await fs.mkdir(path.join(rootPath, SCENARIOS_DIR, "candidate"), { recursive: true });

    const output = createOutputRecorder();
    const result = await statusCommand.execute({
      cwd: rootPath,
      env: {},
      output: output.output,
      cliConfig: resolveCliConfig({})
    }, {});

    expect(result).toEqual({
      rootPath,
      rootId: sentinel.rootId,
      origins: 1,
      endpoints: 2,
      assets: 3,
      scenarios: ["baseline", "candidate"]
    });

    statusCommand.render(output.output, result);
    expect(output.calls.heading).toEqual(["Fixture Root Status"]);
    expect(output.calls.keyValue).toContainEqual(["Assets", 3]);
    expect(output.calls.keyValue).toContainEqual(["Scenarios", "baseline, candidate"]);
  });
});
