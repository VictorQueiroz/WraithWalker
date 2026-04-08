#!/usr/bin/env node

import process from "node:process";

import {
  loadPublishablePackages,
  loadWorkspacePackages,
  parseReleaseVersion,
  refreshPackageLock,
  syncInternalDependencyPins,
  withReleaseVersion,
  writePublishablePackages
} from "./release-lib.mjs";

function main() {
  const version = parseReleaseVersion(process.argv[2]);
  const rootDir = process.cwd();
  const updatedPackages = withReleaseVersion(loadPublishablePackages(rootDir), version);
  const updatedWorkspacePackages = syncInternalDependencyPins(loadWorkspacePackages(rootDir), version);

  writePublishablePackages(updatedPackages);
  writePublishablePackages(updatedWorkspacePackages);
  refreshPackageLock(rootDir);

  console.log(
    `Prepared ${version} for ${updatedPackages.map(({ name }) => name).join(", ")}.`
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
