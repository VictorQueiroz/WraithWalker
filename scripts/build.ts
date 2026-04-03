import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  type CopySpec,
  createBuildPaths,
  createDistRuntimeCopies,
  createNativeHostCopies,
  createStaticExtensionCopies
} from "./build-lib.js";

const execFileAsync = promisify(execFile);

const ROOT = process.cwd();
const TSC_PATH = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
const PATHS = createBuildPaths(ROOT);

async function runTsc(configPath) {
  await execFileAsync(process.execPath, [TSC_PATH, "-p", configPath], {
    cwd: ROOT
  });
}

async function ensureDir(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true });
}

async function copyFile(sourcePath, targetPath) {
  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
}

async function copyDirectory(sourcePath, targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
  await ensureDir(path.dirname(targetPath));
  await fs.cp(sourcePath, targetPath, { recursive: true });
}

async function copyFiles(copySpecs: CopySpec[]) {
  for (const copySpec of copySpecs) {
    await copyFile(copySpec.sourcePath, copySpec.targetPath);
  }
}

async function buildRuntime() {
  await fs.rm(PATHS.emitDir, { recursive: true, force: true });

  await runTsc(path.join(ROOT, "tsconfig.build.lib.json"));
  await runTsc(path.join(ROOT, "tsconfig.build.node.json"));
  await copyFiles(createNativeHostCopies(PATHS));

  await fs.chmod(path.join(ROOT, "native-host", "host.mjs"), 0o755);
}

async function buildDist() {
  await fs.rm(PATHS.distDir, { recursive: true, force: true });
  await ensureDir(PATHS.distDir);

  await copyFiles(createStaticExtensionCopies(PATHS));
  await copyFiles(createDistRuntimeCopies(PATHS));
  await copyDirectory(PATHS.libEmitDir, path.join(PATHS.distDir, "lib"));
  await ensureDir(PATHS.distVendorDir);
  await copyFile(PATHS.vendorSource, PATHS.distVendorFile);
}

async function main() {
  await buildRuntime();
  await buildDist();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
