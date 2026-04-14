import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  getCreateExtensionReleaseArgs,
  getExtensionReleaseTag,
  getUploadExtensionReleaseAssetArgs
} from "./extension-release-lib.mjs";

function parseArgs(argv) {
  const options = {
    assetPath: "",
    repo: "",
    target: "",
    version: ""
  };
  const optionAliases = {
    "asset-path": "assetPath",
    repo: "repo",
    target: "target",
    version: "version"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = optionAliases[rawKey];
    const value = inlineValue ?? argv[index + 1];

    if (!value) {
      throw new Error(`Missing value for --${rawKey}`);
    }

    if (inlineValue == null) {
      index += 1;
    }

    if (!key) {
      throw new Error(`Unknown option: --${rawKey}`);
    }

    options[key] = value;
  }

  for (const [key, value] of Object.entries(options)) {
    if (!value) {
      throw new Error(`Missing required option --${key}`);
    }
  }

  return options;
}

function runGh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function releaseExists({ repo, version }) {
  const tag = getExtensionReleaseTag(version);

  try {
    runGh(["release", "view", tag, "--repo", repo]);
    return true;
  } catch (error) {
    const message =
      error && typeof error === "object" && "stderr" in error ? String(error.stderr) : String(error);

    if (message.includes("release not found")) {
      return false;
    }

    throw error;
  }
}

function ensureAssetExists(assetPath) {
  const resolvedAssetPath = path.resolve(assetPath);

  if (!fs.existsSync(resolvedAssetPath)) {
    throw new Error(`Extension release asset not found: ${resolvedAssetPath}`);
  }

  return resolvedAssetPath;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const assetPath = ensureAssetExists(options.assetPath);
  const exists = releaseExists(options);
  const ghArgs = exists
    ? getUploadExtensionReleaseAssetArgs({ ...options, assetPath })
    : getCreateExtensionReleaseArgs({ ...options, assetPath });

  const tag = getExtensionReleaseTag(options.version);
  process.stdout.write(
    `${exists ? "Updating" : "Creating"} extension release ${tag} with ${path.basename(assetPath)}\n`
  );
  runGh(ghArgs);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
