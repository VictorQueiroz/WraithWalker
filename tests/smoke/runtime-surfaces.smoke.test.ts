import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";

import { createCanonicalFixtureRoot } from "../../test-support/canonical-fixture-root.mts";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

function readTextContent(result: unknown): string {
  if (
    !result ||
    typeof result !== "object" ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    throw new Error("Expected an MCP tool result with content.");
  }

  const textEntry = result.content.find(
    (entry): entry is { type: string; text?: string } =>
      Boolean(entry) &&
      typeof entry === "object" &&
      "type" in entry &&
      typeof entry.type === "string"
  );
  if (!textEntry?.text) {
    throw new Error("Expected text content.");
  }

  return textEntry.text;
}

async function importBuilt<T = Record<string, unknown>>(
  ...segments: string[]
): Promise<T> {
  return import(
    pathToFileURL(path.join(repoRoot, ...segments)).href
  ) as Promise<T>;
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

async function runNativeHost(input: Buffer): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, "packages/native-host/out/host.mjs")],
      {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
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
            `Native host exited with code ${code}: ${Buffer.concat(stderrChunks).toString("utf8")}`
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

describe("built runtime surfaces", () => {
  it("ships a complete extension dist with rewritten runtime imports", async () => {
    const extensionRoot = path.join(repoRoot, "packages/extension");
    const distRoot = path.join(extensionRoot, "dist");
    const requiredFiles = [
      "background.js",
      "offscreen.js",
      "popup.js",
      "options.js",
      "popup.html",
      "options.html",
      "app.css",
      "manifest.json",
      path.join("lib", "idb.js")
    ];

    await Promise.all(
      requiredFiles.map(async (relativePath) => {
        const stats = await fs.stat(path.join(distRoot, relativePath));
        expect(stats.isFile()).toBe(true);
      })
    );

    const [backgroundBundle, idbBundle, manifestSource, packageSource] =
      await Promise.all([
        fs.readFile(path.join(distRoot, "background.js"), "utf8"),
        fs.readFile(path.join(distRoot, "lib", "idb.js"), "utf8"),
        fs.readFile(path.join(distRoot, "manifest.json"), "utf8"),
        fs.readFile(path.join(extensionRoot, "package.json"), "utf8")
      ]);

    expect(backgroundBundle).not.toContain('"@trpc/client"');
    expect(idbBundle).not.toMatch(/from\s+["']idb["']/);
    expect(idbBundle).toContain('from "../vendor/idb.js"');
    expect(JSON.parse(manifestSource)).toEqual(
      expect.objectContaining({
        version: JSON.parse(packageSource).version
      })
    );
  });

  it("imports built core exports and exercises a root config flow", async () => {
    const { createRoot, readSentinel } = await importBuilt<{
      createRoot: (dir: string) => Promise<{ rootId: string }>;
      readSentinel: (dir: string) => Promise<{ rootId: string }>;
    }>("packages/core/out/root.mjs");
    const { readConfiguredSiteConfigs, writeConfiguredSiteConfigs } =
      await importBuilt<{
        readConfiguredSiteConfigs: (dir: string) => Promise<
          Array<{
            origin: string;
            createdAt: string;
            dumpAllowlistPatterns: string[];
          }>
        >;
        writeConfiguredSiteConfigs: (
          dir: string,
          siteConfigs: Array<{
            origin: string;
            createdAt: string;
            dumpAllowlistPatterns: string[];
          }>
        ) => Promise<unknown>;
      }>("packages/core/out/project-config.mjs");
    const rootPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "wraithwalker-core-smoke-")
    );
    const siteConfig = {
      origin: "app.example.com",
      createdAt: "2026-04-14T00:00:00.000Z",
      dumpAllowlistPatterns: ["\\.js$"]
    };

    const sentinel = await createRoot(rootPath);
    await writeConfiguredSiteConfigs(rootPath, [siteConfig]);

    await expect(readSentinel(rootPath)).resolves.toEqual(
      expect.objectContaining({ rootId: sentinel.rootId })
    );
    await expect(readConfiguredSiteConfigs(rootPath)).resolves.toEqual([
      {
        ...siteConfig,
        origin: "https://app.example.com"
      }
    ]);
  });

  it("runs the built CLI entrypoint successfully", async () => {
    const cliEntrypoint = path.join(repoRoot, "packages/cli/out/cli.mjs");
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cliEntrypoint, "--help"],
      {
        cwd: repoRoot
      }
    );
    const combinedOutput = `${stdout}\n${stderr}`;

    expect(combinedOutput).toContain("Usage: wraithwalker <command>");
    expect(combinedOutput).toContain("scenarios list");
  });

  it("serves built MCP tools against a canonical fixture root", async () => {
    const canonical = await createCanonicalFixtureRoot({
      rootId: "root-smoke-server"
    });
    const { startHttpServer } = await importBuilt<{
      startHttpServer: (
        rootPath: string,
        options?: { host?: string; port?: number }
      ) => Promise<{
        url: string;
        close(): Promise<void>;
      }>;
    }>("packages/mcp-server/out/server.mjs");
    const server = await startHttpServer(canonical.root.rootPath, {
      host: "127.0.0.1",
      port: 0
    });
    const client = new Client({
      name: "wraithwalker-smoke-client",
      version: "1.0.0"
    });
    const transport = new StreamableHTTPClientTransport(new URL(server.url));

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "list-sites",
        arguments: {}
      });

      expect(JSON.parse(readTextContent(result))).toEqual([
        expect.objectContaining({
          origin: canonical.siteConfig.origin,
          apiEndpoints: 1,
          staticAssets: 1
        })
      ]);
    } finally {
      await transport.close();
      await client.close();
      await server.close();
    }
  });

  it("runs the built native host for valid and invalid messages", async () => {
    const { createRoot } = await importBuilt<{
      createRoot: (dir: string) => Promise<{ rootId: string }>;
    }>("packages/core/out/root.mjs");
    const rootPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "wraithwalker-native-host-smoke-")
    );
    const sentinel = await createRoot(rootPath);

    await expect(
      runNativeHost(
        encodeNativeMessage({
          type: "verifyRoot",
          path: rootPath,
          expectedRootId: sentinel.rootId
        })
      )
    ).resolves.toEqual({
      ok: true,
      sentinel: expect.objectContaining({
        rootId: sentinel.rootId
      })
    });

    await expect(runNativeHost(Buffer.from("bad"))).resolves.toEqual({
      ok: false,
      error: "Native host expected a length-prefixed message."
    });
  });
});
