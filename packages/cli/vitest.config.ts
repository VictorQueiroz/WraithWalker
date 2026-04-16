import { defineConfig } from "vitest/config";
import { createCoverageConfig } from "../../test-support/coverage-config.ts";
import {
  createWorkspacePackageAliases,
  createWorkspaceSourcePlugins
} from "../../test-support/vitest-utils.ts";

export default defineConfig({
  plugins: createWorkspaceSourcePlugins(),
  resolve: {
    alias: createWorkspacePackageAliases(["core", "mcp-server"])
  },
  test: {
    environment: "node",
    coverage: createCoverageConfig({
      include: ["src/**/*.mts"],
      exclude: ["src/**/*.d.mts"],
      thresholds: {
        statements: 92,
        lines: 92,
        functions: 94,
        branches: 89
      }
    })
  }
});
