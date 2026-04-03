import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const idbPath = require.resolve("idb/build/index.js");

export default defineConfig({
  resolve: {
    alias: {
      "../vendor/idb.js": idbPath
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
        "src/lib/chrome-storage.ts",
        "src/lib/file-system-gateway.ts",
        "src/lib/fixture-mapper.ts",
        "src/lib/fixture-repository.ts",
        "src/lib/idb.ts",
        "src/lib/interception-middleware.ts",
        "src/lib/request-lifecycle.ts",
        "src/lib/root-handle.ts",
        "src/lib/session-controller.ts",
        "src/lib/storage-layout.ts"
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
