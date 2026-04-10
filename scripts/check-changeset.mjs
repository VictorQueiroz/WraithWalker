#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";

import {
  getDeclaredChangesetPackages,
  getVersionedPackagesFromChangedFiles
} from "./versioning-lib.mjs";

function main() {
  const sinceArg = process.argv.find((value) => value.startsWith("--since="));
  const sinceRef = sinceArg ? sinceArg.slice("--since=".length) : "origin/main";
  const changedFilesOutput = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMRTUXB", `${sinceRef}...HEAD`],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );
  const changedFiles = changedFilesOutput.split("\n").map((value) => value.trim()).filter(Boolean);
  const changedPackages = getVersionedPackagesFromChangedFiles(changedFiles, process.cwd());

  if (changedPackages.length === 0) {
    console.log("No versioned package or extension surfaces changed.");
    return;
  }

  const declaredPackages = new Set(getDeclaredChangesetPackages(process.cwd()));
  const missingPackages = changedPackages.filter((packageName) => !declaredPackages.has(packageName));

  if (missingPackages.length > 0) {
    throw new Error(
      `Missing changeset coverage for: ${missingPackages.join(", ")}. Add a .changeset entry covering every changed versioned package or app.`
    );
  }

  console.log(`Changesets cover: ${changedPackages.join(", ")}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
