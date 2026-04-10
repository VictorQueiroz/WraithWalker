#!/usr/bin/env node

import process from "node:process";

import { syncExtensionManifestVersion } from "./versioning-lib.mjs";

try {
  const result = syncExtensionManifestVersion(process.cwd());
  console.log(
    `${result.changed ? "Updated" : "Verified"} extension static manifest version ${result.version}.`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
