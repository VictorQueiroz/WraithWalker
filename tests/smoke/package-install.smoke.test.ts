import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, describe, expect, it } from "vitest";

import { createCanonicalFixtureRoot } from "../../test-support/canonical-fixture-root.mts";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const cliBinaryName =
  process.platform === "win32" ? "wraithwalker.cmd" : "wraithwalker";
const EXEC_BUFFER_BYTES = 20 * 1024 * 1024;

const PACKAGE_SPECS = {
  core: {
    packageName: "@wraithwalker/core",
    packageDir: path.join(repoRoot, "packages/core"),
    tarballName: "wraithwalker-core",
    expectedFiles: [
      "package.json",
      "README.md",
      "out/root.mjs",
      "out/project-config.mjs"
    ]
  },
  mcpServer: {
    packageName: "@wraithwalker/mcp-server",
    packageDir: path.join(repoRoot, "packages/mcp-server"),
    tarballName: "wraithwalker-mcp-server",
    expectedFiles: [
      "package.json",
      "README.md",
      "out/server.mjs",
      "out/bin.mjs"
    ]
  },
  nativeHost: {
    packageName: "@wraithwalker/native-host",
    packageDir: path.join(repoRoot, "packages/native-host"),
    tarballName: "wraithwalker-native-host",
    expectedFiles: [
      "package.json",
      "README.md",
      "out/lib.mjs",
      "out/host.mjs",
      "host-manifest.template.json"
    ]
  },
  cli: {
    packageName: "@wraithwalker/cli",
    packageDir: path.join(repoRoot, "packages/cli"),
    tarballName: "wraithwalker-cli",
    expectedFiles: ["package.json", "README.md", "out/cli.mjs"]
  }
} as const;

type PackageKey = keyof typeof PACKAGE_SPECS;

interface PackedTarballJson {
  name: string;
  version: string;
  filename: string;
  files: Array<{ path: string }>;
}

interface PackedPackage {
  packageName: string;
  version: string;
  tarballPath: string;
  files: Set<string>;
}

interface PackedWorkspacePackages {
  tarballDir: string;
  packages: Record<PackageKey, PackedPackage>;
}

interface PackageLockEntry {
  resolved?: string;
  version?: string;
}

interface PackageLock {
  packages?: Record<string, PackageLockEntry>;
}

const INSTALLED_CORE_SMOKE_SCRIPT = String.raw`
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { createRoot, readSentinel } from "@wraithwalker/core/root";
import {
  readConfiguredSiteConfigs,
  writeConfiguredSiteConfigs
} from "@wraithwalker/core/project-config";

const rootPath = await mkdtemp(path.join(os.tmpdir(), "wraithwalker-pack-core-"));
const sentinel = await createRoot(rootPath);

await writeConfiguredSiteConfigs(rootPath, [
  {
    origin: "app.example.com",
    createdAt: "2026-04-14T00:00:00.000Z",
    dumpAllowlistPatterns: ["\\.js$"]
  }
]);

process.stdout.write(
  JSON.stringify({
    sentinel,
    nextSentinel: await readSentinel(rootPath),
    siteConfigs: await readConfiguredSiteConfigs(rootPath)
  })
);
`;

const INSTALLED_MCP_SERVER_SMOKE_SCRIPT = String.raw`
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { startHttpServer } from "@wraithwalker/mcp-server/server";

function readTextContent(result) {
  if (
    !result ||
    typeof result !== "object" ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    throw new Error("Expected an MCP tool result with content.");
  }

  const textEntry = result.content.find(
    (entry) =>
      Boolean(entry) &&
      typeof entry === "object" &&
      "type" in entry &&
      typeof entry.type === "string"
  );
  if (!textEntry || typeof textEntry.text !== "string") {
    throw new Error("Expected text content.");
  }

  return textEntry.text;
}

const server = await startHttpServer(process.env.WW_FIXTURE_ROOT, {
  host: "127.0.0.1",
  port: 0
});
const client = new Client({
  name: "wraithwalker-installed-mcp-server-smoke",
  version: "1.0.0"
});
const transport = new StreamableHTTPClientTransport(new URL(server.url));

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: "list-sites",
    arguments: {}
  });
  process.stdout.write(readTextContent(result));
} finally {
  await transport.close();
  await client.close();
  await server.close();
}
`;

const INSTALLED_NATIVE_HOST_LIBRARY_SMOKE_SCRIPT = String.raw`
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { createRoot } from "@wraithwalker/core/root";
import { verifyRoot } from "@wraithwalker/native-host/lib";

const rootPath = await mkdtemp(
  path.join(os.tmpdir(), "wraithwalker-pack-native-host-")
);
const sentinel = await createRoot(rootPath);
const result = await verifyRoot({
  path: rootPath,
  expectedRootId: sentinel.rootId
});

process.stdout.write(JSON.stringify({ rootPath, rootId: sentinel.rootId, result }));
`;

let packedPackagesPromise: Promise<PackedWorkspacePackages> | null = null;
let packedPackagesDir: string | null = null;

afterAll(async () => {
  if (packedPackagesDir) {
    await fs.rm(packedPackagesDir, { recursive: true, force: true });
  }
});

function packageLockKey(packageName: string): string {
  return `node_modules/${packageName}`;
}

async function packWorkspacePackage(
  tarballDir: string,
  spec: (typeof PACKAGE_SPECS)[PackageKey]
): Promise<PackedPackage> {
  const { stdout } = await execFileAsync(
    npmCommand,
    ["pack", "--json", "--pack-destination", tarballDir],
    {
      cwd: spec.packageDir,
      maxBuffer: EXEC_BUFFER_BYTES
    }
  );
  const [packInfo] = JSON.parse(stdout) as PackedTarballJson[];

  return {
    packageName: packInfo.name,
    version: packInfo.version,
    tarballPath: path.join(tarballDir, packInfo.filename),
    files: new Set(packInfo.files.map((entry) => entry.path))
  };
}

async function getPackedPackages(): Promise<PackedWorkspacePackages> {
  if (!packedPackagesPromise) {
    packedPackagesPromise = (async () => {
      const tarballDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "wraithwalker-packed-pkgs-")
      );

      try {
        const packages = {
          core: await packWorkspacePackage(tarballDir, PACKAGE_SPECS.core),
          mcpServer: await packWorkspacePackage(
            tarballDir,
            PACKAGE_SPECS.mcpServer
          ),
          nativeHost: await packWorkspacePackage(
            tarballDir,
            PACKAGE_SPECS.nativeHost
          ),
          cli: await packWorkspacePackage(tarballDir, PACKAGE_SPECS.cli)
        };

        packedPackagesDir = tarballDir;
        return {
          tarballDir,
          packages
        };
      } catch (error) {
        await fs.rm(tarballDir, { recursive: true, force: true });
        throw error;
      }
    })();
  }

  return packedPackagesPromise;
}

async function createTempInstallProject(prefix: string): Promise<string> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: path.basename(projectDir),
        private: true,
        type: "module"
      },
      null,
      2
    )
  );
  return projectDir;
}

async function installTarballs(
  projectDir: string,
  tarballPaths: string[]
): Promise<PackageLock> {
  await execFileAsync(
    npmCommand,
    ["install", "--no-fund", "--no-audit", "--loglevel=error", ...tarballPaths],
    {
      cwd: projectDir,
      maxBuffer: EXEC_BUFFER_BYTES
    }
  );

  return JSON.parse(
    await fs.readFile(path.join(projectDir, "package-lock.json"), "utf8")
  ) as PackageLock;
}

function assertExpectedPackedFiles(
  packedPackages: Record<PackageKey, PackedPackage>
): void {
  for (const key of Object.keys(PACKAGE_SPECS) as PackageKey[]) {
    const spec = PACKAGE_SPECS[key];
    const packed = packedPackages[key];

    expect(packed.packageName).toBe(spec.packageName);
    expect(packed.tarballPath).toContain(spec.tarballName);
    for (const expectedFile of spec.expectedFiles) {
      expect(
        packed.files.has(expectedFile),
        `${spec.packageName} tarball should contain ${expectedFile}`
      ).toBe(true);
    }
  }
}

function assertLocalWraithwalkerResolution(
  packageLock: PackageLock,
  packageNames: string[]
): void {
  for (const packageName of packageNames) {
    const entry = packageLock.packages?.[packageLockKey(packageName)];
    expect(entry).toBeDefined();
    expect(entry?.resolved).toMatch(/^file:/);
  }

  for (const [entryPath, entry] of Object.entries(packageLock.packages ?? {})) {
    if (!entryPath.includes("node_modules/@wraithwalker/")) {
      continue;
    }

    expect(entry.resolved).toMatch(/^file:/);
  }
}

async function runNodeSnippet(
  projectDir: string,
  source: string,
  env?: NodeJS.ProcessEnv
): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      cwd: projectDir,
      env: { ...process.env, ...env },
      maxBuffer: EXEC_BUFFER_BYTES
    }
  );
  return stdout.trim();
}

function encodeNativeMessage(payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function parseNativeMessage(output: Buffer): unknown {
  if (output.length < 4) {
    throw new Error(
      "Native host returned an incomplete length-prefixed payload."
    );
  }

  const messageLength = output.readUInt32LE(0);
  return JSON.parse(output.subarray(4, 4 + messageLength).toString("utf8"));
}

async function runInstalledNativeHostEntrypoint(
  projectDir: string,
  input: Buffer
): Promise<unknown> {
  const entrypointPath = path.join(
    projectDir,
    "node_modules",
    "@wraithwalker",
    "native-host",
    "out",
    "host.mjs"
  );

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypointPath], {
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Installed native host exited with code ${code}: ${Buffer.concat(stderrChunks).toString("utf8")}`
          )
        );
        return;
      }

      try {
        resolve(parseNativeMessage(Buffer.concat(stdoutChunks)));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(input);
  });
}

async function runInstalledCliHelp(projectDir: string): Promise<string> {
  const binaryPath = path.join(
    projectDir,
    "node_modules",
    ".bin",
    cliBinaryName
  );

  if (process.platform === "win32") {
    const { stdout, stderr } = await execFileAsync(
      "cmd",
      ["/d", "/s", "/c", `"${binaryPath}" --help`],
      {
        cwd: projectDir,
        maxBuffer: EXEC_BUFFER_BYTES
      }
    );
    return `${stdout}\n${stderr}`;
  }

  const { stdout, stderr } = await execFileAsync(binaryPath, ["--help"], {
    cwd: projectDir,
    maxBuffer: EXEC_BUFFER_BYTES
  });
  return `${stdout}\n${stderr}`;
}

describe("published package install smoke", () => {
  it("packs publishable workspace packages with the expected release files", async () => {
    const { packages } = await getPackedPackages();

    assertExpectedPackedFiles(packages);
  });

  it("installs and executes the published core tarball locally", async () => {
    const { packages } = await getPackedPackages();
    const projectDir = await createTempInstallProject(
      "wraithwalker-pack-install-core-"
    );

    try {
      const packageLock = await installTarballs(projectDir, [
        packages.core.tarballPath
      ]);
      assertLocalWraithwalkerResolution(packageLock, [
        packages.core.packageName
      ]);

      const result = JSON.parse(
        await runNodeSnippet(projectDir, INSTALLED_CORE_SMOKE_SCRIPT)
      ) as {
        sentinel: { rootId: string };
        nextSentinel: { rootId: string };
        siteConfigs: Array<{
          origin: string;
          createdAt: string;
          dumpAllowlistPatterns: string[];
        }>;
      };

      expect(result.nextSentinel.rootId).toBe(result.sentinel.rootId);
      expect(result.siteConfigs).toEqual([
        {
          origin: "https://app.example.com",
          createdAt: "2026-04-14T00:00:00.000Z",
          dumpAllowlistPatterns: ["\\.js$"]
        }
      ]);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it("installs and executes the published mcp-server tarball locally", async () => {
    const { packages } = await getPackedPackages();
    const projectDir = await createTempInstallProject(
      "wraithwalker-pack-install-mcp-server-"
    );
    const canonical = await createCanonicalFixtureRoot({
      rootId: "root-packed-mcp-server"
    });

    try {
      const packageLock = await installTarballs(projectDir, [
        packages.core.tarballPath,
        packages.mcpServer.tarballPath
      ]);
      assertLocalWraithwalkerResolution(packageLock, [
        packages.core.packageName,
        packages.mcpServer.packageName
      ]);

      const output = JSON.parse(
        await runNodeSnippet(projectDir, INSTALLED_MCP_SERVER_SMOKE_SCRIPT, {
          WW_FIXTURE_ROOT: canonical.root.rootPath
        })
      ) as Array<{
        origin: string;
        apiEndpoints: number;
        staticAssets: number;
      }>;

      expect(output).toEqual([
        expect.objectContaining({
          origin: canonical.siteConfig.origin,
          apiEndpoints: 1,
          staticAssets: 1
        })
      ]);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it("installs and executes the published native-host tarball locally", async () => {
    const { packages } = await getPackedPackages();
    const projectDir = await createTempInstallProject(
      "wraithwalker-pack-install-native-host-"
    );

    try {
      const packageLock = await installTarballs(projectDir, [
        packages.core.tarballPath,
        packages.nativeHost.tarballPath
      ]);
      assertLocalWraithwalkerResolution(packageLock, [
        packages.core.packageName,
        packages.nativeHost.packageName
      ]);

      const libraryResult = JSON.parse(
        await runNodeSnippet(
          projectDir,
          INSTALLED_NATIVE_HOST_LIBRARY_SMOKE_SCRIPT
        )
      ) as {
        rootPath: string;
        rootId: string;
        result: {
          ok: true;
          sentinel: { rootId: string };
        };
      };

      expect(libraryResult.result).toEqual({
        ok: true,
        sentinel: expect.objectContaining({
          rootId: libraryResult.rootId
        })
      });

      await expect(
        runInstalledNativeHostEntrypoint(
          projectDir,
          encodeNativeMessage({
            type: "verifyRoot",
            path: libraryResult.rootPath,
            expectedRootId: libraryResult.rootId
          })
        )
      ).resolves.toEqual({
        ok: true,
        sentinel: expect.objectContaining({
          rootId: libraryResult.rootId
        })
      });

      await expect(
        runInstalledNativeHostEntrypoint(projectDir, Buffer.from("bad"))
      ).resolves.toEqual({
        ok: false,
        error: "Native host expected a length-prefixed message."
      });
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it("installs and executes the published cli tarball locally", async () => {
    const { packages } = await getPackedPackages();
    const projectDir = await createTempInstallProject(
      "wraithwalker-pack-install-cli-"
    );

    try {
      const packageLock = await installTarballs(projectDir, [
        packages.core.tarballPath,
        packages.mcpServer.tarballPath,
        packages.cli.tarballPath
      ]);
      assertLocalWraithwalkerResolution(packageLock, [
        packages.core.packageName,
        packages.mcpServer.packageName,
        packages.cli.packageName
      ]);

      const output = await runInstalledCliHelp(projectDir);
      expect(output).toContain("Usage: wraithwalker <command>");
      expect(output).toContain("scenarios list");
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });
});
