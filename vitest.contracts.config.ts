import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { preferMtsSourcePlugin } from "./test-support/vitest-utils.ts";

const coreSrcDir = `${fileURLToPath(new URL("./packages/core/src/", import.meta.url))}`;
const mcpServerSrcDir = `${fileURLToPath(new URL("./packages/mcp-server/src/", import.meta.url))}`;

export default defineConfig({
  plugins: [preferMtsSourcePlugin()],
  resolve: {
    alias: [
      {
        find: /^@wraithwalker\/core\/(.+)$/,
        replacement: `${coreSrcDir}$1.mts`
      },
      {
        find: /^@wraithwalker\/mcp-server\/(.+)$/,
        replacement: `${mcpServerSrcDir}$1.mts`
      }
    ]
  },
  test: {
    include: ["tests/contracts/**/*.test.ts"],
    environment: "node"
  }
});
