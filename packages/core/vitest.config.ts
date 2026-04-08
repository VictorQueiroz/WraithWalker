import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "src/fixture-presentation.mts",
        "src/fixture-layout.mts",
        "src/fixture-repository.mts",
        "src/har-import.mts",
        "src/overrides-sync.mts",
        "src/scenario-traces.mts",
        "src/root-runtime.mts",
        "src/root-fs.mts"
      ],
      thresholds: {
        perFile: true,
        statements: 100,
        lines: 100,
        functions: 100,
        branches: 100
      }
    }
  }
});
