import { describe, expect, it } from "vitest";

import manifest from "../static/manifest.json" with { type: "json" };
import packageManifest from "../package.json" with { type: "json" };

describe("extension manifest", () => {
  it("keeps the static manifest version aligned with the extension package version", () => {
    expect(manifest.version).toBe(packageManifest.version);
  });

  it("declares the generated extension icon set", () => {
    expect(manifest.icons).toEqual({
      "16": "assets/icons/icon-16.png",
      "32": "assets/icons/icon-32.png",
      "48": "assets/icons/icon-48.png",
      "128": "assets/icons/icon-128.png"
    });
  });

  it("uses generated toolbar icons for the action surface", () => {
    expect(manifest.action.default_icon).toEqual({
      "16": "assets/icons/icon-16.png",
      "32": "assets/icons/icon-32.png",
      "48": "assets/icons/icon-48.png"
    });
  });
});
