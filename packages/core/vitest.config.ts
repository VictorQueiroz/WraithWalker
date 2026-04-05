import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "src/root.mts",
        "src/fixtures.mts",
        "src/scenarios.mts",
        "src/context.mts"
      ],
      thresholds: {
        statements: 80,
        lines: 80,
        functions: 90,
        branches: 70
      }
    }
  }
});
