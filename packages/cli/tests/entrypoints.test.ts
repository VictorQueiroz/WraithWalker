import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { generateContext as coreGenerateContext } from "@wraithwalker/core/context";
import {
  createRoot as coreCreateRoot,
  findRoot as coreFindRoot,
  readSentinel as coreReadSentinel
} from "@wraithwalker/core/root";

import {
  DEFAULT_CONTEXT_FILES,
  EDITOR_CONTEXT_FILES,
  FIXTURE_FILE_NAMES,
  SIMPLE_MODE_METADATA_DIR,
  SIMPLE_MODE_METADATA_TREE,
  STATIC_RESOURCE_MANIFEST_FILE
} from "../src/lib/constants.mts";
import { generateContext } from "../src/lib/context-generator.mts";
import {
  createRoot,
  findRoot,
  readSentinel
} from "../src/lib/root.mts";
import { UsageError } from "../src/lib/command.mts";
import { wraithwalkerTheme } from "../src/lib/wraithwalker-theme.mts";

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-cli-entrypoints-"));
}

async function loadCliEntrypoint(
  query: string,
  runCli = vi.fn().mockResolvedValue(0)
) {
  vi.doMock("../src/lib/runner.mjs", () => ({
    runCli
  }));

  let module: typeof import("../src/cli.mts");
  switch (query) {
    case "success":
      module = await import("../src/cli.mts?success");
      break;
    case "failure-helper":
      module = await import("../src/cli.mts?failure-helper");
      break;
    case "non-error-helper":
      module = await import("../src/cli.mts?non-error-helper");
      break;
    default:
      throw new Error(`Unknown CLI entrypoint query: ${query}`);
  }

  return { module, runCli };
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock("../src/lib/runner.mjs");
});

describe("cli entrypoints and re-exports", () => {
  it("loads the output module as a runtime side-effect-only module", async () => {
    const module = await import("../src/lib/output.mts?side-effect");
    expect(Object.keys(module)).toEqual([]);
  });

  it("preserves the usage error name", () => {
    const error = new UsageError("bad usage");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("UsageError");
    expect(error.message).toBe("bad usage");
  });

  it("re-exports root helpers and generateContext from core", async () => {
    expect(generateContext).toBe(coreGenerateContext);
    expect(createRoot).toBe(coreCreateRoot);
    expect(findRoot).toBe(coreFindRoot);
    expect(readSentinel).toBe(coreReadSentinel);

    const rootPath = await tmpdir();
    const sentinel = await createRoot(rootPath);
    const found = await findRoot(path.join(rootPath, "nested"));
    const reread = await readSentinel(rootPath);

    expect(found.rootPath).toBe(rootPath);
    expect(found.sentinel.rootId).toBe(sentinel.rootId);
    expect(reread.rootId).toBe(sentinel.rootId);
  });

  it("exports the expected CLI constants", () => {
    expect(SIMPLE_MODE_METADATA_DIR).toBe(".wraithwalker");
    expect(SIMPLE_MODE_METADATA_TREE).toBe("simple");
    expect(STATIC_RESOURCE_MANIFEST_FILE).toBe("RESOURCE_MANIFEST.json");
    expect(FIXTURE_FILE_NAMES).toEqual({
      API_REQUEST: "request.json",
      API_META: "response.meta.json"
    });
    expect(EDITOR_CONTEXT_FILES["cursor"]).toEqual(["CLAUDE.md", ".cursorrules"]);
    expect(EDITOR_CONTEXT_FILES["windsurf"]).toEqual(["CLAUDE.md", ".windsurfrules"]);
    expect(DEFAULT_CONTEXT_FILES).toEqual(["CLAUDE.md"]);
  });

  it("exports the default WraithWalker theme", () => {
    expect(wraithwalkerTheme.name).toBe("wraithwalker");
    expect(wraithwalkerTheme.icons).toEqual({
      success: "\u2714",
      error: "\u2716",
      warn: "\u26A0",
      bullet: "\u203A"
    });
    expect(wraithwalkerTheme.styles.heading).toEqual(["bold", "magenta"]);
    expect(wraithwalkerTheme.banner.art.length).toBeGreaterThan(5);
    expect(wraithwalkerTheme.banner.phrases.length).toBeGreaterThan(5);
    expect(wraithwalkerTheme.indent).toBe("  ");
    expect(wraithwalkerTheme.labelWidth).toBe(12);
  });

  it("runs the CLI entrypoint and forwards argv to runCli", async () => {
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    process.argv = ["node", "wraithwalker", "status", "--verbose"];
    process.exitCode = undefined;

    try {
      const { runCli } = await loadCliEntrypoint("success", vi.fn().mockResolvedValue(7));
      expect(runCli).toHaveBeenCalledWith(["status", "--verbose"]);
      expect(process.exitCode).toBe(7);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
    }
  });

  it("handles rejected CLI runs by printing the message and setting exit code 1", async () => {
    const { module } = await loadCliEntrypoint("failure-helper");
    const reportError = vi.fn();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      const exitCode = await module.runEntrypoint({
        argv: ["status"],
        runCliImpl: vi.fn().mockRejectedValue(new Error("runner exploded")),
        reportError
      });

      expect(exitCode).toBe(1);
      expect(reportError).toHaveBeenCalledWith("runner exploded");
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("stringifies non-Error rejections from the CLI entrypoint", async () => {
    const { module } = await loadCliEntrypoint("non-error-helper");
    const reportError = vi.fn();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      const exitCode = await module.runEntrypoint({
        argv: ["status"],
        runCliImpl: vi.fn().mockRejectedValue("runner string failure"),
        reportError
      });

      expect(exitCode).toBe(1);
      expect(reportError).toHaveBeenCalledWith("runner string failure");
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});
