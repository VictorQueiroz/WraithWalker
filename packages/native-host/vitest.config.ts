import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "src/lib.mts"
      ],
      thresholds: {
        statements: 90,
        lines: 90,
        functions: 95,
        branches: 80
      }
    }
  }
});
