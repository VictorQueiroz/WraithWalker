import fs from "node:fs";
import path from "node:path";

import {
  allowlistedSources,
  explicitCoverage
} from "../test-support/test-surface-coverage.mjs";

const repoRoot = process.cwd();
const packageDir = path.join(repoRoot, "packages");

function normalize(filePath) {
  return filePath.split(path.sep).join("/");
}

function toRepoRelativePath(filePath) {
  return normalize(path.relative(repoRoot, filePath));
}

function walkFiles(rootPath, predicate, results = []) {
  if (!fs.existsSync(rootPath)) {
    return results;
  }

  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const nextPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(nextPath, predicate, results);
      continue;
    }

    if (predicate(nextPath)) {
      results.push(toRepoRelativePath(nextPath));
    }
  }

  return results;
}

function isRuntimeSource(filePath) {
  if (!/\.(mts|ts|tsx)$/.test(filePath) || /\.d\./.test(filePath)) {
    return false;
  }

  const source = fs.readFileSync(filePath, "utf8");
  return (
    /\bexport\s+(?:async\s+function|function|const|let|var|class|default)\b/.test(
      source
    ) ||
    /\bexport\s+\*\s+from\b/.test(source) ||
    /\bexport\s*{(?!\s*type\b)/.test(source)
  );
}

const packages = fs
  .readdirSync(packageDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const sourceFiles = packages.flatMap((pkg) =>
  walkFiles(path.join(packageDir, pkg, "src"), isRuntimeSource)
);
const testFiles = [
  ...packages.flatMap((pkg) =>
    walkFiles(path.join(packageDir, pkg, "tests"), (filePath) =>
      /\.(test|spec)\.(ts|tsx|mts|mjs)$/.test(filePath)
    )
  ),
  ...walkFiles(path.join(repoRoot, "tests"), (filePath) =>
    /\.(test|spec)\.(ts|tsx|mts|mjs)$/.test(filePath)
  )
];
const testContents = new Map(
  testFiles.map((filePath) => [
    filePath,
    fs.readFileSync(path.join(repoRoot, filePath), "utf8")
  ])
);

function buildSearchTokens(sourceFile) {
  const ext = path.extname(sourceFile);
  const basename = path.basename(sourceFile, ext);
  const srcIndex = sourceFile.indexOf("/src/");
  const srcRelative =
    srcIndex === -1 ? basename : sourceFile.slice(srcIndex + 5, -ext.length);

  return [
    basename,
    srcRelative,
    `../src/${srcRelative}.js`,
    `../src/${srcRelative}.mjs`,
    `../src/${srcRelative}.ts`,
    `../src/${srcRelative}.tsx`
  ];
}

const failures = [];

for (const sourceFile of sourceFiles) {
  if (allowlistedSources.includes(sourceFile)) {
    continue;
  }

  const mappedTests = explicitCoverage[sourceFile];
  if (mappedTests) {
    const missingTests = mappedTests.filter(
      (testFile) => !fs.existsSync(path.join(repoRoot, testFile))
    );
    if (missingTests.length > 0) {
      failures.push(
        `${sourceFile}\n  missing explicit coverage targets:\n  - ${missingTests.join("\n  - ")}`
      );
    }
    continue;
  }

  const tokens = buildSearchTokens(sourceFile);
  const covered = [...testContents.values()].some((content) =>
    tokens.some((token) => content.includes(token))
  );

  if (!covered) {
    failures.push(
      `${sourceFile}\n  no direct test match found; add a direct test, explicit mapping, or allowlist entry.`
    );
  }
}

const staleMappings = Object.keys(explicitCoverage).filter(
  (sourceFile) => !fs.existsSync(path.join(repoRoot, sourceFile))
);
if (staleMappings.length > 0) {
  failures.push(
    `stale explicit coverage mappings:\n  - ${staleMappings.join("\n  - ")}`
  );
}

if (failures.length > 0) {
  console.error("Missing test surface coverage:\n");
  console.error(failures.join("\n\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Validated test surface coverage for ${sourceFiles.length} runtime source modules.`
  );
}
