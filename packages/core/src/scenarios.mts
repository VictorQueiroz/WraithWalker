import { promises as fs } from "node:fs";
import path from "node:path";

import { SCENARIOS_DIR } from "./constants.mjs";
import { readSentinel } from "./root.mjs";

export interface ScenarioRootOptions {
  path?: string;
  expectedRootId?: string;
}

export interface ScenarioOperationOptions extends ScenarioRootOptions {
  name?: string;
}

export interface EndpointRef {
  method: string;
  pathname: string;
  status: number;
  mimeType: string;
}

export interface EndpointChange {
  method: string;
  pathname: string;
  statusBefore: number;
  statusAfter: number;
  bodyChanged: boolean;
}

export interface FixtureDiff {
  scenarioA: string;
  scenarioB: string;
  added: EndpointRef[];
  removed: EndpointRef[];
  changed: EndpointChange[];
}

interface ResponseMeta {
  status: number;
  mimeType: string;
  url: string;
  method: string;
}

interface EndpointWithBody {
  key: string;
  method: string;
  pathname: string;
  status: number;
  mimeType: string;
  bodyContent: string | null;
}

async function verifyRootPath({ path: rootPath, expectedRootId }: ScenarioRootOptions): Promise<string> {
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

  return rootPath;
}

async function copyEntryRecursive(src: string, dest: string): Promise<void> {
  const stat = await fs.lstat(src);

  if (!stat.isDirectory()) {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    return;
  }

  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyEntryRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function isScenarioSafe(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name);
}

async function listFixtureEntries(rootPath: string): Promise<string[]> {
  const entries = await fs.readdir(rootPath);
  return entries.filter((entry) => entry !== ".wraithwalker");
}

async function listDirectoriesIn(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function scanOriginsTree(originsDir: string, endpoints: Map<string, EndpointWithBody>): Promise<void> {
  const originKeys = await listDirectoriesIn(originsDir);

  for (const originKey of originKeys) {
    const httpDir = path.join(originsDir, originKey, "http");
    const methods = await listDirectoriesIn(httpDir);

    for (const method of methods) {
      const fixtures = await listDirectoriesIn(path.join(httpDir, method));
      for (const fixture of fixtures) {
        const fixtureDir = path.join(httpDir, method, fixture);
        const meta = await readJsonSafe<ResponseMeta>(path.join(fixtureDir, "response.meta.json"));
        if (!meta) continue;

        const pathname = meta.url
          ? new URL(meta.url).pathname
          : fixture.replace(/__q-.*/, "").replace(/-/g, "/");
        const key = `${method} ${pathname}`;
        const bodyContent = await readFileSafe(path.join(fixtureDir, "response.body"));

        endpoints.set(key, {
          key,
          method,
          pathname,
          status: meta.status,
          mimeType: meta.mimeType || "",
          bodyContent
        });
      }
    }
  }
}

async function collectEndpointsFromScenario(scenarioPath: string): Promise<Map<string, EndpointWithBody>> {
  const endpoints = new Map<string, EndpointWithBody>();

  const topEntries = await listDirectoriesIn(scenarioPath);
  for (const topDir of topEntries) {
    if (topDir.startsWith(".")) continue;
    await scanOriginsTree(path.join(scenarioPath, topDir, "origins"), endpoints);
  }

  const simpleBase = path.join(scenarioPath, ".wraithwalker", "simple");
  const simpleOrigins = await listDirectoriesIn(simpleBase);
  for (const originKey of simpleOrigins) {
    await scanOriginsTree(path.join(simpleBase, originKey, "origins"), endpoints);
  }

  return endpoints;
}

export async function listScenarios(rootPath: string): Promise<string[]> {
  return listDirectoriesIn(path.join(rootPath, SCENARIOS_DIR));
}

export async function saveScenario({
  path: rootPath,
  expectedRootId,
  name
}: ScenarioOperationOptions): Promise<{ ok: true; name: string }> {
  const verifiedRootPath = await verifyRootPath({ path: rootPath, expectedRootId });
  if (!name || !isScenarioSafe(name)) {
    throw new Error("Scenario name must be 1-64 alphanumeric, hyphen, or underscore characters.");
  }

  const scenarioDir = path.join(verifiedRootPath, SCENARIOS_DIR, name);
  await fs.rm(scenarioDir, { recursive: true, force: true });
  await fs.mkdir(scenarioDir, { recursive: true });

  const entries = await listFixtureEntries(verifiedRootPath);
  for (const entry of entries) {
    await copyEntryRecursive(path.join(verifiedRootPath, entry), path.join(scenarioDir, entry));
  }

  return { ok: true, name };
}

export async function switchScenario({
  path: rootPath,
  expectedRootId,
  name
}: ScenarioOperationOptions): Promise<{ ok: true; name: string }> {
  const verifiedRootPath = await verifyRootPath({ path: rootPath, expectedRootId });
  if (!name || !isScenarioSafe(name)) {
    throw new Error("Scenario name must be 1-64 alphanumeric, hyphen, or underscore characters.");
  }

  const scenarioDir = path.join(verifiedRootPath, SCENARIOS_DIR, name);
  const scenarioStat = await fs.stat(scenarioDir).catch(() => null);
  if (!scenarioStat?.isDirectory()) {
    throw new Error(`Scenario "${name}" does not exist.`);
  }

  const currentEntries = await listFixtureEntries(verifiedRootPath);
  for (const entry of currentEntries) {
    await fs.rm(path.join(verifiedRootPath, entry), { recursive: true, force: true });
  }

  const scenarioEntries = await fs.readdir(scenarioDir);
  for (const entry of scenarioEntries) {
    await copyEntryRecursive(path.join(scenarioDir, entry), path.join(verifiedRootPath, entry));
  }

  return { ok: true, name };
}

export async function diffScenarios(rootPath: string, scenarioA: string, scenarioB: string): Promise<FixtureDiff> {
  const pathA = path.join(rootPath, SCENARIOS_DIR, scenarioA);
  const pathB = path.join(rootPath, SCENARIOS_DIR, scenarioB);

  const endpointsA = await collectEndpointsFromScenario(pathA);
  const endpointsB = await collectEndpointsFromScenario(pathB);

  const added: EndpointRef[] = [];
  const removed: EndpointRef[] = [];
  const changed: EndpointChange[] = [];

  for (const [key, endpointA] of endpointsA) {
    const endpointB = endpointsB.get(key);
    if (!endpointB) {
      removed.push({
        method: endpointA.method,
        pathname: endpointA.pathname,
        status: endpointA.status,
        mimeType: endpointA.mimeType
      });
      continue;
    }

    const statusChanged = endpointA.status !== endpointB.status;
    const bodyChanged = endpointA.bodyContent !== endpointB.bodyContent;
    if (statusChanged || bodyChanged) {
      changed.push({
        method: endpointA.method,
        pathname: endpointA.pathname,
        statusBefore: endpointA.status,
        statusAfter: endpointB.status,
        bodyChanged
      });
    }
  }

  for (const [key, endpointB] of endpointsB) {
    if (!endpointsA.has(key)) {
      added.push({
        method: endpointB.method,
        pathname: endpointB.pathname,
        status: endpointB.status,
        mimeType: endpointB.mimeType
      });
    }
  }

  return { scenarioA, scenarioB, added, removed, changed };
}

export function renderDiffMarkdown(diff: FixtureDiff): string {
  const lines: string[] = [];

  lines.push(`# Fixture Diff: ${diff.scenarioA} vs ${diff.scenarioB}`);
  lines.push("");

  if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
    lines.push("No differences found.");
    return lines.join("\n");
  }

  if (diff.added.length > 0) {
    lines.push("## Added Endpoints");
    lines.push("");
    for (const endpoint of diff.added) {
      lines.push(`- **${endpoint.method} ${endpoint.pathname}** (${endpoint.status}) — ${endpoint.mimeType}`);
    }
    lines.push("");
  }

  if (diff.removed.length > 0) {
    lines.push("## Removed Endpoints");
    lines.push("");
    for (const endpoint of diff.removed) {
      lines.push(`- **${endpoint.method} ${endpoint.pathname}** (${endpoint.status}) — ${endpoint.mimeType}`);
    }
    lines.push("");
  }

  if (diff.changed.length > 0) {
    lines.push("## Changed Endpoints");
    lines.push("");
    lines.push("| Method | Path | Status | Body Changed |");
    lines.push("|--------|------|--------|-------------|");
    for (const change of diff.changed) {
      const statusString = change.statusBefore === change.statusAfter
        ? String(change.statusBefore)
        : `${change.statusBefore} → ${change.statusAfter}`;
      lines.push(`| ${change.method} | ${change.pathname} | ${statusString} | ${change.bodyChanged ? "Yes" : "No"} |`);
    }
    lines.push("");
  }

  lines.push(`Summary: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`);
  return lines.join("\n");
}
