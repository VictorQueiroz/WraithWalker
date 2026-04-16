import { defineConfig } from "vitest/config";

import {
  createWorkspacePackageAliases,
  createWorkspaceSourcePlugins
} from "./test-support/vitest-utils.ts";

export default defineConfig({
  plugins: createWorkspaceSourcePlugins(),
  resolve: {
    alias: createWorkspacePackageAliases(["core", "mcp-server"])
  },
  test: {
    environment: "node",
    exclude: ["tests/smoke/**/*.test.ts"]
  }
});
