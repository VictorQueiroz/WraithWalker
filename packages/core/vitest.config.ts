import { defineConfig } from "vitest/config";
import { createCoverageConfig } from "../../test-support/coverage-config.ts";
import { createWorkspaceSourcePlugins } from "../../test-support/vitest-utils.ts";

export default defineConfig({
  plugins: createWorkspaceSourcePlugins(),
  test: {
    environment: "node",
    coverage: createCoverageConfig({
      include: ["src/**/*.mts"],
      exclude: ["src/**/*.d.mts"],
      thresholds: {
        statements: 96,
        lines: 96,
        functions: 96,
        branches: 91
      }
    })
  }
});
