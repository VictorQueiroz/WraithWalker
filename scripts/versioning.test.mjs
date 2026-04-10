import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EXTENSION_PACKAGE_MANIFEST_RELATIVE_PATH,
  EXTENSION_STATIC_MANIFEST_RELATIVE_PATH,
  getDeclaredChangesetPackages,
  getVersionedPackagesFromChangedFiles,
  parseChangesetPackages,
  readJson,
  syncExtensionManifestVersion
} from "./versioning-lib.mjs";

function createFixtureRoot({ packageVersion, manifestVersion }) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "wraithwalker-versioning-"));
  const packageManifestPath = path.join(rootDir, EXTENSION_PACKAGE_MANIFEST_RELATIVE_PATH);
  const staticManifestPath = path.join(rootDir, EXTENSION_STATIC_MANIFEST_RELATIVE_PATH);

  fs.mkdirSync(path.dirname(packageManifestPath), { recursive: true });
  fs.mkdirSync(path.dirname(staticManifestPath), { recursive: true });
  fs.writeFileSync(
    packageManifestPath,
    `${JSON.stringify({ name: "@wraithwalker/extension", version: packageVersion }, null, 2)}\n`
  );
  fs.writeFileSync(
    staticManifestPath,
    `${JSON.stringify(
      {
        manifest_version: 3,
        name: "WraithWalker",
        version: manifestVersion,
        action: { default_title: "WraithWalker" }
      },
      null,
      2
    )}\n`
  );

  return { rootDir, staticManifestPath };
}

test("syncExtensionManifestVersion rewrites the static manifest version from package.json", () => {
  const { rootDir, staticManifestPath } = createFixtureRoot({
    packageVersion: "3.1.4",
    manifestVersion: "0.1.0"
  });

  const result = syncExtensionManifestVersion(rootDir);

  assert.equal(result.changed, true);
  assert.equal(result.version, "3.1.4");
  assert.equal(readJson(staticManifestPath).version, "3.1.4");
  assert.deepEqual(readJson(staticManifestPath).action, { default_title: "WraithWalker" });
});

test("syncExtensionManifestVersion reports unchanged when versions already match", () => {
  const { rootDir, staticManifestPath } = createFixtureRoot({
    packageVersion: "2.0.0",
    manifestVersion: "2.0.0"
  });

  const result = syncExtensionManifestVersion(rootDir);

  assert.equal(result.changed, false);
  assert.equal(readJson(staticManifestPath).version, "2.0.0");
});

test("getVersionedPackagesFromChangedFiles maps versioned file paths to workspace package names", () => {
  assert.deepEqual(
    getVersionedPackagesFromChangedFiles(
      [
        "packages/cli/src/cli.mts",
        "packages/extension/scripts/build.ts",
        "packages/core/README.md",
        "docs/npm-releases.md"
      ],
      process.cwd()
    ),
    ["@wraithwalker/cli", "@wraithwalker/extension"]
  );
});

test("parseChangesetPackages reads all declared package names from changeset frontmatter", () => {
  assert.deepEqual(
    parseChangesetPackages(`---
"@wraithwalker/cli": patch
"@wraithwalker/extension": minor
---

Test release metadata.
`),
    ["@wraithwalker/cli", "@wraithwalker/extension"]
  );
});

test("getDeclaredChangesetPackages unions packages across changeset files", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "wraithwalker-changesets-"));
  const changesetDir = path.join(rootDir, ".changeset");

  fs.mkdirSync(changesetDir, { recursive: true });
  fs.writeFileSync(path.join(changesetDir, "README.md"), "# ignored\n");
  fs.writeFileSync(
    path.join(changesetDir, "one.md"),
    `---
"@wraithwalker/cli": patch
---

CLI update.
`
  );
  fs.writeFileSync(
    path.join(changesetDir, "two.md"),
    `---
"@wraithwalker/extension": patch
---

Extension update.
`
  );

  assert.deepEqual(
    getDeclaredChangesetPackages(rootDir),
    ["@wraithwalker/cli", "@wraithwalker/extension"]
  );
});
