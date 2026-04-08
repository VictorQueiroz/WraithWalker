import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@wraithwalker/core/fixture-layout": fileURLToPath(new URL("../core/src/fixture-layout.mts", import.meta.url)),
      "@wraithwalker/core/root-runtime": fileURLToPath(new URL("../core/src/root-runtime.mts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "src/background.ts",
        "src/popup.ts",
        "src/options.ts",
        "src/offscreen.ts",
        "src/lib/background-helpers.ts",
        "src/lib/capture-policy.ts",
        "src/lib/context-generator.ts",
        "src/lib/chrome-storage.ts",
        "src/lib/editor-launch.ts",
        "src/lib/file-system-gateway.ts",
        "src/lib/fixture-mapper.ts",
        "src/lib/fixture-repository.ts",
        "src/lib/idb.ts",
        "src/lib/interception-middleware.ts",
        "src/lib/request-lifecycle.ts",
        "src/lib/root-runtime.ts",
        "src/lib/root-handle.ts",
        "src/lib/session-controller.ts",
        "src/lib/storage-layout.ts",
        "src/lib/type-extractor.ts",
        "src/ui/**/*.ts",
        "src/ui/**/*.tsx"
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
