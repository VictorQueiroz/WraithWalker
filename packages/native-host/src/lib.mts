import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT_SENTINEL_RELATIVE_PATH = path.join(".wraithwalker", "root.json");
const SCENARIOS_DIR = path.join(".wraithwalker", "scenarios");

export interface RootSentinel {
  rootId: string;
  schemaVersion?: number;
  createdAt?: string;
}

export interface VerifyRootMessage {
  path?: string;
  expectedRootId?: string;
}

export interface OpenDirectoryMessage extends VerifyRootMessage {
  commandTemplate?: string;
}

export interface ScenarioMessage extends VerifyRootMessage {
  name?: string;
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export async function readSentinel(rootPath: string): Promise<RootSentinel> {
  const sentinelPath = path.join(rootPath, ROOT_SENTINEL_RELATIVE_PATH);
  const sentinelRaw = await fs.readFile(sentinelPath, "utf8");
  return JSON.parse(sentinelRaw) as RootSentinel;
}

export async function verifyRoot({ path: rootPath, expectedRootId }: VerifyRootMessage): Promise<{ ok: true; sentinel: RootSentinel }> {
  if (!rootPath) {
    throw new Error("Root path is required.");
  }

  if (!expectedRootId) {
    throw new Error("Expected root ID is required.");
  }

  const sentinel = await readSentinel(rootPath);
  if (sentinel.rootId !== expectedRootId) {
    throw new Error(`Sentinel root ID mismatch. Expected ${expectedRootId}, received ${sentinel.rootId}.`);
  }

  return { ok: true, sentinel };
}

export function substituteDirectory(commandTemplate: string | undefined, rootPath: string): string {
  if (!commandTemplate) {
    throw new Error("Command template is required.");
  }

  if (!commandTemplate.includes("$DIR")) {
    return `${commandTemplate} ${shellQuote(rootPath)}`;
  }

  return commandTemplate
    .replace(/"\$DIR"/g, shellQuote(rootPath))
    .replace(/'\$DIR'/g, shellQuote(rootPath))
    .replace(/\$DIR/g, shellQuote(rootPath));
}

export async function openDirectory({
  path: rootPath,
  expectedRootId,
  commandTemplate
}: OpenDirectoryMessage): Promise<{ ok: true; command: string }> {
  await verifyRoot({ path: rootPath, expectedRootId });
  const command = substituteDirectory(commandTemplate, rootPath as string);

  const child = spawn("/bin/sh", ["-lc", command], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  return { ok: true, command };
}

async function copyDirectoryRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function isScenarioSafe(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name);
}

/** Returns all top-level items in rootPath that are NOT the .wraithwalker directory. */
async function listFixtureEntries(rootPath: string): Promise<string[]> {
  const entries = await fs.readdir(rootPath);
  return entries.filter((e) => e !== ".wraithwalker");
}

export async function saveScenario({ path: rootPath, expectedRootId, name }: ScenarioMessage): Promise<{ ok: true; name: string }> {
  await verifyRoot({ path: rootPath, expectedRootId });
  if (!name || !isScenarioSafe(name)) {
    throw new Error("Scenario name must be 1-64 alphanumeric, hyphen, or underscore characters.");
  }

  const scenarioDir = path.join(rootPath!, SCENARIOS_DIR, name);
  await fs.rm(scenarioDir, { recursive: true, force: true });
  await fs.mkdir(scenarioDir, { recursive: true });

  const entries = await listFixtureEntries(rootPath!);
  for (const entry of entries) {
    await copyDirectoryRecursive(path.join(rootPath!, entry), path.join(scenarioDir, entry));
  }

  return { ok: true, name };
}

export async function switchScenario({ path: rootPath, expectedRootId, name }: ScenarioMessage): Promise<{ ok: true; name: string }> {
  await verifyRoot({ path: rootPath, expectedRootId });
  if (!name || !isScenarioSafe(name)) {
    throw new Error("Scenario name must be 1-64 alphanumeric, hyphen, or underscore characters.");
  }

  const scenarioDir = path.join(rootPath!, SCENARIOS_DIR, name);
  const stat = await fs.stat(scenarioDir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Scenario "${name}" does not exist.`);
  }

  // Remove current fixtures (but keep .wraithwalker)
  const currentEntries = await listFixtureEntries(rootPath!);
  for (const entry of currentEntries) {
    await fs.rm(path.join(rootPath!, entry), { recursive: true, force: true });
  }

  // Copy scenario back
  const scenarioEntries = await fs.readdir(scenarioDir);
  for (const entry of scenarioEntries) {
    await copyDirectoryRecursive(path.join(scenarioDir, entry), path.join(rootPath!, entry));
  }

  return { ok: true, name };
}

export async function listScenarios({ path: rootPath, expectedRootId }: VerifyRootMessage): Promise<{ ok: true; scenarios: string[] }> {
  await verifyRoot({ path: rootPath, expectedRootId });

  const scenariosBase = path.join(rootPath!, SCENARIOS_DIR);
  const exists = await fs.stat(scenariosBase).catch(() => null);
  if (!exists?.isDirectory()) {
    return { ok: true, scenarios: [] };
  }

  const entries = await fs.readdir(scenariosBase, { withFileTypes: true });
  const scenarios = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  return { ok: true, scenarios };
}
