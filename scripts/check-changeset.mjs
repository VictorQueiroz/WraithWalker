#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";

import {
  getChangedChangesetFiles,
  getDeclaredChangesetPackagesFromFiles,
  loadWorkspacePackageNames,
  getVersionedPackagesFromChangedFiles
} from "./versioning-lib.mjs";

const PACKAGE_MANIFEST_RELATIVE_PATH_PATTERN =
  /^packages\/([^/]+)\/package\.json$/;

function isMissingFileRevisionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("does not exist in") ||
    message.includes("exists on disk, but not in")
  );
}

function readPackageManifestAtRef(ref, relativePath, cwd = process.cwd()) {
  try {
    return JSON.parse(
      execFileSync("git", ["show", `${ref}:${relativePath}`], {
        cwd,
        encoding: "utf8"
      })
    );
  } catch (error) {
    if (isMissingFileRevisionError(error)) {
      return null;
    }
    throw error;
  }
}

function getReleaseRelevantManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    return manifest;
  }

  const { devDependencies, ...releaseRelevantFields } = manifest;
  return releaseRelevantFields;
}

function hasReleaseRelevantManifestChange(
  sinceRef,
  relativePath,
  cwd = process.cwd()
) {
  const previousManifest = readPackageManifestAtRef(sinceRef, relativePath, cwd);
  const nextManifest = readPackageManifestAtRef("HEAD", relativePath, cwd);

  if (!previousManifest || !nextManifest) {
    return true;
  }

  return !isDeepStrictEqual(
    getReleaseRelevantManifest(previousManifest),
    getReleaseRelevantManifest(nextManifest)
  );
}

function getReleaseRelevantManifestPackages(
  changedFiles,
  sinceRef,
  rootDir = process.cwd()
) {
  const packageNamesByDir = loadWorkspacePackageNames(rootDir);
  const packageNames = new Set();

  for (const filePath of changedFiles) {
    const normalizedPath = filePath.replaceAll("\\", "/");
    const manifestMatch = PACKAGE_MANIFEST_RELATIVE_PATH_PATTERN.exec(
      normalizedPath
    );
    if (!manifestMatch) {
      continue;
    }

    const packageName = packageNamesByDir.get(manifestMatch[1]);
    if (!packageName) {
      continue;
    }

    if (hasReleaseRelevantManifestChange(sinceRef, normalizedPath, rootDir)) {
      packageNames.add(packageName);
    }
  }

  return [...packageNames].sort();
}

function main() {
  const sinceArg = process.argv.find((value) => value.startsWith("--since="));
  const sinceRef = sinceArg ? sinceArg.slice("--since=".length) : "origin/main";
  const changedFilesOutput = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${sinceRef}...HEAD`],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );
  const changedFiles = changedFilesOutput
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  const changedPackages = new Set(
    getVersionedPackagesFromChangedFiles(changedFiles, process.cwd())
  );
  for (const packageName of getReleaseRelevantManifestPackages(
    changedFiles,
    sinceRef,
    process.cwd()
  )) {
    changedPackages.add(packageName);
  }
  const changedPackageList = [...changedPackages].sort();

  if (changedPackageList.length === 0) {
    console.log("No versioned package or extension surfaces changed.");
    return;
  }

  const declaredPackages = new Set(
    getDeclaredChangesetPackagesFromFiles(
      getChangedChangesetFiles(changedFiles, process.cwd())
    )
  );
  const missingPackages = changedPackageList.filter(
    (packageName) => !declaredPackages.has(packageName)
  );

  if (missingPackages.length > 0) {
    throw new Error(
      `Missing changeset coverage for: ${missingPackages.join(", ")}. Add a .changeset entry covering every changed versioned package or app.`
    );
  }

  console.log(`Changesets cover: ${changedPackageList.join(", ")}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
