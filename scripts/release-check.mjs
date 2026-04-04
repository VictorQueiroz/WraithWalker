#!/usr/bin/env node

import process from "node:process";

import {
  loadPublishablePackages,
  parseReleaseTag,
  validateReleaseState
} from "./release-lib.mjs";

function main() {
  const tag = process.argv[2];
  const version = parseReleaseTag(tag);

  validateReleaseState(loadPublishablePackages(process.cwd()), version);
  console.log(`Release tag ${tag} matches all publishable package manifests.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
