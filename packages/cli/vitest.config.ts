import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "src/lib/fs-gateway.mts",
        "src/lib/root.mts",
        "src/lib/context-generator.mts",
        "src/commands/init.mts",
        "src/commands/status.mts",
        "src/commands/scenarios.mts",
        "src/commands/context.mts"
      ],
      thresholds: {
        statements: 65,
        lines: 65,
        functions: 85,
        branches: 60
      }
    }
  }
});
