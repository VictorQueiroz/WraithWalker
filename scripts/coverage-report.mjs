import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import istanbulCoverage from "istanbul-lib-coverage";
import istanbulReport from "istanbul-lib-report";
import reports from "istanbul-reports";

const { createCoverageMap } = istanbulCoverage;
const { createContext } = istanbulReport;

const repoRoot = process.cwd();
const packagesDir = path.join(repoRoot, "packages");
const outputDir = path.join(repoRoot, "coverage");
const rootCoverageThresholds = {
  statements: 94,
  branches: 91,
  functions: 95,
  lines: 94
};

function discoverPackages() {
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) =>
      fs.existsSync(path.join(packagesDir, name, "package.json"))
    )
    .sort();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function formatPercent(covered, total) {
  if (total === 0) {
    return "100.00";
  }

  return ((covered / total) * 100).toFixed(2);
}

function assertRootCoverageThresholds(summary) {
  const failures = Object.entries(rootCoverageThresholds)
    .filter(([key, minimum]) => summary[key].pct < minimum)
    .map(
      ([key, minimum]) =>
        `${key}: expected >= ${minimum.toFixed(2)}%, received ${summary[key].pct.toFixed(2)}%`
    );

  if (failures.length > 0) {
    throw new Error(
      `Merged repo coverage is below the enforced thresholds:\n${failures.join("\n")}`
    );
  }
}

const packageNames = discoverPackages();
const coverageMap = createCoverageMap({});
const packageSummaries = [];

for (const packageName of packageNames) {
  const coverageDir = path.join(packagesDir, packageName, "coverage");
  const coverageJsonPath = path.join(coverageDir, "coverage-final.json");

  if (!fs.existsSync(coverageJsonPath)) {
    throw new Error(
      `Missing coverage artifact for package "${packageName}" at ${path.relative(repoRoot, coverageJsonPath)}. Run the package tests first.`
    );
  }

  coverageMap.merge(readJson(coverageJsonPath));

  const packageMap = createCoverageMap(readJson(coverageJsonPath));
  const summary = packageMap.getCoverageSummary().toJSON();

  packageSummaries.push({
    package: packageName,
    statements: {
      pct: Number(summary.statements.pct.toFixed(2)),
      covered: summary.statements.covered,
      total: summary.statements.total
    },
    branches: {
      pct: Number(summary.branches.pct.toFixed(2)),
      covered: summary.branches.covered,
      total: summary.branches.total
    },
    functions: {
      pct: Number(summary.functions.pct.toFixed(2)),
      covered: summary.functions.covered,
      total: summary.functions.total
    },
    lines: {
      pct: Number(summary.lines.pct.toFixed(2)),
      covered: summary.lines.covered,
      total: summary.lines.total
    }
  });
}

fs.rmSync(outputDir, { force: true, recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

const context = createContext({
  dir: outputDir,
  coverageMap
});

reports.create("lcov", { projectRoot: repoRoot }).execute(context);
reports
  .create("json-summary", { file: "coverage-summary.json" })
  .execute(context);
reports.create("text").execute(context);

const mergedSummary = coverageMap.getCoverageSummary().toJSON();
const repoSummary = {
  statements: {
    pct: Number(
      formatPercent(
        mergedSummary.statements.covered,
        mergedSummary.statements.total
      )
    ),
    covered: mergedSummary.statements.covered,
    total: mergedSummary.statements.total
  },
  branches: {
    pct: Number(
      formatPercent(
        mergedSummary.branches.covered,
        mergedSummary.branches.total
      )
    ),
    covered: mergedSummary.branches.covered,
    total: mergedSummary.branches.total
  },
  functions: {
    pct: Number(
      formatPercent(
        mergedSummary.functions.covered,
        mergedSummary.functions.total
      )
    ),
    covered: mergedSummary.functions.covered,
    total: mergedSummary.functions.total
  },
  lines: {
    pct: Number(
      formatPercent(mergedSummary.lines.covered, mergedSummary.lines.total)
    ),
    covered: mergedSummary.lines.covered,
    total: mergedSummary.lines.total
  }
};

fs.writeFileSync(
  path.join(outputDir, "packages.json"),
  `${JSON.stringify({ repoSummary, packageSummaries }, null, 2)}\n`
);

console.log("");
console.log(
  "Merged package coverage into coverage/lcov-report/index.html and coverage/lcov.info"
);
assertRootCoverageThresholds(repoSummary);
