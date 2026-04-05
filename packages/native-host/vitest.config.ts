import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@wraithwalker/core/root": fileURLToPath(new URL("../core/src/root.mts", import.meta.url)),
      "@wraithwalker/core/fixtures": fileURLToPath(new URL("../core/src/fixtures.mts", import.meta.url)),
      "@wraithwalker/core/scenarios": fileURLToPath(new URL("../core/src/scenarios.mts", import.meta.url)),
      "@wraithwalker/core/context": fileURLToPath(new URL("../core/src/context.mts", import.meta.url))
    }
  },
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
