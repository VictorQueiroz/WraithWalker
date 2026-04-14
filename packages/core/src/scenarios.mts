import path from "node:path";

import {
  CAPTURES_DIR,
  CAPTURE_HTTP_DIR,
  MANIFESTS_DIR,
  SCENARIO_ACTIVE_FILE,
  SCENARIO_ACTIVE_SCHEMA_VERSION,
  SCENARIO_METADATA_FILE,
  SCENARIO_METADATA_SCHEMA_VERSION,
  SCENARIOS_DIR,
  WRAITHWALKER_DIR
} from "./constants.mjs";
import type { ResponseMeta } from "./fixture-layout.mjs";
import { readSentinel } from "./root.mjs";
import { createFixtureRootFs, type FixtureRootFs } from "./root-fs.mjs";
import type { ScenarioTraceRecord } from "./scenario-traces.mjs";

export interface ScenarioRootOptions {
  path?: string;
  expectedRootId?: string;
}

export interface ScenarioOperationOptions extends ScenarioRootOptions {
  name?: string;
  description?: string;
  createdAt?: string;
  sourceTrace?: ScenarioSnapshotSourceTrace;
}

export interface ScenarioActiveMarker {
  schemaVersion: number;
  name: string;
  rootId: string;
  updatedAt: string;
}

export interface ScenarioSnapshotSourceTrace {
  traceId: string;
  name?: string;
  goal?: string;
  status: ScenarioTraceRecord["status"];
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  selectedOrigins: string[];
  extensionClientId: string;
  stepCount: number;
  linkedFixtureCount: number;
}

export interface ScenarioSnapshotMetadata {
  schemaVersion: number;
  name: string;
  createdAt: string;
  rootId: string;
  source: "manual" | "trace";
  description?: string;
  sourceTrace?: ScenarioSnapshotSourceTrace;
}

export interface ScenarioSnapshotSummary {
  name: string;
  schemaVersion?: number;
  createdAt?: string;
  rootId?: string;
  source: "manual" | "trace" | "unknown";
  description?: string;
  sourceTrace?: ScenarioSnapshotSourceTrace;
  hasMetadata: boolean;
  isActive: boolean;
}

export interface ScenarioPanelState {
  snapshots: ScenarioSnapshotSummary[];
  activeScenarioName: string | null;
  activeScenarioMissing: boolean;
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

interface StoredScenarioSnapshotMetadata extends Omit<
  ScenarioSnapshotMetadata,
  "source" | "sourceTrace"
> {
  source?: ScenarioSnapshotMetadata["source"];
  sourceTrace?: Partial<ScenarioSnapshotSourceTrace>;
}

interface StoredScenarioActiveMarker extends Partial<
  Omit<ScenarioActiveMarker, "name" | "rootId" | "updatedAt">
> {
  name?: string;
  rootId?: string;
  updatedAt?: string;
}

function countLinkedFixtures(
  trace: Pick<ScenarioTraceRecord, "steps">
): number {
  return trace.steps.reduce(
    (total, step) => total + step.linkedFixtures.length,
    0
  );
}

export function buildScenarioSnapshotSourceTrace(
  trace: ScenarioTraceRecord
): ScenarioSnapshotSourceTrace {
  return {
    traceId: trace.traceId,
    ...(trace.name ? { name: trace.name } : {}),
    ...(trace.goal ? { goal: trace.goal } : {}),
    status: trace.status,
    createdAt: trace.createdAt,
    ...(trace.startedAt ? { startedAt: trace.startedAt } : {}),
    ...(trace.endedAt ? { endedAt: trace.endedAt } : {}),
    selectedOrigins: [...trace.selectedOrigins],
    extensionClientId: trace.extensionClientId,
    stepCount: trace.steps.length,
    linkedFixtureCount: countLinkedFixtures(trace)
  };
}

async function verifyRootPath({
  path: rootPath,
  expectedRootId
}: ScenarioRootOptions): Promise<{
  rootPath: string;
  sentinel: Awaited<ReturnType<typeof readSentinel>>;
}> {
  if (!rootPath) {
    throw new Error("Root path is required.");
  }

  if (!expectedRootId) {
    throw new Error("Expected root ID is required.");
  }

  const sentinel = await readSentinel(rootPath);
  if (sentinel.rootId !== expectedRootId) {
    throw new Error(
      `Sentinel root ID mismatch. Expected ${expectedRootId}, received ${sentinel.rootId}.`
    );
  }

  return {
    rootPath,
    sentinel
  };
}

function isScenarioSafe(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name);
}

function validateScenarioName(name: string | undefined): string {
  if (!name || !isScenarioSafe(name)) {
    throw new Error(
      "Scenario name must be 1-64 alphanumeric, hyphen, or underscore characters."
    );
  }

  return name;
}

async function requireScenarioDir(
  rootPath: string,
  name: string | undefined
): Promise<string> {
  const scenarioName = validateScenarioName(name);
  const scenarioDir = path.join(SCENARIOS_DIR, scenarioName);
  const scenarioStat = await createFixtureRootFs(rootPath).stat(scenarioDir);
  if (!scenarioStat?.isDirectory()) {
    throw new Error(`Scenario "${scenarioName}" does not exist.`);
  }

  return scenarioDir;
}

function scenarioMetadataPath(scenarioName: string): string {
  return path.join(SCENARIOS_DIR, scenarioName, SCENARIO_METADATA_FILE);
}

async function listFixtureEntries(rootFs: FixtureRootFs): Promise<string[]> {
  const entries = await rootFs.listOptionalDirectory("");
  return entries
    .filter((entry) => entry.name !== ".wraithwalker")
    .map((entry) => entry.name);
}

async function listScenarioMetadataEntries(
  rootFs: FixtureRootFs
): Promise<string[]> {
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
      const fixtures = await rootFs.listOptionalDirectories(
        path.join(httpDir, method)
      );
      for (const fixture of fixtures) {
        const fixtureDir = path.join(httpDir, method, fixture);
        const meta = await rootFs.readOptionalJson<ResponseMeta>(
          path.join(fixtureDir, "response.meta.json")
        );
        if (!meta) continue;

        const pathname = meta.url
          ? new URL(meta.url).pathname
          : fixture.replace(/__q-.*/, "").replace(/-/g, "/");
        const key = `${method} ${pathname}`;
        const bodyContent = await rootFs.readOptionalText(
          path.join(fixtureDir, "response.body")
        );

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
    await scanOriginsTree(
      rootFs,
      path.join(captureBase, originKey, "origins"),
      endpoints
    );
  }

  return endpoints;
}

export async function listScenarios(rootPath: string): Promise<string[]> {
  return createFixtureRootFs(rootPath).listOptionalDirectories(SCENARIOS_DIR);
}

function normalizeScenarioActiveMarker(
  value: unknown
): ScenarioActiveMarker | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const marker = value as StoredScenarioActiveMarker;
  if (
    !isScenarioSafe(marker.name ?? "") ||
    typeof marker.rootId !== "string" ||
    typeof marker.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    schemaVersion:
      typeof marker.schemaVersion === "number"
        ? marker.schemaVersion
        : SCENARIO_ACTIVE_SCHEMA_VERSION,
    name: marker.name,
    rootId: marker.rootId,
    updatedAt: marker.updatedAt
  };
}

function normalizeScenarioSource(
  value: unknown
): ScenarioSnapshotSummary["source"] {
  return value === "manual" || value === "trace" ? value : "unknown";
}

function normalizeScenarioSnapshotSourceTrace(
  source: unknown
): ScenarioSnapshotSourceTrace | undefined {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  const traceSource = source as Partial<ScenarioSnapshotSourceTrace>;
  if (
    typeof traceSource.traceId !== "string" ||
    typeof traceSource.createdAt !== "string" ||
    (traceSource.status !== "armed" &&
      traceSource.status !== "recording" &&
      traceSource.status !== "completed") ||
    typeof traceSource.extensionClientId !== "string" ||
    !Array.isArray(traceSource.selectedOrigins) ||
    typeof traceSource.stepCount !== "number" ||
    typeof traceSource.linkedFixtureCount !== "number"
  ) {
    return undefined;
  }

  return {
    traceId: traceSource.traceId,
    ...(typeof traceSource.name === "string" ? { name: traceSource.name } : {}),
    ...(typeof traceSource.goal === "string" ? { goal: traceSource.goal } : {}),
    status: traceSource.status,
    createdAt: traceSource.createdAt,
    ...(typeof traceSource.startedAt === "string"
      ? { startedAt: traceSource.startedAt }
      : {}),
    ...(typeof traceSource.endedAt === "string"
      ? { endedAt: traceSource.endedAt }
      : {}),
    selectedOrigins: traceSource.selectedOrigins.filter(
      (origin): origin is string => typeof origin === "string"
    ),
    extensionClientId: traceSource.extensionClientId,
    stepCount: traceSource.stepCount,
    linkedFixtureCount: traceSource.linkedFixtureCount
  };
}

function toScenarioSnapshotSummary(
  scenarioName: string,
  metadata: StoredScenarioSnapshotMetadata | null,
  activeScenarioName: string | null
): ScenarioSnapshotSummary {
  if (!metadata) {
    return {
      name: scenarioName,
      source: "unknown",
      hasMetadata: false,
      isActive: activeScenarioName === scenarioName
    };
  }

  const sourceTrace = normalizeScenarioSnapshotSourceTrace(
    metadata.sourceTrace
  );

  return {
    name: scenarioName,
    ...(typeof metadata.schemaVersion === "number"
      ? { schemaVersion: metadata.schemaVersion }
      : {}),
    ...(typeof metadata.createdAt === "string"
      ? { createdAt: metadata.createdAt }
      : {}),
    ...(typeof metadata.rootId === "string" ? { rootId: metadata.rootId } : {}),
    source: normalizeScenarioSource(metadata.source),
    ...(typeof metadata.description === "string" && metadata.description.trim()
      ? { description: metadata.description.trim() }
      : {}),
    ...(sourceTrace ? { sourceTrace } : {}),
    hasMetadata: true,
    isActive: activeScenarioName === scenarioName
  };
}

function sortScenarioSnapshots(
  snapshots: ScenarioSnapshotSummary[]
): ScenarioSnapshotSummary[] {
  return snapshots.sort((left, right) => {
    if (left.isActive !== right.isActive) {
      return left.isActive ? -1 : 1;
    }

    if (left.createdAt && right.createdAt) {
      return (
        right.createdAt.localeCompare(left.createdAt) ||
        left.name.localeCompare(right.name)
      );
    }

    if (left.createdAt) {
      return -1;
    }

    if (right.createdAt) {
      return 1;
    }

    return left.name.localeCompare(right.name);
  });
}

export async function readActiveScenarioMarker(
  rootPath: string
): Promise<ScenarioActiveMarker | null> {
  const rootFs = createFixtureRootFs(rootPath);
  const marker =
    await rootFs.readOptionalJson<StoredScenarioActiveMarker>(
      SCENARIO_ACTIVE_FILE
    );
  const normalizedMarker = normalizeScenarioActiveMarker(marker);
  if (!normalizedMarker) {
    return null;
  }

  try {
    const sentinel = await readSentinel(rootPath);
    return sentinel.rootId === normalizedMarker.rootId
      ? normalizedMarker
      : null;
  } catch {
    return null;
  }
}

export async function writeActiveScenarioMarker({
  path: rootPath,
  expectedRootId,
  name,
  createdAt
}: ScenarioOperationOptions): Promise<ScenarioActiveMarker> {
  const { rootPath: verifiedRootPath, sentinel } = await verifyRootPath({
    path: rootPath,
    expectedRootId
  });
  const scenarioName = validateScenarioName(name);
  const marker: ScenarioActiveMarker = {
    schemaVersion: SCENARIO_ACTIVE_SCHEMA_VERSION,
    name: scenarioName,
    rootId: sentinel.rootId,
    updatedAt: createdAt ?? new Date().toISOString()
  };

  await createFixtureRootFs(verifiedRootPath).writeJson(
    SCENARIO_ACTIVE_FILE,
    marker
  );

  return marker;
}

export async function listScenarioPanelState(
  rootPath: string
): Promise<ScenarioPanelState> {
  const rootFs = createFixtureRootFs(rootPath);
  const [scenarioNames, activeMarker] = await Promise.all([
    listScenarios(rootPath),
    readActiveScenarioMarker(rootPath)
  ]);
  const activeScenarioName = activeMarker?.name ?? null;
  const snapshots = sortScenarioSnapshots(
    await Promise.all(
      scenarioNames.map(async (scenarioName) =>
        toScenarioSnapshotSummary(
          scenarioName,
          await rootFs.readOptionalJson<StoredScenarioSnapshotMetadata>(
            scenarioMetadataPath(scenarioName)
          ),
          activeScenarioName
        )
      )
    )
  );

  return {
    snapshots,
    activeScenarioName,
    activeScenarioMissing: Boolean(
      activeScenarioName &&
      !snapshots.some((snapshot) => snapshot.name === activeScenarioName)
    )
  };
}

export async function readScenarioSnapshot(
  rootPath: string,
  name: string
): Promise<ScenarioSnapshotSummary | null> {
  const scenarioName = validateScenarioName(name);
  const rootFs = createFixtureRootFs(rootPath);
  await requireScenarioDir(rootPath, scenarioName);
  const activeScenarioName =
    (await readActiveScenarioMarker(rootPath))?.name ?? null;

  const metadata =
    await rootFs.readOptionalJson<StoredScenarioSnapshotMetadata>(
      scenarioMetadataPath(scenarioName)
    );

  return toScenarioSnapshotSummary(scenarioName, metadata, activeScenarioName);
}

export async function listScenarioSnapshots(
  rootPath: string
): Promise<ScenarioSnapshotSummary[]> {
  return (await listScenarioPanelState(rootPath)).snapshots;
}

export async function saveScenario({
  path: rootPath,
  expectedRootId,
  name,
  description,
  createdAt = new Date().toISOString(),
  sourceTrace
}: ScenarioOperationOptions): Promise<{ ok: true; name: string }> {
  const { rootPath: verifiedRootPath, sentinel } = await verifyRootPath({
    path: rootPath,
    expectedRootId
  });
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

  const snapshotMetadata: ScenarioSnapshotMetadata = {
    schemaVersion: SCENARIO_METADATA_SCHEMA_VERSION,
    name: scenarioName,
    createdAt,
    rootId: sentinel.rootId,
    source: sourceTrace ? "trace" : "manual",
    ...(description?.trim() ? { description: description.trim() } : {}),
    ...(sourceTrace ? { sourceTrace } : {})
  };
  await rootFs.writeJson(
    path.join(scenarioDir, SCENARIO_METADATA_FILE),
    snapshotMetadata
  );

  return { ok: true, name: scenarioName };
}

export async function switchScenario({
  path: rootPath,
  expectedRootId,
  name
}: ScenarioOperationOptions): Promise<{ ok: true; name: string }> {
  const { rootPath: verifiedRootPath } = await verifyRootPath({
    path: rootPath,
    expectedRootId
  });
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
    if (entry.name === SCENARIO_METADATA_FILE) {
      continue;
    }
    await rootFs.copyRecursive(path.join(scenarioDir, entry.name), entry.name);
  }

  await writeActiveScenarioMarker({
    path: verifiedRootPath,
    expectedRootId,
    name: scenarioName
  });

  return { ok: true, name: scenarioName };
}

export async function diffScenarios(
  rootPath: string,
  scenarioA: string,
  scenarioB: string
): Promise<FixtureDiff> {
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

  return {
    scenarioA: validatedScenarioA,
    scenarioB: validatedScenarioB,
    added,
    removed,
    changed
  };
}

export function renderDiffMarkdown(diff: FixtureDiff): string {
  const lines: string[] = [];

  lines.push(`# Fixture Diff: ${diff.scenarioA} vs ${diff.scenarioB}`);
  lines.push("");

  if (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.changed.length === 0
  ) {
    lines.push("No differences found.");
    return lines.join("\n");
  }

  if (diff.added.length > 0) {
    lines.push("## Added Endpoints");
    lines.push("");
    for (const endpoint of diff.added) {
      lines.push(
        `- **${endpoint.method} ${endpoint.pathname}** (${endpoint.status}) — ${endpoint.mimeType}`
      );
    }
    lines.push("");
  }

  if (diff.removed.length > 0) {
    lines.push("## Removed Endpoints");
    lines.push("");
    for (const endpoint of diff.removed) {
      lines.push(
        `- **${endpoint.method} ${endpoint.pathname}** (${endpoint.status}) — ${endpoint.mimeType}`
      );
    }
    lines.push("");
  }

  if (diff.changed.length > 0) {
    lines.push("## Changed Endpoints");
    lines.push("");
    lines.push("| Method | Path | Status | Body Changed |");
    lines.push("|--------|------|--------|-------------|");
    for (const change of diff.changed) {
      const statusString =
        change.statusBefore === change.statusAfter
          ? String(change.statusBefore)
          : `${change.statusBefore} → ${change.statusAfter}`;
      lines.push(
        `| ${change.method} | ${change.pathname} | ${statusString} | ${change.bodyChanged ? "Yes" : "No"} |`
      );
    }
    lines.push("");
  }

  lines.push(
    `Summary: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`
  );
  return lines.join("\n");
}
