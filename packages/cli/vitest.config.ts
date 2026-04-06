import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@wraithwalker/core/fixture-layout": fileURLToPath(new URL("../core/src/fixture-layout.mts", import.meta.url)),
      "@wraithwalker/core/har-import": fileURLToPath(new URL("../core/src/har-import.mts", import.meta.url)),
      "@wraithwalker/core/overrides-sync": fileURLToPath(new URL("../core/src/overrides-sync.mts", import.meta.url)),
      "@wraithwalker/core/root": fileURLToPath(new URL("../core/src/root.mts", import.meta.url)),
      "@wraithwalker/core/root-fs": fileURLToPath(new URL("../core/src/root-fs.mts", import.meta.url)),
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
      include: [
        "src/commands/sync.mts",
        "src/commands/import-har.mts",
        "src/lib/plain-output.mts",
        "src/lib/themed-output.mts"
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
