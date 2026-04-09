import { coverageConfigDefaults } from "vitest/config";

interface CoverageThresholds {
  perFile?: boolean;
  statements: number;
  lines: number;
  functions: number;
  branches: number;
}

export function createCoverageConfig({
  include,
  exclude = [],
  thresholds
}: {
  include: string[];
  exclude?: string[];
  thresholds: CoverageThresholds;
}) {
  return {
    provider: "v8" as const,
    reporter: ["text", "lcov", "json"],
    reportsDirectory: "coverage",
    include,
    exclude: [...exclude, ...coverageConfigDefaults.exclude],
    thresholds
  };
}
