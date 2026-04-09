import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { createCoverageConfig } from "../../test-support/coverage-config.ts";
import { preferMtsSourcePlugin } from "../../test-support/vitest-utils.ts";

const coreSrcDir = `${fileURLToPath(new URL("../core/src/", import.meta.url))}`;

export default defineConfig({
  plugins: [preferMtsSourcePlugin()],
  resolve: {
    alias: [
      {
        find: /^@wraithwalker\/core\/(.+)$/,
        replacement: `${coreSrcDir}$1.mts`
      }
    ]
  },
  test: {
    environment: "node",
    coverage: createCoverageConfig({
      include: ["src/**/*.{ts,tsx}"],
      thresholds: {
        statements: 90,
        lines: 90,
        functions: 95,
        branches: 80
      }
    })
  }
});
