import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export const RELEASE_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const INTERNAL_DEPENDENCY_FIELDS = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies"
]);

export const PUBLISHABLE_PACKAGES = Object.freeze([
  {
    name: "@wraithwalker/mcp-server",
    relativePath: "packages/mcp-server/package.json"
  },
  {
    name: "@wraithwalker/native-host",
    relativePath: "packages/native-host/package.json"
  },
  {
    name: "@wraithwalker/cli",
    relativePath: "packages/cli/package.json"
  }
]);

const PUBLISHABLE_PACKAGE_NAMES = new Set(
  PUBLISHABLE_PACKAGES.map(({ name }) => name)
);

export function parseReleaseVersion(value, label = "version") {
  if (!RELEASE_VERSION_PATTERN.test(value ?? "")) {
    throw new Error(`Expected ${label} in x.y.z format, received "${value ?? ""}".`);
  }

  return value;
}

export function parseReleaseTag(tag) {
  const match = /^v(.+)$/.exec(tag ?? "");
  if (!match) {
    throw new Error(`Expected release tag in vX.Y.Z format, received "${tag ?? ""}".`);
  }

  return parseReleaseVersion(match[1], "release tag");
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function loadPublishablePackages(rootDir = process.cwd()) {
  return PUBLISHABLE_PACKAGES.map(({ name, relativePath }) => {
    const filePath = path.join(rootDir, relativePath);
    return {
      name,
      relativePath,
      filePath,
      manifest: readJson(filePath)
    };
  });
}

export function withReleaseVersion(entries, version) {
  const releaseVersion = parseReleaseVersion(version);

  return entries.map((entry) => {
    const manifest = structuredClone(entry.manifest);
    manifest.version = releaseVersion;

    for (const field of INTERNAL_DEPENDENCY_FIELDS) {
      const dependencyMap = manifest[field];
      if (!dependencyMap) {
        continue;
      }

      for (const dependencyName of Object.keys(dependencyMap)) {
        if (PUBLISHABLE_PACKAGE_NAMES.has(dependencyName)) {
          dependencyMap[dependencyName] = releaseVersion;
        }
      }
    }

    return { ...entry, manifest };
  });
}

export function writePublishablePackages(entries) {
  for (const entry of entries) {
    writeJson(entry.filePath, entry.manifest);
  }
}

export function validateReleaseState(entries, version) {
  const releaseVersion = parseReleaseVersion(version, "expected package version");
  const errors = [];

  for (const { name, relativePath, manifest } of entries) {
    if (manifest.private === true) {
      errors.push(`${name} is still private in ${relativePath}.`);
    }

    if (manifest.version !== releaseVersion) {
      errors.push(
        `${name} has version ${manifest.version ?? "<missing>"} in ${relativePath}; expected ${releaseVersion}.`
      );
    }

    if (manifest.publishConfig?.access !== "public") {
      errors.push(
        `${name} must declare publishConfig.access = "public" in ${relativePath}.`
      );
    }

    for (const field of INTERNAL_DEPENDENCY_FIELDS) {
      const dependencyMap = manifest[field];
      if (!dependencyMap) {
        continue;
      }

      for (const dependencyName of Object.keys(dependencyMap)) {
        if (
          PUBLISHABLE_PACKAGE_NAMES.has(dependencyName) &&
          dependencyMap[dependencyName] !== releaseVersion
        ) {
          errors.push(
            `${name} pins ${dependencyName} to ${dependencyMap[dependencyName]} in ${relativePath} (${field}); expected ${releaseVersion}.`
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

export function refreshPackageLock(rootDir = process.cwd()) {
  runCommand(getNpmCommand(), ["install", "--package-lock-only", "--ignore-scripts"], {
    cwd: rootDir
  });
}

export function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    stdio: options.stdio ?? "inherit"
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}
