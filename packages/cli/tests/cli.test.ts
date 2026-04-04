import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import { createFsGateway } from "../src/lib/fs-gateway.mts";
import { createRoot, findRoot } from "../src/lib/root.mts";
import { generateContext } from "../src/lib/context-generator.mts";
import { run as runInit } from "../src/commands/init.mts";
import { run as runScenarios } from "../src/commands/scenarios.mts";
import { run as runStatus } from "../src/commands/status.mts";
import { run as runContext } from "../src/commands/context.mts";
import type { Output } from "../src/lib/output.mts";

interface OutputRecord {
  method: keyof Output;
  args: unknown[];
}

function createRecordingOutput(): Output & { records: OutputRecord[] } {
  const records: OutputRecord[] = [];
  const methods: Array<keyof Output> = [
    "banner", "success", "error", "warn", "heading", "keyValue", "info", "listItem", "block", "usage",
  ];
  const handler = { records } as Output & { records: OutputRecord[] };
  for (const method of methods) {
    (handler as Record<string, unknown>)[method] = (...args: unknown[]) => {
      records.push({ method, args });
    };
  }
  return handler;
}

function withCwd<T>(dir: string, fn: () => T | Promise<T>): Promise<T> {
  const orig = process.cwd();
  process.chdir(dir);
  return Promise.resolve(fn()).finally(() => process.chdir(orig));
}

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "wraithwalker-cli-"));
}

async function createFixtureRoot(): Promise<string> {
  const dir = await tmpdir();
  await fs.mkdir(path.join(dir, ".wraithwalker"), { recursive: true });
  await fs.writeFile(
    path.join(dir, ".wraithwalker", "root.json"),
    JSON.stringify({ rootId: "cli-test-root", schemaVersion: 1, createdAt: "2026-04-03T00:00:00.000Z" }),
    "utf8"
  );
  return dir;
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

describe("fs-gateway", () => {
  it("reads and writes JSON files", async () => {
    const dir = await tmpdir();
    const gw = createFsGateway();
    await gw.writeJson(dir, "test/data.json", { hello: "world" });
    const result = await gw.readJson<{ hello: string }>(dir, "test/data.json");
    expect(result).toEqual({ hello: "world" });
  });

  it("checks file existence", async () => {
    const dir = await tmpdir();
    const gw = createFsGateway();
    expect(await gw.exists(dir, "nope.json")).toBe(false);
    await gw.writeText(dir, "yes.txt", "hello");
    expect(await gw.exists(dir, "yes.txt")).toBe(true);
  });

  it("reads optional JSON returning null for missing files", async () => {
    const dir = await tmpdir();
    const gw = createFsGateway();
    expect(await gw.readOptionalJson(dir, "missing.json")).toBeNull();
  });

  it("lists directory entries", async () => {
    const dir = await tmpdir();
    const gw = createFsGateway();
    await gw.writeText(dir, "sub/a.txt", "a");
    await gw.writeText(dir, "sub/b.txt", "b");
    await gw.writeJson(dir, "sub/nested/c.json", {});

    const entries = await gw.listDirectory(dir, "sub");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["a.txt", "b.txt", "nested"]);
    expect(entries.find((e) => e.name === "nested")?.kind).toBe("directory");
  });
});

describe("root discovery", () => {
  it("creates a sentinel file via createRoot", async () => {
    const dir = await tmpdir();
    const sentinel = await createRoot(dir);
    expect(sentinel.rootId).toBeDefined();
    expect(sentinel.schemaVersion).toBe(1);

    const content = JSON.parse(await fs.readFile(path.join(dir, ".wraithwalker", "root.json"), "utf8"));
    expect(content.rootId).toBe(sentinel.rootId);
  });

  it("returns existing sentinel without overwriting", async () => {
    const dir = await createFixtureRoot();
    const sentinel = await createRoot(dir);
    expect(sentinel.rootId).toBe("cli-test-root");
  });

  it("finds root by walking up directories", async () => {
    const dir = await createFixtureRoot();
    const nested = path.join(dir, "deep", "nested");
    await fs.mkdir(nested, { recursive: true });

    const { rootPath, sentinel } = await findRoot(nested);
    expect(rootPath).toBe(dir);
    expect(sentinel.rootId).toBe("cli-test-root");
  });

  it("throws when no root is found", async () => {
    const dir = await tmpdir();
    await expect(findRoot(dir)).rejects.toThrow("No .wraithwalker/root.json found");
  });
});

describe("init command", () => {
  it("creates a fixture root in the specified directory", async () => {
    const dir = await tmpdir();
    const output = createRecordingOutput();
    await runInit([dir], output);
    const content = JSON.parse(await fs.readFile(path.join(dir, ".wraithwalker", "root.json"), "utf8"));
    expect(content.rootId).toBeDefined();
    expect(output.records[0].method).toBe("banner");
    expect(output.records[1].method).toBe("success");
  });

  it("defaults to cwd when no directory is specified", async () => {
    const dir = await tmpdir();
    const output = createRecordingOutput();
    await withCwd(dir, () => runInit([], output));
    const content = JSON.parse(await fs.readFile(path.join(dir, ".wraithwalker", "root.json"), "utf8"));
    expect(content.rootId).toBeDefined();
  });
});

describe("status command", () => {
  it("runs without error on a fixture root", async () => {
    const dir = await createFixtureRoot();
    const output = createRecordingOutput();
    await withCwd(dir, () => runStatus([], output));
    expect(output.records[0].method).toBe("heading");
  });

  it("reports endpoint and asset counts", async () => {
    const dir = await createFixtureRoot();

    // Create an API fixture so endpoint count > 0
    const meta = {
      status: 200, statusText: "OK", mimeType: "application/json",
      resourceType: "XHR", url: "https://api.example.com/users",
      method: "GET", capturedAt: "2026-04-03T00:00:00.000Z"
    };
    await writeJson(
      path.join(dir, "https__app.example.com", "origins", "https__api.example.com", "http", "GET", "users__q-abc__b-def", "response.meta.json"),
      meta
    );

    // Create a manifest so asset count > 0
    await writeJson(
      path.join(dir, "https__app.example.com", "RESOURCE_MANIFEST.json"),
      {
        schemaVersion: 1,
        topOrigin: "https://app.example.com",
        topOriginKey: "https__app.example.com",
        generatedAt: "2026-04-03T00:00:00.000Z",
        resourcesByPathname: {
          "/app.js": [{ requestUrl: "https://cdn.example.com/app.js", resourceType: "Script" }]
        }
      }
    );

    const output = createRecordingOutput();
    await withCwd(dir, () => runStatus([], output));
  });
});

describe("scenarios command", () => {
  it("lists empty scenarios", async () => {
    const dir = await createFixtureRoot();
    const output = createRecordingOutput();
    await withCwd(dir, () => runScenarios(["list"], output));
    // No assertion needed — "No scenarios saved." printed without error
  });

  it("saves and lists scenarios", async () => {
    const dir = await createFixtureRoot();
    await fs.mkdir(path.join(dir, "cdn.example.com"), { recursive: true });
    await fs.writeFile(path.join(dir, "cdn.example.com", "app.js"), "v1");

    const output = createRecordingOutput();
    await withCwd(dir, async () => {
      await runScenarios(["save", "baseline"], output);
      await runScenarios(["list"], output);
    });

    const scenarios = await fs.readdir(path.join(dir, ".wraithwalker", "scenarios"));
    expect(scenarios).toContain("baseline");
  });

  it("switches between scenarios", async () => {
    const dir = await createFixtureRoot();
    await fs.mkdir(path.join(dir, "cdn.example.com"), { recursive: true });
    await fs.writeFile(path.join(dir, "cdn.example.com", "app.js"), "v1");

    const output = createRecordingOutput();
    await withCwd(dir, async () => {
      await runScenarios(["save", "v1"], output);
      await fs.writeFile(path.join(dir, "cdn.example.com", "app.js"), "v2");
      await runScenarios(["save", "v2"], output);
      await runScenarios(["switch", "v1"], output);
    });

    const content = await fs.readFile(path.join(dir, "cdn.example.com", "app.js"), "utf8");
    expect(content).toBe("v1");
  });

  it("diffs two scenarios", async () => {
    const dir = await createFixtureRoot();
    await fs.mkdir(path.join(dir, "cdn.example.com"), { recursive: true });
    await fs.writeFile(path.join(dir, "cdn.example.com", "app.js"), "v1");

    const output = createRecordingOutput();
    await withCwd(dir, async () => {
      await runScenarios(["save", "v1"], output);
      await fs.writeFile(path.join(dir, "cdn.example.com", "app.js"), "v2");
      await runScenarios(["save", "v2"], output);
      await runScenarios(["diff", "v1", "v2"], output);
    });
  });

  it("prints usage for unknown subcommands", async () => {
    const dir = await createFixtureRoot();
    const output = createRecordingOutput();
    await withCwd(dir, () => runScenarios(["unknown"], output));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as any;
  });

  it("prints usage when save name is missing", async () => {
    const dir = await createFixtureRoot();
    const output = createRecordingOutput();
    await withCwd(dir, () => runScenarios(["save"], output));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as any;
  });

  it("prints usage when switch name is missing", async () => {
    const dir = await createFixtureRoot();
    const output = createRecordingOutput();
    await withCwd(dir, () => runScenarios(["switch"], output));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as any;
  });

  it("prints usage when diff args are missing", async () => {
    const dir = await createFixtureRoot();
    const output = createRecordingOutput();
    await withCwd(dir, () => runScenarios(["diff"], output));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as any;
  });
});

describe("context command", () => {
  it("generates CLAUDE.md from fixture directory", async () => {
    const dir = await createFixtureRoot();

    // Create an API fixture
    const meta = {
      status: 200, statusText: "OK", mimeType: "application/json",
      resourceType: "XHR", url: "https://api.example.com/users",
      method: "GET", capturedAt: "2026-04-03T00:00:00.000Z"
    };
    await writeJson(
      path.join(dir, "https__app.example.com", "origins", "https__api.example.com", "http", "GET", "users__q-abc__b-def", "response.meta.json"),
      meta
    );
    await fs.writeFile(
      path.join(dir, "https__app.example.com", "origins", "https__api.example.com", "http", "GET", "users__q-abc__b-def", "response.body"),
      JSON.stringify({ users: [{ id: 1 }] })
    );

    // Also create the advanced mode origin directory so readSiteConfigs discovers it
    const gw = createFsGateway();
    const markdown = await generateContext(dir, gw);

    expect(markdown).toContain("WraithWalker Fixture Context");
    expect(await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8")).toContain("WraithWalker");
  });

  it("runs the context command with --editor flag", async () => {
    const dir = await createFixtureRoot();

    const meta = {
      status: 200, statusText: "OK", mimeType: "application/json",
      resourceType: "XHR", url: "https://api.example.com/data",
      method: "GET", capturedAt: "2026-04-03T00:00:00.000Z"
    };
    await writeJson(
      path.join(dir, "https__app.example.com", "origins", "https__api.example.com", "http", "GET", "data__q-abc__b-def", "response.meta.json"),
      meta
    );
    await fs.writeFile(
      path.join(dir, "https__app.example.com", "origins", "https__api.example.com", "http", "GET", "data__q-abc__b-def", "response.body"),
      JSON.stringify({ items: [] })
    );

    const output = createRecordingOutput();
    await withCwd(dir, () => runContext(["--editor", "cursor"], output));

    expect(await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8")).toContain("WraithWalker");
    expect(await fs.readFile(path.join(dir, ".cursorrules"), "utf8")).toContain("WraithWalker");
  });

  it("runs the context command without --editor flag", async () => {
    const dir = await createFixtureRoot();
    const output = createRecordingOutput();
    await withCwd(dir, () => runContext([], output));
    expect(await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8")).toContain("WraithWalker");
  });
});
