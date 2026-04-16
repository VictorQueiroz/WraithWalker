import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

type WorkspacePackageName = "core" | "mcp-server";

const workspacePackageSrcDirs: Record<WorkspacePackageName, string> = {
  core: `${fileURLToPath(new URL("../packages/core/src/", import.meta.url))}`,
  "mcp-server": `${fileURLToPath(
    new URL("../packages/mcp-server/src/", import.meta.url)
  )}`
};

function normalizeResolvedId(id: string): string {
  return id.split("?")[0]!.replaceAll("\\", "/");
}

export function createWorkspacePackageAliases(
  packages: WorkspacePackageName[] = ["core"]
) {
  return packages.map((packageName) => ({
    find: new RegExp(`^@wraithwalker\\/${packageName}\\/(.+)$`),
    replacement: `${workspacePackageSrcDirs[packageName]}$1.mts`
  }));
}

export function preferMtsSourcePlugin(): Plugin {
  return {
    name: "prefer-mts-source",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !source.startsWith(".") || !source.endsWith(".mjs")) {
        return null;
      }

      const candidate = path
        .resolve(path.dirname(importer), source)
        .replace(/\.mjs$/, ".mts");
      return existsSync(candidate) ? candidate : null;
    }
  };
}

export function forbidCoreOutImportsPlugin(): Plugin {
  return {
    name: "forbid-core-out-imports",
    enforce: "pre",
    load(id) {
      if (normalizeResolvedId(id).includes("/packages/core/out/")) {
        throw new Error(
          `Unexpected test import resolved to packages/core/out: ${id}. Use workspace source aliases instead.`
        );
      }

      return null;
    }
  };
}

export function createWorkspaceSourcePlugins(): Plugin[] {
  return [preferMtsSourcePlugin(), forbidCoreOutImportsPlugin()];
}
