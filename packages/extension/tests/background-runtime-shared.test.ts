import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_CONSOLE_ENTRY_TEXT_LENGTH,
  clipConsoleText,
  getErrorMessage,
  isBackgroundMessage,
  isDetachedDebuggerCommandMessage,
  isLocalRootConfigUnavailable,
  normalizeConsoleTimestamp,
  toBrowserConsoleEntry
} from "../src/lib/background-runtime-shared.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("background runtime shared helpers", () => {
  it("recognizes detached-debugger messages case-insensitively", () => {
    expect(
      isDetachedDebuggerCommandMessage(
        "Debugger is not attached to the tab with id: 7.",
        7
      )
    ).toBe(true);
    expect(
      isDetachedDebuggerCommandMessage(
        "DEBUGGER IS NOT ATTACHED TO THE TAB WITH ID: 7.",
        7
      )
    ).toBe(true);
    expect(
      isDetachedDebuggerCommandMessage(
        "Debugger is not attached to the tab with id: 8.",
        7
      )
    ).toBe(false);
  });

  it("normalizes console timestamps from seconds, milliseconds, and invalid inputs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:00:00.000Z"));

    expect(normalizeConsoleTimestamp(1_775_692_800)).toBe(
      "2026-04-09T00:00:00.000Z"
    );
    expect(normalizeConsoleTimestamp(1_775_692_800_000)).toBe(
      "2026-04-09T00:00:00.000Z"
    );
    expect(normalizeConsoleTimestamp(Number.NaN)).toBe(
      "2026-04-09T12:00:00.000Z"
    );
    expect(normalizeConsoleTimestamp("invalid")).toBe(
      "2026-04-09T12:00:00.000Z"
    );
  });

  it("clips console text and builds browser console entries with sensible defaults", () => {
    const clipped = clipConsoleText(
      "x".repeat(MAX_CONSOLE_ENTRY_TEXT_LENGTH + 2)
    );
    expect(clipped).toBe(`${"x".repeat(MAX_CONSOLE_ENTRY_TEXT_LENGTH)}...`);
    expect(clipConsoleText(42)).toBe("42");
    expect(clipConsoleText(null)).toBe("");

    const entry = toBrowserConsoleEntry(
      4,
      {
        entry: {
          source: " ",
          level: "",
          text: "y".repeat(MAX_CONSOLE_ENTRY_TEXT_LENGTH + 1),
          timestamp: 1_775_692_800,
          url: "https://cdn.example.com/app.js",
          lineNumber: Number.NaN,
          columnNumber: 12
        }
      },
      (url) => new URL(url).origin
    );

    expect(entry).toEqual({
      tabId: 4,
      topOrigin: "https://cdn.example.com",
      source: "other",
      level: "info",
      text: `${"y".repeat(MAX_CONSOLE_ENTRY_TEXT_LENGTH)}...`,
      timestamp: "2026-04-09T00:00:00.000Z",
      url: "https://cdn.example.com/app.js",
      columnNumber: 12
    });

    expect(
      toBrowserConsoleEntry(
        9,
        {
          entry: {
            source: "javascript",
            level: "warn",
            text: "boom",
            timestamp: 1_775_692_800
          }
        },
        () => null,
        {
          topOrigin: "https://app.example.com",
          traceArmedForTraceId: null,
          traceScriptIdentifier: null
        }
      )
    ).toEqual(
      expect.objectContaining({
        topOrigin: "https://app.example.com",
        source: "javascript",
        level: "warn",
        text: "boom"
      })
    );

    expect(
      toBrowserConsoleEntry(
        5,
        {
          entry: {
            source: "network",
            level: "warning",
            text: "no origin available",
            timestamp: 1_775_692_800
          }
        },
        () => null
      )
    ).toEqual(
      expect.objectContaining({
        topOrigin: ""
      })
    );

    expect(toBrowserConsoleEntry(1, {}, () => null)).toBeNull();
  });

  it("filters background messages and ignores offscreen-only payloads", () => {
    expect(isBackgroundMessage({ type: "session.start" })).toBe(true);
    expect(
      isBackgroundMessage({ type: "native.open", editorId: "cursor" })
    ).toBe(true);
    expect(
      isBackgroundMessage({ target: "offscreen", type: "session.start" })
    ).toBe(false);
    expect(isBackgroundMessage({ type: "unknown" })).toBe(false);
    expect(isBackgroundMessage(null)).toBe(false);
  });

  it("extracts explicit error messages and recognizes local-root config errors", () => {
    expect(getErrorMessage({ error: "Boom." })).toBe("Boom.");
    expect(getErrorMessage({ error: " " })).toBe("Unknown error.");
    expect(getErrorMessage(undefined)).toBe("Unknown error.");

    expect(
      isLocalRootConfigUnavailable({
        ok: false,
        error: "No root directory selected."
      })
    ).toBe(true);
    expect(
      isLocalRootConfigUnavailable({
        ok: false,
        error: "Root directory access is not granted."
      })
    ).toBe(true);
    expect(
      isLocalRootConfigUnavailable({ ok: false, error: "Permission denied." })
    ).toBe(false);
  });
});
