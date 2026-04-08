import { describe, expect, it } from "vitest";

import { DEFAULT_NATIVE_HOST_CONFIG } from "../src/lib/constants.js";
import {
  buildCursorPromptText,
  buildCursorPromptUrl,
  buildEditorAppUrl,
  buildEditorLaunchUrl,
  getEditorLaunchOverride,
  normalizeNativeHostConfig,
  normalizePreferredEditorId,
  resolveEditorLaunch,
  updateEditorLaunchOverride
} from "../src/lib/editor-launch.js";

describe("editor launch helpers", () => {
  it("normalizes unknown preferred editors back to cursor", () => {
    expect(normalizePreferredEditorId("cursor")).toBe("cursor");
    expect(normalizePreferredEditorId("unknown")).toBe("cursor");
  });

  it("migrates legacy global command and url templates into the preferred editor override", () => {
    expect(normalizeNativeHostConfig({
      hostName: "com.example.host",
      rootPath: "/tmp/fixtures",
      commandTemplate: 'cursor "$DIR"',
      urlTemplate: "cursor://workspace?folder=$DIR_COMPONENT"
    }, "cursor")).toEqual({
      ...DEFAULT_NATIVE_HOST_CONFIG,
      hostName: "com.example.host",
      launchPath: "/tmp/fixtures",
      editorLaunchOverrides: {
        cursor: {
          commandTemplate: 'cursor "$DIR"',
          urlTemplate: "cursor://workspace?folder=$DIR_COMPONENT"
        }
      }
    });
  });

  it("does not keep empty or invalid launch overrides", () => {
    expect(normalizeNativeHostConfig({
      editorLaunchOverrides: {
        cursor: {
          commandTemplate: "   ",
          urlTemplate: ""
        }
      }
    })).toEqual(DEFAULT_NATIVE_HOST_CONFIG);
  });

  it("keeps explicit preferred-editor overrides instead of overwriting them with legacy globals", () => {
    expect(normalizeNativeHostConfig({
      commandTemplate: 'legacy "$DIR"',
      urlTemplate: "legacy://workspace?folder=$DIR_COMPONENT",
      editorLaunchOverrides: {
        cursor: {
          commandTemplate: 'custom "$DIR"',
          urlTemplate: "custom://workspace?folder=$DIR_COMPONENT"
        }
      }
    }, "cursor")).toEqual({
      ...DEFAULT_NATIVE_HOST_CONFIG,
      editorLaunchOverrides: {
        cursor: {
          commandTemplate: 'custom "$DIR"',
          urlTemplate: "custom://workspace?folder=$DIR_COMPONENT"
        }
      }
    });
  });

  it("lets per-editor overrides replace built-in launch settings", () => {
    const config = updateEditorLaunchOverride(DEFAULT_NATIVE_HOST_CONFIG, "cursor", {
      urlTemplate: "custom://open?folder=$DIR_COMPONENT",
      commandTemplate: 'custom "$DIR"'
    });

    expect(getEditorLaunchOverride(config, "cursor")).toEqual({
      urlTemplate: "custom://open?folder=$DIR_COMPONENT",
      commandTemplate: 'custom "$DIR"'
    });
    expect(resolveEditorLaunch(config, "cursor")).toMatchObject({
      editorId: "cursor",
      urlTemplate: "custom://open?folder=$DIR_COMPONENT",
      commandTemplate: 'custom "$DIR"',
      appUrl: "cursor://",
      hasCustomUrlOverride: true,
      hasCustomCommandOverride: true
    });
  });

  it("deletes per-editor overrides when the replacement is empty", () => {
    const withOverride = updateEditorLaunchOverride(DEFAULT_NATIVE_HOST_CONFIG, "cursor", {
      urlTemplate: "custom://open?folder=$DIR_COMPONENT"
    });

    expect(updateEditorLaunchOverride(withOverride, "cursor", {
      urlTemplate: "   ",
      commandTemplate: ""
    })).toEqual(DEFAULT_NATIVE_HOST_CONFIG);
  });

  it("keeps undocumented editors on command fallback unless a custom url override is added", () => {
    expect(resolveEditorLaunch(DEFAULT_NATIVE_HOST_CONFIG, "windsurf")).toMatchObject({
      editorId: "windsurf",
      urlTemplate: "",
      commandTemplate: 'windsurf "$DIR"',
      hasBuiltInUrlTemplate: false
    });

    const config = updateEditorLaunchOverride(DEFAULT_NATIVE_HOST_CONFIG, "windsurf", {
      urlTemplate: "windsurf://file/$DIR_URI/"
    });
    expect(resolveEditorLaunch(config, "windsurf")).toMatchObject({
      editorId: "windsurf",
      urlTemplate: "windsurf://file/$DIR_URI/",
      commandTemplate: 'windsurf "$DIR"',
      hasCustomUrlOverride: true
    });
  });

  it("builds launch urls with directory and root placeholders", () => {
    expect(buildEditorLaunchUrl(
      "vscode://file/$DIR_URI/?root=$ROOT_ID&folder=$DIR_COMPONENT",
      "/tmp/my fixtures",
      "root-123"
    )).toBe("vscode://file//tmp/my%20fixtures/?root=root-123&folder=%2Ftmp%2Fmy%20fixtures");
  });

  it("builds bare editor app urls for URL-only app launches", () => {
    expect(buildEditorAppUrl("cursor://")).toBe("cursor://");
  });

  it("builds a Cursor prompt deeplink with the workspace brief", () => {
    const promptText = buildCursorPromptText([
      "https://app.example.com",
      "https://cdn.example.com"
    ]);

    expect(promptText).toContain("WraithWalker fixture root");
    expect(promptText).toContain("Prettify");
    expect(promptText).toContain("https://app.example.com, https://cdn.example.com");
    expect(buildCursorPromptUrl(promptText)).toContain(
      "cursor://anysphere.cursor-deeplink/prompt?text="
    );
  });
});
