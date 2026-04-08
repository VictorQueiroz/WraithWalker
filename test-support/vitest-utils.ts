import { existsSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

export function preferMtsSourcePlugin(): Plugin {
  return {
    name: "prefer-mts-source",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !source.startsWith(".") || !source.endsWith(".mjs")) {
        return null;
      }

      const candidate = path.resolve(path.dirname(importer), source).replace(/\.mjs$/, ".mts");
      return existsSync(candidate) ? candidate : null;
    }
  };
}
