import path from "node:path";

import {
  CAPTURES_DIR,
  CAPTURE_HTTP_DIR,
  MANIFESTS_DIR,
  SCENARIOS_DIR,
  WRAITHWALKER_DIR
} from "./constants.mjs";
import type { ResponseMeta } from "./fixture-layout.mjs";
import { readSentinel } from "./root.mjs";
import { createFixtureRootFs, type FixtureRootFs } from "./root-fs.mjs";

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

function isScenarioSafe(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name);
}

function validateScenarioName(name: string | undefined): string {
  if (!name || !isScenarioSafe(name)) {
    throw new Error("Scenario name must be 1-64 alphanumeric, hyphen, or underscore characters.");
  }

  return name;
}

async function requireScenarioDir(rootPath: string, name: string | undefined): Promise<string> {
  const scenarioName = validateScenarioName(name);
  const scenarioDir = path.join(SCENARIOS_DIR, scenarioName);
  const scenarioStat = await createFixtureRootFs(rootPath).stat(scenarioDir);
  if (!scenarioStat?.isDirectory()) {
    throw new Error(`Scenario "${scenarioName}" does not exist.`);
  }

  return scenarioDir;
}

async function listFixtureEntries(rootFs: FixtureRootFs): Promise<string[]> {
  const entries = await rootFs.listOptionalDirectory("");
  return entries
    .filter((entry) => entry.name !== ".wraithwalker")
    .map((entry) => entry.name);
}

async function listScenarioMetadataEntries(rootFs: FixtureRootFs): Promise<string[]> {
  const entries = await rootFs.listOptionalDirectory(WRAITHWALKER_DIR);
  return entries
    .filter((entry) => entry.kind === "directory")
    .filter((entry) => entry.name === "captures" || entry.name === "manifests")
    .map((entry) => path.join(WRAITHWALKER_DIR, entry.name));
}

async function scanOriginsTree(
  rootFs: FixtureRootFs,
  originsDir: string,
  endpoints: Map<string, EndpointWithBody>
): Promise<void> {
  const originKeys = await rootFs.listOptionalDirectories(originsDir);

  for (const originKey of originKeys) {
    const httpDir = path.join(originsDir, originKey, "http");
    const methods = await rootFs.listOptionalDirectories(httpDir);

    for (const method of methods) {
      const fixtures = await rootFs.listOptionalDirectories(path.join(httpDir, method));
      for (const fixture of fixtures) {
        const fixtureDir = path.join(httpDir, method, fixture);
        const meta = await rootFs.readOptionalJson<ResponseMeta>(path.join(fixtureDir, "response.meta.json"));
        if (!meta) continue;

        const pathname = meta.url
          ? new URL(meta.url).pathname
          : fixture.replace(/__q-.*/, "").replace(/-/g, "/");
        const key = `${method} ${pathname}`;
        const bodyContent = await rootFs.readOptionalText(path.join(fixtureDir, "response.body"));

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

async function collectEndpointsFromScenario(
  rootFs: FixtureRootFs,
  scenarioPath: string
): Promise<Map<string, EndpointWithBody>> {
  const endpoints = new Map<string, EndpointWithBody>();

  const captureBase = path.join(scenarioPath, CAPTURE_HTTP_DIR);
  const captureOrigins = await rootFs.listOptionalDirectories(captureBase);
  for (const originKey of captureOrigins) {
    await scanOriginsTree(rootFs, path.join(captureBase, originKey, "origins"), endpoints);
  }

  return endpoints;
}

export async function listScenarios(rootPath: string): Promise<string[]> {
  return createFixtureRootFs(rootPath).listOptionalDirectories(SCENARIOS_DIR);
}

export async function saveScenario({
  path: rootPath,
  expectedRootId,
  name
}: ScenarioOperationOptions): Promise<{ ok: true; name: string }> {
  const verifiedRootPath = await verifyRootPath({ path: rootPath, expectedRootId });
  const rootFs = createFixtureRootFs(verifiedRootPath);
  const scenarioName = validateScenarioName(name);

  const scenarioDir = path.join(SCENARIOS_DIR, scenarioName);
  await rootFs.remove(scenarioDir, { recursive: true, force: true });
  await rootFs.ensureDir(scenarioDir);

  const entries = await listFixtureEntries(rootFs);
  for (const entry of entries) {
    await rootFs.copyRecursive(entry, path.join(scenarioDir, entry));
  }

  const metadataEntries = await listScenarioMetadataEntries(rootFs);
  for (const entry of metadataEntries) {
    await rootFs.copyRecursive(entry, path.join(scenarioDir, entry));
  }

  return { ok: true, name: scenarioName };
}

export async function switchScenario({
  path: rootPath,
  expectedRootId,
  name
}: ScenarioOperationOptions): Promise<{ ok: true; name: string }> {
  const verifiedRootPath = await verifyRootPath({ path: rootPath, expectedRootId });
  const rootFs = createFixtureRootFs(verifiedRootPath);
  const scenarioName = validateScenarioName(name);
  const scenarioDir = await requireScenarioDir(verifiedRootPath, scenarioName);

  const currentEntries = await listFixtureEntries(rootFs);
  for (const entry of currentEntries) {
    await rootFs.remove(entry, { recursive: true, force: true });
  }

  await rootFs.remove(CAPTURES_DIR, { recursive: true, force: true });
  await rootFs.remove(MANIFESTS_DIR, { recursive: true, force: true });

  const scenarioEntries = await rootFs.listDirectory(scenarioDir);
  for (const entry of scenarioEntries) {
    await rootFs.copyRecursive(path.join(scenarioDir, entry.name), entry.name);
  }

  return { ok: true, name: scenarioName };
}

export async function diffScenarios(rootPath: string, scenarioA: string, scenarioB: string): Promise<FixtureDiff> {
  const rootFs = createFixtureRootFs(rootPath);
  const validatedScenarioA = validateScenarioName(scenarioA);
  const validatedScenarioB = validateScenarioName(scenarioB);
  const pathA = await requireScenarioDir(rootPath, validatedScenarioA);
  const pathB = await requireScenarioDir(rootPath, validatedScenarioB);

  const endpointsA = await collectEndpointsFromScenario(rootFs, pathA);
  const endpointsB = await collectEndpointsFromScenario(rootFs, pathB);

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

  return { scenarioA: validatedScenarioA, scenarioB: validatedScenarioB, added, removed, changed };
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
