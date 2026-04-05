import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@wraithwalker/core/root": fileURLToPath(new URL("../core/src/root.mts", import.meta.url)),
      "@wraithwalker/core/fixtures": fileURLToPath(new URL("../core/src/fixtures.mts", import.meta.url)),
      "@wraithwalker/core/scenarios": fileURLToPath(new URL("../core/src/scenarios.mts", import.meta.url)),
      "@wraithwalker/core/context": fileURLToPath(new URL("../core/src/context.mts", import.meta.url)),
      "@wraithwalker/mcp-server/server": fileURLToPath(new URL("../mcp-server/src/server.mts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.mts"],
      exclude: ["src/lib/output.mts"],
      thresholds: {
        statements: 65,
        lines: 65,
        functions: 85,
        branches: 60
      }
    }
  }
});
