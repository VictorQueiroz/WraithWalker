import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CHECK_CHANGESET_SCRIPT_PATH = fileURLToPath(
  new URL("./check-changeset.mjs", import.meta.url)
);

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function writeFile(rootDir, relativePath, contents) {
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function createFixtureRepository() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "wraithwalker-check-changeset-"));

  git(rootDir, "init", "-b", "main");
  git(rootDir, "config", "user.name", "Codex");
  git(rootDir, "config", "user.email", "codex@example.com");
  writeFile(
    rootDir,
    "packages/cli/package.json",
    `${JSON.stringify({ name: "@wraithwalker/cli", version: "1.0.0" }, null, 2)}\n`
  );
  writeFile(
    rootDir,
    "packages/extension/package.json",
    `${JSON.stringify({ name: "@wraithwalker/extension", version: "1.0.0" }, null, 2)}\n`
  );
  writeFile(rootDir, "packages/cli/src/cli.mts", "export const cli = true;\n");
  writeFile(rootDir, ".changeset/README.md", "# changesets\n");

  git(rootDir, "add", ".");
  git(rootDir, "commit", "-m", "Initial fixture");

  return rootDir;
}

function runCheckChangeset(rootDir, sinceRef) {
  return spawnSync(process.execPath, [CHECK_CHANGESET_SCRIPT_PATH, `--since=${sinceRef}`], {
    cwd: rootDir,
    encoding: "utf8"
  });
}

test("check-changeset ignores unrelated existing changesets already on main", () => {
  const rootDir = createFixtureRepository();

  writeFile(
    rootDir,
    ".changeset/existing-cli.md",
    `---
"@wraithwalker/cli": patch
---

Old unreleased CLI change.
`
  );
  git(rootDir, "add", ".");
  git(rootDir, "commit", "-m", "Add existing CLI changeset");
  const sinceRef = git(rootDir, "rev-parse", "HEAD");

  writeFile(rootDir, "packages/cli/src/feature.mts", "export const feature = true;\n");
  git(rootDir, "add", ".");
  git(rootDir, "commit", "-m", "Change CLI without new changeset");

  const result = runCheckChangeset(rootDir, sinceRef);

  assert.equal(result.status, 1);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /Missing changeset coverage for: @wraithwalker\/cli/
  );
});

test("check-changeset treats deletions in versioned package surfaces as releasable changes", () => {
  const rootDir = createFixtureRepository();

  writeFile(rootDir, "packages/cli/src/deleted.mts", "export const deleted = true;\n");
  git(rootDir, "add", ".");
  git(rootDir, "commit", "-m", "Add deletable CLI file");
  const sinceRef = git(rootDir, "rev-parse", "HEAD");

  fs.rmSync(path.join(rootDir, "packages/cli/src/deleted.mts"));
  git(rootDir, "add", ".");
  git(rootDir, "commit", "-m", "Delete CLI file without changeset");

  const result = runCheckChangeset(rootDir, sinceRef);

  assert.equal(result.status, 1);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /Missing changeset coverage for: @wraithwalker\/cli/
  );
});

test("check-changeset accepts package coverage from changeset files introduced by the PR", () => {
  const rootDir = createFixtureRepository();
  const sinceRef = git(rootDir, "rev-parse", "HEAD");

  writeFile(rootDir, "packages/cli/src/feature.mts", "export const feature = true;\n");
  writeFile(
    rootDir,
    ".changeset/fresh-cli.md",
    `---
"@wraithwalker/cli": patch
---

Fresh CLI change.
`
  );
  git(rootDir, "add", ".");
  git(rootDir, "commit", "-m", "Change CLI with fresh changeset");

  const result = runCheckChangeset(rootDir, sinceRef);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Changesets cover: @wraithwalker\/cli/);
});
