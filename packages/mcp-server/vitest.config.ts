import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/fixture-reader.mts", "src/fixture-diff.mts"],
      thresholds: {
        statements: 90,
        lines: 90,
        functions: 95,
        branches: 75
      }
    }
  }
});
