import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export const EXTENSION_PACKAGE_MANIFEST_RELATIVE_PATH = "packages/extension/package.json";
export const EXTENSION_STATIC_MANIFEST_RELATIVE_PATH = "packages/extension/static/manifest.json";
export const CHANGESET_MARKDOWN_RELATIVE_PATH_PATTERN = /^\.changeset\/(?!README\.md$)[^/]+\.md$/;
export const VERSIONED_PACKAGE_FILE_PATTERNS = [
  /^packages\/([^/]+)\/src\//,
  /^packages\/([^/]+)\/scripts\//,
  /^packages\/([^/]+)\/static\//,
  /^packages\/([^/]+)\/package\.json$/,
  /^packages\/([^/]+)\/host-manifest\.template\.json$/
];

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function syncExtensionManifestVersion(rootDir = process.cwd()) {
  const packageManifestPath = path.join(rootDir, EXTENSION_PACKAGE_MANIFEST_RELATIVE_PATH);
  const staticManifestPath = path.join(rootDir, EXTENSION_STATIC_MANIFEST_RELATIVE_PATH);
  const packageManifest = readJson(packageManifestPath);
  const staticManifest = readJson(staticManifestPath);
  const nextManifest = {
    ...staticManifest,
    version: packageManifest.version
  };

  writeJson(staticManifestPath, nextManifest);

  return {
    changed: staticManifest.version !== packageManifest.version,
    staticManifestPath,
    version: packageManifest.version
  };
}

export function loadWorkspacePackageNames(rootDir = process.cwd()) {
  const packagesDir = path.join(rootDir, "packages");

  return new Map(
    fs.readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const packageManifestPath = path.join(packagesDir, entry.name, "package.json");
        return [entry.name, readJson(packageManifestPath).name];
      })
  );
}

export function getVersionedPackagesFromChangedFiles(
  filePaths,
  rootDir = process.cwd()
) {
  const packageNamesByDir = loadWorkspacePackageNames(rootDir);
  const packageNames = new Set();

  for (const filePath of filePaths) {
    const normalizedPath = filePath.replaceAll(path.sep, "/");

    for (const pattern of VERSIONED_PACKAGE_FILE_PATTERNS) {
      const match = pattern.exec(normalizedPath);
      if (!match) {
        continue;
      }

      const packageName = packageNamesByDir.get(match[1]);
      if (packageName) {
        packageNames.add(packageName);
      }
      break;
    }
  }

  return [...packageNames].sort();
}

export function getChangedChangesetFiles(filePaths, rootDir = process.cwd()) {
  return filePaths
    .map((filePath) => filePath.replaceAll(path.sep, "/"))
    .filter((filePath) => CHANGESET_MARKDOWN_RELATIVE_PATH_PATTERN.test(filePath))
    .map((filePath) => path.join(rootDir, filePath))
    .filter((filePath) => fs.existsSync(filePath))
    .sort();
}

export function parseChangesetPackages(markdown) {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---/m.exec(markdown);
  if (!frontmatterMatch) {
    return [];
  }

  return [...new Set(
    [...frontmatterMatch[1].matchAll(/["']([^"']+)["']\s*:\s*(major|minor|patch)/g)]
      .map((match) => match[1])
  )].sort();
}

export function listChangesetFiles(rootDir = process.cwd()) {
  const changesetDir = path.join(rootDir, ".changeset");
  if (!fs.existsSync(changesetDir)) {
    return [];
  }

  return fs.readdirSync(changesetDir)
    .filter((entry) => entry.endsWith(".md") && entry !== "README.md")
    .map((entry) => path.join(changesetDir, entry));
}

export function getDeclaredChangesetPackagesFromFiles(filePaths) {
  const packageNames = new Set();

  for (const filePath of filePaths) {
    for (const packageName of parseChangesetPackages(fs.readFileSync(filePath, "utf8"))) {
      packageNames.add(packageName);
    }
  }

  return [...packageNames].sort();
}

export function getDeclaredChangesetPackages(rootDir = process.cwd()) {
  return getDeclaredChangesetPackagesFromFiles(listChangesetFiles(rootDir));
}
