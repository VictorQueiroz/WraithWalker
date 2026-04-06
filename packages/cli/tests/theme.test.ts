import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { supportsColor } from "../src/lib/ansi.mts";
import { createFsGateway } from "../src/lib/fs-gateway.mts";
import { createPlainOutput } from "../src/lib/plain-output.mts";
import { createThemedOutput } from "../src/lib/themed-output.mts";
import type { ThemeDefinition } from "../src/lib/theme.mts";

const testTheme: ThemeDefinition = {
  name: "test",
  styles: {
    success: ["green"],
    error: ["red"],
    warn: ["yellow"],
    heading: ["bold", "cyan"],
    label: ["magenta"],
    muted: ["dim"],
    accent: ["bold", "white"],
    usage: ["dim"]
  },
  icons: {
    success: "+",
    error: "x",
    warn: "!",
    bullet: "*"
  },
  banner: {
    art: ["BANNER"],
    phrases: ["Theme phrase"]
  },
  indent: ">> ",
  labelWidth: 8
};

afterEach(() => {
  vi.restoreAllMocks();
});

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-cli-theme-"));
}

describe("theme output", () => {
  it("renders ANSI styles and all themed output methods", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const output = createThemedOutput(testTheme, { isTTY: true });
    const nonInteractiveOutput = createThemedOutput(testTheme, { isTTY: false });

    output.success("Done");
    output.error("Nope");
    output.warn("Careful");
    output.heading("Status");
    output.keyValue("Root", "/tmp/root");
    output.info("Info line");
    output.listItem("alpha");
    output.block("Block text");
    output.usage("Usage text");
    output.renderImportProgress({
      type: "entry-start",
      topOrigin: "https://app.example.com",
      requestUrl: "https://cdn.example.com/static/chunks/some-very-long-file-name-that-needs-truncation.js",
      bodyPath: "cdn.example.com/app.js",
      completedEntries: 1,
      totalEntries: 2,
      writtenBytes: 3,
      totalBytes: 6
    });
    output.renderImportProgress({
      type: "entry-progress",
      topOrigin: "https://app.example.com",
      requestUrl: "https://cdn.example.com/static/chunks/some-very-long-file-name-that-needs-truncation.js",
      bodyPath: "cdn.example.com/app.js",
      completedEntries: 1,
      totalEntries: 2,
      writtenBytes: 6,
      totalBytes: 6
    });
    output.renderImportProgress({
      type: "entry-progress",
      topOrigin: "https://app.example.com",
      requestUrl: "https://cdn.example.com/app.js",
      bodyPath: "cdn.example.com/app.js",
      completedEntries: 1,
      totalEntries: 2,
      writtenBytes: 6,
      totalBytes: 6
    });
    output.renderImportProgress({
      type: "entry-complete",
      topOrigin: "https://app.example.com",
      requestUrl: "https://cdn.example.com/app.js",
      bodyPath: "cdn.example.com/app.js",
      completedEntries: 1,
      totalEntries: 2
    });
    output.renderImportProgress({
      type: "entry-skipped",
      topOrigin: "https://app.example.com",
      requestUrl: "https://api.example.com/users",
      method: "PATCH",
      reason: "Missing body",
      skippedEntries: 1,
      totalCandidates: 2
    });
    nonInteractiveOutput.renderImportProgress({
      type: "entry-complete",
      topOrigin: "https://app.example.com",
      requestUrl: "https://cdn.example.com/app.js",
      bodyPath: "cdn.example.com/app.js",
      completedEntries: 1,
      totalEntries: 2
    });
    nonInteractiveOutput.renderImportProgress({
      type: "entry-skipped",
      topOrigin: "https://app.example.com",
      requestUrl: "https://api.example.com/users",
      method: "PATCH",
      reason: "Missing body",
      skippedEntries: 1,
      totalCandidates: 2
    });
    nonInteractiveOutput.renderImportProgress({
      type: "scan-complete",
      totalEntries: 2,
      totalCandidates: 2,
      topOrigin: "https://app.example.com",
      topOrigins: ["https://app.example.com"]
    });
    output.banner();

    expect(logSpy.mock.calls[0][0]).toContain("\u001b[32m");
    expect(errorSpy.mock.calls[0][0]).toContain("\u001b[31m");
    expect(errorSpy.mock.calls[1][0]).toContain("\u001b[33m");
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("\u001b[1m"))).toBe(true);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("/tmp/root"))).toBe(true);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("Info line"))).toBe(true);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("Block text"))).toBe(true);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("Theme phrase"))).toBe(true);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("Imported cdn.example.com/app.js"))).toBe(true);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("Skipped [PATCH] https://api.example.com/users: Missing body"))).toBe(true);
    expect(errorSpy.mock.calls[2][0]).toContain("\u001b[2m");
    expect(writeSpy).toHaveBeenCalled();
  });

  it("respects spacing and banner content without ANSI in plain output", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const output = createPlainOutput(testTheme);

    output.success("Done");
    output.error("Nope");
    output.warn("Careful");
    output.heading("Status");
    output.keyValue("Root", "/tmp/root");
    output.info("Info line");
    output.listItem("alpha");
    output.block("Block text");
    output.usage("Usage text");
    output.renderImportProgress({
      type: "entry-complete",
      topOrigin: "https://app.example.com",
      requestUrl: "https://cdn.example.com/app.js",
      bodyPath: "cdn.example.com/app.js",
      completedEntries: 1,
      totalEntries: 2
    });
    output.renderImportProgress({
      type: "entry-skipped",
      topOrigin: "https://app.example.com",
      requestUrl: "https://api.example.com/users",
      method: "PATCH",
      reason: "Missing body",
      skippedEntries: 1,
      totalCandidates: 2
    });
    output.banner();

    expect(logSpy.mock.calls[0][0]).toBe("Done");
    expect(errorSpy.mock.calls[0][0]).toBe("Nope");
    expect(errorSpy.mock.calls[1][0]).toBe("Careful");
    expect(logSpy.mock.calls.some((call) => call[0] === "Status")).toBe(true);
    expect(logSpy.mock.calls.some((call) => call[0] === "Root     /tmp/root")).toBe(true);
    expect(logSpy.mock.calls.some((call) => call[0] === "Info line")).toBe(true);
    expect(logSpy.mock.calls.some((call) => call[0] === "  alpha")).toBe(true);
    expect(logSpy.mock.calls.some((call) => call[0] === "Block text")).toBe(true);
    expect(logSpy.mock.calls.some((call) => call[0] === "Imported cdn.example.com/app.js")).toBe(true);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("Skipped [PATCH] https://api.example.com/users: Missing body"))).toBe(true);
    expect(errorSpy.mock.calls[2][0]).toBe("Usage text");
    expect(logSpy.mock.calls.some((call) => call[0] === "BANNER")).toBe(true);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("Theme phrase"))).toBe(true);
  });

  it("evaluates color support branches", () => {
    expect(supportsColor({ env: { NO_COLOR: "1" }, isTTY: true })).toBe(false);
    expect(supportsColor({ env: { FORCE_COLOR: "1" }, isTTY: false })).toBe(true);
    expect(supportsColor({ env: {}, isTTY: false })).toBe(false);
    expect(supportsColor({ env: {}, isTTY: true })).toBe(true);
  });

  it("reads and writes through the filesystem gateway", async () => {
    const rootPath = await tmpdir();
    const gateway = createFsGateway();

    await gateway.writeText(rootPath, "notes/readme.txt", "hello");
    await gateway.writeJson(rootPath, "data/value.json", { ok: true });

    expect(await gateway.exists(rootPath, "notes/readme.txt")).toBe(true);
    expect(await gateway.exists(rootPath, "missing.txt")).toBe(false);
    expect(await gateway.readText(rootPath, "notes/readme.txt")).toBe("hello");
    expect(await gateway.readJson<{ ok: boolean }>(rootPath, "data/value.json")).toEqual({ ok: true });
    expect(await gateway.readOptionalJson(rootPath, "data/value.json")).toEqual({ ok: true });
    expect(await gateway.readOptionalJson(rootPath, "data/missing.json")).toBeNull();
    expect(await gateway.listDirectory(rootPath, "")).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "data", kind: "directory" }),
      expect.objectContaining({ name: "notes", kind: "directory" })
    ]));
    expect(await gateway.listDirectory(rootPath, "notes")).toEqual([
      { name: "readme.txt", kind: "file" }
    ]);
    expect(await gateway.exists(rootPath, "../escape.txt")).toBe(false);
    await expect(gateway.writeText(rootPath, "../escape.txt", "nope")).rejects.toThrow(
      'Path "../escape.txt" must stay within the fixture root.'
    );
  });
});
