import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { build as buildEsbuild } from "esbuild";
import path from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import {
  type CopySpec,
  createBuildPaths,
  createDistRuntimeCopies,
  createStaticExtensionCopies,
  ROOT_RUNTIME_FILES,
  rewriteCoreFixtureLayoutSpecifiers,
  rewriteIdbSpecifiers
} from "./build-lib.js";

const execFileAsync = promisify(execFile);

const ROOT = process.cwd();
const REPO_ROOT = path.resolve(ROOT, "../..");
const require = createRequire(path.join(ROOT, "package.json"));
const TSC_PATH = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const PATHS = createBuildPaths(ROOT);
const NPM_PATH = process.platform === "win32" ? "npm.cmd" : "npm";
const NPX_PATH = process.platform === "win32" ? "npx.cmd" : "npx";

async function runTsc(configPath) {
  await execFileAsync(process.execPath, [TSC_PATH, "-p", configPath], {
    cwd: ROOT
  });
}

async function buildCoreFixtureLayout() {
  await execFileAsync(NPM_PATH, ["run", "build", "--workspace", "@wraithwalker/core"], {
    cwd: REPO_ROOT
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
  await buildCoreFixtureLayout();
  await fs.rm(PATHS.emitDir, { recursive: true, force: true });
  await runTsc(path.join(ROOT, "tsconfig.build.json"));
  await buildEsbuild({
    bundle: true,
    entryPoints: {
      popup: path.join(ROOT, "src", "popup.ts"),
      options: path.join(ROOT, "src", "options.ts")
    },
    format: "esm",
    legalComments: "none",
    logLevel: "silent",
    outdir: PATHS.emitDir,
    platform: "browser",
    sourcemap: false,
    target: ["chrome118"]
  });
}

async function rewriteIdbImports(distLibDir: string) {
  const idbFile = path.join(distLibDir, "idb.js");
  const content = await fs.readFile(idbFile, "utf-8");
  await fs.writeFile(idbFile, rewriteIdbSpecifiers(content), "utf-8");
}

async function rewriteCoreFixtureLayoutImports() {
  for (const fileName of ROOT_RUNTIME_FILES) {
    const filePath = path.join(PATHS.distDir, fileName);
    const content = await fs.readFile(filePath, "utf-8");
    await fs.writeFile(
      filePath,
      rewriteCoreFixtureLayoutSpecifiers(content, "./vendor/wraithwalker-core/fixture-layout.js"),
      "utf-8"
    );
  }

  for (const entry of await fs.readdir(path.join(PATHS.distDir, "lib"))) {
    if (!entry.endsWith(".js")) {
      continue;
    }

    const filePath = path.join(PATHS.distDir, "lib", entry);
    const content = await fs.readFile(filePath, "utf-8");
    await fs.writeFile(
      filePath,
      rewriteCoreFixtureLayoutSpecifiers(content, "../vendor/wraithwalker-core/fixture-layout.js"),
      "utf-8"
    );
  }
}

async function buildDist() {
  await fs.rm(PATHS.distDir, { recursive: true, force: true });
  await ensureDir(PATHS.distDir);

  await copyFiles(createStaticExtensionCopies(PATHS));
  await copyFiles(createDistRuntimeCopies(PATHS));
  await copyDirectory(PATHS.libEmitDir, path.join(PATHS.distDir, "lib"));
  await ensureDir(PATHS.distVendorDir);
  await copyFile(PATHS.vendorSource, PATHS.distVendorFile);
  await copyFile(PATHS.coreFixtureLayoutSource, PATHS.distVendorCoreFixtureLayoutFile);
  await rewriteIdbImports(path.join(PATHS.distDir, "lib"));
  await rewriteCoreFixtureLayoutImports();

  await execFileAsync(NPX_PATH, [
    "@tailwindcss/cli",
    "-i",
    PATHS.uiStylesSource,
    "-o",
    PATHS.distCssFile,
    "--minify"
  ], {
    cwd: ROOT
  });
}

async function main() {
  await buildRuntime();
  await buildDist();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
