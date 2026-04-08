import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
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
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.mts"],
      thresholds: {
        statements: 90,
        lines: 90,
        functions: 95,
        branches: 75
      }
    }
  }
});
