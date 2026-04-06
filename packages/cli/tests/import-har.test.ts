import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  importHarFile: vi.fn()
}));

vi.mock("@wraithwalker/core/har-import", () => ({
  importHarFile: mocks.importHarFile
}));

async function loadCommand() {
  vi.resetModules();
  return import("../src/commands/import-har.mts");
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

describe("import-har command", () => {
  it("parses args and reports usage errors", async () => {
    const { command } = await loadCommand();

    expect(command.parse(["capture.har"])).toEqual({
      harFile: "capture.har",
      dir: undefined,
      topOrigin: undefined
    });
    expect(command.parse(["capture.har", "fixtures", "--top-origin", "app.example.com"])).toEqual({
      harFile: "capture.har",
      dir: "fixtures",
      topOrigin: "app.example.com"
    });

    expect(() => command.parse([])).toThrow("Usage: wraithwalker import-har <har-file> [dir] [--top-origin <origin>]");
    expect(() => command.parse(["capture.har", "fixtures", "extra"])).toThrow(
      "Usage: wraithwalker import-har <har-file> [dir] [--top-origin <origin>]"
    );
    expect(() => command.parse(["capture.har", "--top-origin"])).toThrow(
      "Usage: wraithwalker import-har <har-file> [dir] [--top-origin <origin>]"
    );
  });

  it("resolves paths, forwards progress events, and returns the core import result", async () => {
    const { command } = await loadCommand();
    const recorder = createOutputRecorder();
    const result = {
      dir: "/repo",
      sentinel: {
        schemaVersion: 1,
        rootId: "root-123",
        createdAt: "2026-04-06T00:00:00.000Z"
      },
      topOrigin: "https://app.example.com",
      topOrigins: ["https://app.example.com"],
      imported: [{
        requestUrl: "https://app.example.com/",
        bodyPath: "app.example.com/index",
        method: "GET",
        topOrigin: "https://app.example.com"
      }],
      skipped: []
    };

    mocks.importHarFile.mockImplementationOnce(async (options) => {
      await options.onEvent?.({
        type: "entry-complete",
        topOrigin: "https://app.example.com",
        requestUrl: "https://app.example.com/",
        bodyPath: "app.example.com/index",
        completedEntries: 1,
        totalEntries: 1
      });
      return result;
    });

    const executed = await command.execute({
      cwd: "/repo",
      env: {},
      output: recorder.output,
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
    } as never, {
      harFile: "captures/app.har",
      topOrigin: "https://app.example.com"
    });

    expect(mocks.importHarFile).toHaveBeenCalledWith(expect.objectContaining({
      harPath: path.resolve("/repo", "captures/app.har"),
      dir: path.resolve("/repo", "."),
      topOrigin: "https://app.example.com",
      onEvent: expect.any(Function)
    }));
    expect(recorder.calls.progress).toEqual([{
      type: "entry-complete",
      topOrigin: "https://app.example.com",
      requestUrl: "https://app.example.com/",
      bodyPath: "app.example.com/index",
      completedEntries: 1,
      totalEntries: 1
    }]);
    expect(executed).toBe(result);
  });

  it("renders the import summary and groups skip reasons", async () => {
    const { command } = await loadCommand();
    const recorder = createOutputRecorder();

    command.render(recorder.output as never, {
      dir: "/repo/fixtures",
      sentinel: {
        schemaVersion: 1,
        rootId: "root-123",
        createdAt: "2026-04-06T00:00:00.000Z"
      },
      topOrigin: "https://app.example.com",
      topOrigins: ["https://app.example.com"],
      imported: [
        {
          requestUrl: "https://app.example.com/",
          bodyPath: "app.example.com/index",
          method: "GET",
          topOrigin: "https://app.example.com"
        },
        {
          requestUrl: "https://api.example.com/graphql",
          bodyPath: ".wraithwalker/simple/response.body",
          method: "POST",
          topOrigin: "https://app.example.com"
        }
      ],
      skipped: [
        { requestUrl: "a", method: "GET", reason: "Missing body" },
        { requestUrl: "b", method: "GET", reason: "Missing body" },
        { requestUrl: "c", method: "POST", reason: "Alpha issue" },
        { requestUrl: "c", method: "POST", reason: "Unsupported protocol" }
      ]
    });

    expect(recorder.calls.success).toEqual(["Imported HAR into /repo/fixtures"]);
    expect(recorder.calls.keyValue).toEqual([
      ["Top Origin", "https://app.example.com"],
      ["Imported", 2],
      ["Skipped", 4]
    ]);
    expect(recorder.calls.heading).toEqual(["Skip Reasons"]);
    expect(recorder.calls.listItem).toEqual([
      "2 x Missing body",
      "1 x Alpha issue",
      "1 x Unsupported protocol"
    ]);
  });

  it("omits the skip summary when there are no skipped entries", async () => {
    const { command } = await loadCommand();
    const recorder = createOutputRecorder();

    command.render(recorder.output as never, {
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
    });

    expect(recorder.calls.heading).toEqual([]);
    expect(recorder.calls.listItem).toEqual([]);
  });

  it("renders a multi-origin summary", async () => {
    const { command } = await loadCommand();
    const recorder = createOutputRecorder();

    command.render(recorder.output as never, {
      dir: "/repo/fixtures",
      sentinel: {
        schemaVersion: 1,
        rootId: "root-123",
        createdAt: "2026-04-06T00:00:00.000Z"
      },
      topOrigin: "https://admin.example.com",
      topOrigins: [
        "https://admin.example.com",
        "https://app.example.com"
      ],
      imported: [],
      skipped: []
    });

    expect(recorder.calls.keyValue).toEqual([
      ["Top Origins", 2],
      ["Imported", 0],
      ["Skipped", 0]
    ]);
    expect(recorder.calls.heading).toEqual(["Origins"]);
    expect(recorder.calls.listItem).toEqual([
      "https://admin.example.com",
      "https://app.example.com"
    ]);
  });

  it("falls back to the legacy topOrigin field when topOrigins is empty", async () => {
    const { command } = await loadCommand();
    const recorder = createOutputRecorder();

    command.render(recorder.output as never, {
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
      ["Top Origin", "https://app.example.com"],
      ["Imported", 0],
      ["Skipped", 0]
    ]);
  });
});
