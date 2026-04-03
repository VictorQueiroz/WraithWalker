import { defineConfig } from "vitest/config";

export default defineConfig({
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
        "src/lib/storage-layout.ts",
        "src/native-host/lib.mts"
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
