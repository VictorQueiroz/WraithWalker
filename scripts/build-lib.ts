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
export const NATIVE_HOST_OUTPUTS = ["host.mjs", "lib.mjs"] as const;

export interface BuildPaths {
  rootDir: string;
  extensionDir: string;
  emitDir: string;
  distDir: string;
  libEmitDir: string;
  nodeEmitDir: string;
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
  const extensionDir = path.join(rootDir, "extension");

  return {
    rootDir,
    extensionDir,
    emitDir,
    distDir,
    libEmitDir: path.join(emitDir, "lib"),
    nodeEmitDir: path.join(emitDir, "native-host"),
    vendorSource: path.join(rootDir, "node_modules", "idb", "build", "index.js"),
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
    sourcePath: path.join(paths.extensionDir, fileName),
    targetPath: path.join(paths.distDir, fileName)
  }));
}

export function createNativeHostCopies(paths: BuildPaths): CopySpec[] {
  return NATIVE_HOST_OUTPUTS.map((fileName) => ({
    sourcePath: path.join(paths.nodeEmitDir, fileName),
    targetPath: path.join(paths.rootDir, "native-host", fileName)
  }));
}
