import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { createCoverageConfig } from "../../test-support/coverage-config.ts";

export default defineConfig({
  resolve: {
    alias: {
      "@wraithwalker/core/fixture-layout": fileURLToPath(
        new URL("../core/src/fixture-layout.mts", import.meta.url)
      ),
      "@wraithwalker/core/har-import": fileURLToPath(
        new URL("../core/src/har-import.mts", import.meta.url)
      ),
      "@wraithwalker/core/overrides-sync": fileURLToPath(
        new URL("../core/src/overrides-sync.mts", import.meta.url)
      ),
      "@wraithwalker/core/project-config": fileURLToPath(
        new URL("../core/src/project-config.mts", import.meta.url)
      ),
      "@wraithwalker/core/root": fileURLToPath(
        new URL("../core/src/root.mts", import.meta.url)
      ),
      "@wraithwalker/core/root-fs": fileURLToPath(
        new URL("../core/src/root-fs.mts", import.meta.url)
      ),
      "@wraithwalker/core/fixtures": fileURLToPath(
        new URL("../core/src/fixtures.mts", import.meta.url)
      ),
      "@wraithwalker/core/site-config": fileURLToPath(
        new URL("../core/src/site-config.mts", import.meta.url)
      ),
      "@wraithwalker/core/scenarios": fileURLToPath(
        new URL("../core/src/scenarios.mts", import.meta.url)
      ),
      "@wraithwalker/core/context": fileURLToPath(
        new URL("../core/src/context.mts", import.meta.url)
      ),
      "@wraithwalker/mcp-server/server": fileURLToPath(
        new URL("../mcp-server/src/server.mts", import.meta.url)
      )
    }
  },
  test: {
    environment: "node",
    coverage: createCoverageConfig({
      include: ["src/**/*.mts"],
      exclude: ["src/**/*.d.mts"],
      thresholds: {
        statements: 92,
        lines: 92,
        functions: 94,
        branches: 89
      }
    })
  }
});
