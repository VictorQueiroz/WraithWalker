import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  importHarFile: vi.fn(),
  syncOverridesDirectory: vi.fn()
}));

vi.mock("@wraithwalker/core/har-import", () => ({
  importHarFile: mocks.importHarFile
}));

vi.mock("@wraithwalker/core/overrides-sync", () => ({
  syncOverridesDirectory: mocks.syncOverridesDirectory
}));

async function loadCommand() {
  vi.resetModules();
  return import("../src/commands/sync.mts");
}

function createOutputRecorder() {
  const calls = {
    success: [] as string[],
    keyValue: [] as Array<[string, string | number]>,
    heading: [] as string[],
    listItem: [] as string[],
    progress: [] as unknown[]
  };

  return {
    calls,
    output: {
      banner() {},
      success(message: string) {
        calls.success.push(message);
      },
      error() {},
      warn() {},
      heading(message: string) {
        calls.heading.push(message);
      },
      keyValue(key: string, value: string | number) {
        calls.keyValue.push([key, value]);
      },
      info() {},
      listItem(item: string) {
        calls.listItem.push(item);
      },
      block() {},
      usage() {},
      renderImportProgress(event: unknown) {
        calls.progress.push(event);
      }
    }
  };
}

const commandContext = {
  cwd: "/repo",
  env: {},
  cliConfig: {
    theme: {
      name: "test",
      styles: {
        success: [],
        error: [],
        warn: [],
        heading: [],
        label: [],
        muted: [],
        accent: [],
        usage: []
      },
      icons: {
        success: "+",
        error: "x",
        warn: "!",
        bullet: "*"
      },
      banner: {
        art: [],
        phrases: [""]
      },
      indent: "  ",
      labelWidth: 8
    }
  }
} as const;

describe("sync command", () => {
  it("parses overrides sync arguments and usage errors", async () => {
    const { command } = await loadCommand();

    expect(command.parse([])).toEqual({
      dir: undefined,
      harFile: undefined,
      topOrigin: undefined
    });
    expect(command.parse(["fixtures"])).toEqual({
      dir: "fixtures",
      harFile: undefined,
      topOrigin: undefined
    });
    expect(command.parse(["fixtures", "--har", "capture.har", "--top-origin", "https://app.example.com"])).toEqual({
      dir: "fixtures",
      harFile: "capture.har",
      topOrigin: "https://app.example.com"
    });

    expect(() => command.parse(["a", "b"])).toThrow(
      "Usage: wraithwalker sync [dir] [--har <har-file>] [--top-origin <origin>]"
    );
    expect(() => command.parse(["--har"])).toThrow(
      "Usage: wraithwalker sync [dir] [--har <har-file>] [--top-origin <origin>]"
    );
    expect(() => command.parse(["--top-origin"])).toThrow(
      "Usage: wraithwalker sync [dir] [--har <har-file>] [--top-origin <origin>]"
    );
    expect(() => command.parse(["fixtures", "--top-origin", "https://app.example.com"])).toThrow(
      "--top-origin can only be used together with --har."
    );
  });

  it("syncs a Chrome Overrides directory by default and forwards progress events", async () => {
    const { command } = await loadCommand();
    const recorder = createOutputRecorder();
    const result = {
      dir: "/repo/fixtures",
      sentinel: {
        schemaVersion: 1,
        rootId: "root-123",
        createdAt: "2026-04-06T00:00:00.000Z"
      },
      topOrigin: "http://app.example.com",
      topOrigins: ["http://app.example.com", "https://app.example.com"],
      imported: [
        {
          requestUrl: "https://app.example.com/index.html",
          bodyPath: "app.example.com/index.html",
          method: "GET",
          topOrigin: "https://app.example.com"
        }
      ],
      skipped: []
    };

    mocks.syncOverridesDirectory.mockImplementationOnce(async (options) => {
      await options.onEvent?.({
        type: "entry-complete",
        topOrigin: "https://app.example.com",
        requestUrl: "https://app.example.com/index.html",
        bodyPath: "app.example.com/index.html",
        completedEntries: 1,
        totalEntries: 2
      });
      return result;
    });

    const executed = await command.execute({
      ...commandContext,
      output: recorder.output
    } as never, {
      dir: "fixtures"
    });

    expect(mocks.syncOverridesDirectory).toHaveBeenCalledWith({
      dir: path.resolve("/repo", "fixtures"),
      onEvent: expect.any(Function)
    });
    expect(recorder.calls.progress).toEqual([{
      type: "entry-complete",
      topOrigin: "https://app.example.com",
      requestUrl: "https://app.example.com/index.html",
      bodyPath: "app.example.com/index.html",
      completedEntries: 1,
      totalEntries: 2
    }]);
    expect(executed).toEqual({
      source: "overrides",
      ...result
    });
  });

  it("defaults the sync directory to the current working directory", async () => {
    const { command } = await loadCommand();

    mocks.syncOverridesDirectory.mockResolvedValueOnce({
      dir: "/repo",
      sentinel: {
        schemaVersion: 1,
        rootId: "root-123",
        createdAt: "2026-04-06T00:00:00.000Z"
      },
      topOrigin: "",
      topOrigins: [],
      imported: [],
      skipped: []
    });

    await command.execute({
      ...commandContext,
      output: createOutputRecorder().output
    } as never, {});

    expect(mocks.syncOverridesDirectory).toHaveBeenCalledWith({
      dir: path.resolve("/repo", "."),
      onEvent: expect.any(Function)
    });
  });

  it("syncs a HAR when --har is provided", async () => {
    const { command } = await loadCommand();
    const recorder = createOutputRecorder();
    const result = {
      dir: "/repo/fixtures",
      sentinel: {
        schemaVersion: 1,
        rootId: "root-123",
        createdAt: "2026-04-06T00:00:00.000Z"
      },
      topOrigin: "https://app.example.com",
      topOrigins: ["https://app.example.com"],
      imported: [],
      skipped: []
    };

    mocks.importHarFile.mockImplementationOnce(async (options) => {
      await options.onEvent?.({
        type: "entry-complete",
        topOrigin: "https://app.example.com",
        requestUrl: "https://app.example.com/",
        bodyPath: "app.example.com/index.html",
        completedEntries: 1,
        totalEntries: 1
      });
      return result;
    });

    const executed = await command.execute({
      ...commandContext,
      output: recorder.output
    } as never, {
      dir: "fixtures",
      harFile: "captures/app.har",
      topOrigin: "https://app.example.com"
    });

    expect(mocks.importHarFile).toHaveBeenCalledWith({
      harPath: path.resolve("/repo", "captures/app.har"),
      dir: path.resolve("/repo", "fixtures"),
      topOrigin: "https://app.example.com",
      onEvent: expect.any(Function)
    });
    expect(recorder.calls.progress).toEqual([{
      type: "entry-complete",
      topOrigin: "https://app.example.com",
      requestUrl: "https://app.example.com/",
      bodyPath: "app.example.com/index.html",
      completedEntries: 1,
      totalEntries: 1
    }]);
    expect(executed).toEqual({
      source: "har",
      ...result
    });
  });

  it("renders a multi-origin overrides summary and grouped skip reasons", async () => {
    const { command } = await loadCommand();
    const recorder = createOutputRecorder();

    command.render(recorder.output as never, {
      source: "overrides",
      dir: "/repo/fixtures",
      sentinel: {
        schemaVersion: 1,
        rootId: "root-123",
        createdAt: "2026-04-06T00:00:00.000Z"
      },
      topOrigin: "http://app.example.com",
      topOrigins: [
        "http://app.example.com",
        "https://app.example.com"
      ],
      imported: [],
      skipped: [
        { requestUrl: "a", method: "GET", reason: "Missing body" },
        { requestUrl: "b", method: "GET", reason: "Missing body" },
        { requestUrl: "c", method: "GET", reason: "Alpha issue" },
        { requestUrl: "c", method: "GET", reason: "Unsupported request protocol" }
      ]
    });

    expect(recorder.calls.success).toEqual(["Synced fixture root at /repo/fixtures"]);
    expect(recorder.calls.keyValue).toEqual([
      ["Source", "Chrome Overrides"],
      ["Top Origins", 2],
      ["Imported", 0],
      ["Skipped", 4]
    ]);
    expect(recorder.calls.heading).toEqual(["Origins", "Skip Reasons"]);
    expect(recorder.calls.listItem).toEqual([
      "http://app.example.com",
      "https://app.example.com",
      "2 x Missing body",
      "1 x Alpha issue",
      "1 x Unsupported request protocol"
    ]);
  });

  it("renders a HAR summary, falls back to topOrigin, and omits skip reasons when none are skipped", async () => {
    const { command } = await loadCommand();
    const recorder = createOutputRecorder();

    command.render(recorder.output as never, {
      source: "har",
      dir: "/repo/fixtures",
      sentinel: {
        schemaVersion: 1,
        rootId: "root-123",
        createdAt: "2026-04-06T00:00:00.000Z"
      },
      topOrigin: "https://app.example.com",
      topOrigins: [],
      imported: [],
      skipped: []
    });

    expect(recorder.calls.keyValue).toEqual([
      ["Source", "HAR"],
      ["Top Origin", "https://app.example.com"],
      ["Imported", 0],
      ["Skipped", 0]
    ]);
    expect(recorder.calls.heading).toEqual([]);
    expect(recorder.calls.listItem).toEqual([]);
  });

  it("omits top-origin output when neither topOrigin nor topOrigins is present", async () => {
    const { command } = await loadCommand();
    const recorder = createOutputRecorder();

    command.render(recorder.output as never, {
      source: "overrides",
      dir: "/repo/fixtures",
      sentinel: {
        schemaVersion: 1,
        rootId: "root-123",
        createdAt: "2026-04-06T00:00:00.000Z"
      },
      topOrigin: "",
      topOrigins: [],
      imported: [],
      skipped: []
    });

    expect(recorder.calls.keyValue).toEqual([
      ["Source", "Chrome Overrides"],
      ["Imported", 0],
      ["Skipped", 0]
    ]);
  });
});
