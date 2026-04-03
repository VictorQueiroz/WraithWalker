import { createRequire } from "node:module";
import path from "node:path";

export const ROOT_RUNTIME_FILES = ["background.js", "popup.js", "options.js", "offscreen.js"] as const;
export const STATIC_EXTENSION_FILES = [
  "manifest.json",
  "popup.html",
  "options.html",
  "offscreen.html",
  "app.css",
  "assets/logo.svg",
  "assets/icons/icon-16.png",
  "assets/icons/icon-32.png",
  "assets/icons/icon-48.png",
  "assets/icons/icon-128.png"
] as const;

export interface BuildPaths {
  rootDir: string;
  staticDir: string;
  emitDir: string;
  distDir: string;
  libEmitDir: string;
  vendorSource: string;
  distVendorDir: string;
  distVendorFile: string;
}

export interface CopySpec {
  sourcePath: string;
  targetPath: string;
}

export function createBuildPaths(rootDir: string): BuildPaths {
  const emitDir = path.join(rootDir, ".ts-emit");
  const distDir = path.join(rootDir, "dist");
  const staticDir = path.join(rootDir, "static");

  const require = createRequire(path.join(rootDir, "package.json"));
  const vendorSource = require.resolve("idb/build/index.js");

  return {
    rootDir,
    staticDir,
    emitDir,
    distDir,
    libEmitDir: path.join(emitDir, "lib"),
    vendorSource,
    distVendorDir: path.join(distDir, "vendor"),
    distVendorFile: path.join(distDir, "vendor", "idb.js")
  };
}

export function createDistRuntimeCopies(paths: BuildPaths): CopySpec[] {
  return ROOT_RUNTIME_FILES.map((fileName) => ({
    sourcePath: path.join(paths.emitDir, fileName),
    targetPath: path.join(paths.distDir, fileName)
  }));
}

export function createStaticExtensionCopies(paths: BuildPaths): CopySpec[] {
  return STATIC_EXTENSION_FILES.map((fileName) => ({
    sourcePath: path.join(paths.staticDir, fileName),
    targetPath: path.join(paths.distDir, fileName)
  }));
}
