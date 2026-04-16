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
      include: ["src/**/*.{ts,tsx}"],
      thresholds: {
        statements: 90,
        lines: 90,
        functions: 95,
        branches: 80
      }
    })
  }
});
