import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXTENSION_RELEASE_ASSET_NAME,
  EXTENSION_RELEASE_TAG_PREFIX,
  getCreateExtensionReleaseArgs,
  getExtensionReleaseNotes,
  getExtensionReleaseTag,
  getExtensionReleaseTitle,
  getUploadExtensionReleaseAssetArgs
} from "./extension-release-lib.mjs";

const EXTENSION_RELEASE_ASSET_SCRIPT_PATH = fileURLToPath(
  new URL("./extension-release-asset.mjs", import.meta.url)
);

test("extension release metadata stays aligned with the extension package naming", () => {
  assert.equal(EXTENSION_RELEASE_TAG_PREFIX, "@wraithwalker/extension@");
  assert.equal(EXTENSION_RELEASE_ASSET_NAME, "WraithWalker.zip");
  assert.equal(
    getExtensionReleaseTag("0.1.1"),
    "@wraithwalker/extension@0.1.1"
  );
  assert.equal(
    getExtensionReleaseTitle("0.1.1"),
    "WraithWalker Extension v0.1.1"
  );
  assert.equal(
    getExtensionReleaseNotes("0.1.1"),
    "Packaged Chrome extension build for version 0.1.1."
  );
});

test("create extension release args target a dedicated non-latest extension release", () => {
  assert.deepEqual(
    getCreateExtensionReleaseArgs({
      assetPath: "/tmp/WraithWalker.zip",
      repo: "VictorQueiroz/WraithWalker",
      target: "abc123",
      version: "0.1.1"
    }),
    [
      "release",
      "create",
      "@wraithwalker/extension@0.1.1",
      "/tmp/WraithWalker.zip",
      "--repo",
      "VictorQueiroz/WraithWalker",
      "--target",
      "abc123",
      "--title",
      "WraithWalker Extension v0.1.1",
      "--notes",
      "Packaged Chrome extension build for version 0.1.1.",
      "--latest=false"
    ]
  );
});

test("existing extension releases reuse the same tag and clobber the asset", () => {
  assert.deepEqual(
    getUploadExtensionReleaseAssetArgs({
      assetPath: "/tmp/WraithWalker.zip",
      repo: "VictorQueiroz/WraithWalker",
      version: "0.1.1"
    }),
    [
      "release",
      "upload",
      "@wraithwalker/extension@0.1.1",
      "/tmp/WraithWalker.zip",
      "--repo",
      "VictorQueiroz/WraithWalker",
      "--clobber"
    ]
  );
});

test("extension release helper accepts workflow-style kebab-case flags", () => {
  const result = spawnSync(
    process.execPath,
    [
      EXTENSION_RELEASE_ASSET_SCRIPT_PATH,
      "--asset-path",
      "/tmp/definitely-missing.zip",
      "--repo",
      "VictorQueiroz/WraithWalker",
      "--target",
      "deadbeef",
      "--version",
      "0.1.1"
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Extension release asset not found/);
  assert.doesNotMatch(result.stderr, /Unknown option/);
});
