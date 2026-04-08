import {
  SCENARIO_TRACE_ACTIVE_FILE,
  SCENARIO_TRACE_SCHEMA_VERSION,
  SCENARIO_TRACES_DIR
} from "./constants.mjs";
import type { RootSentinel } from "./root.mjs";
import type { RootRuntimeStorage } from "./root-runtime.mjs";

export interface ScenarioTraceLinkedFixture {
  bodyPath: string;
  requestUrl: string;
  resourceType: string;
  capturedAt: string;
}

export interface ScenarioTraceStep {
  stepId: string;
  tabId: number;
  recordedAt: string;
  pageUrl: string;
  topOrigin: string;
  selector: string;
  tagName: string;
  textSnippet: string;
  role?: string;
  ariaLabel?: string;
  href?: string;
  linkedFixtures: ScenarioTraceLinkedFixture[];
}

export interface ScenarioTraceRecord {
  schemaVersion: number;
  traceId: string;
  name?: string;
  status: "armed" | "recording" | "completed";
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  rootId: string;
  selectedOrigins: string[];
  extensionClientId: string;
  steps: ScenarioTraceStep[];
}

export interface ScenarioTraceSummary {
  traceId: string;
  name?: string;
  status: ScenarioTraceRecord["status"];
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  rootId: string;
  selectedOrigins: string[];
  extensionClientId: string;
  stepCount: number;
}

export interface ActiveScenarioTraceRef {
  traceId: string | null;
  updatedAt: string;
}

export interface ScenarioTraceStorage<TRoot> extends Pick<
  RootRuntimeStorage<TRoot>,
  "readOptionalJson" | "writeJson" | "listDirectory"
> {}

interface CreateScenarioTraceStoreDependencies<TRoot> {
  root: TRoot;
  storage: ScenarioTraceStorage<TRoot>;
  ensureReady: () => Promise<RootSentinel>;
}

function validateTraceId(traceId: string): string {
  const trimmed = traceId.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(trimmed)) {
    throw new Error("Trace ID must be 1-128 alphanumeric, hyphen, or underscore characters.");
  }
  return trimmed;
}

function tracePath(traceId: string): string {
  return `${SCENARIO_TRACES_DIR}/${traceId}/trace.json`;
}

function toSummary(trace: ScenarioTraceRecord): ScenarioTraceSummary {
  return {
    traceId: trace.traceId,
    name: trace.name,
    status: trace.status,
    createdAt: trace.createdAt,
    startedAt: trace.startedAt,
    endedAt: trace.endedAt,
    rootId: trace.rootId,
    selectedOrigins: [...trace.selectedOrigins],
    extensionClientId: trace.extensionClientId,
    stepCount: trace.steps.length
  };
}

function findLinkedStepIndex(
  trace: ScenarioTraceRecord,
  {
    tabId,
    requestedAt
  }: {
    tabId: number;
    requestedAt: string;
  }
): number {
  const requestedAtMs = Date.parse(requestedAt);
  if (Number.isNaN(requestedAtMs)) {
    return -1;
  }

  for (let index = trace.steps.length - 1; index >= 0; index--) {
    const step = trace.steps[index];
    if (step.tabId !== tabId) {
      continue;
    }

    const recordedAtMs = Date.parse(step.recordedAt);
    if (Number.isNaN(recordedAtMs) || recordedAtMs > requestedAtMs) {
      continue;
    }

    const nextStep = trace.steps
      .slice(index + 1)
      .find((candidate) => candidate.tabId === tabId);
    const nextStepMs = nextStep ? Date.parse(nextStep.recordedAt) : Number.POSITIVE_INFINITY;
    const withinClickWindow = requestedAtMs - recordedAtMs <= 5_000;

    if (requestedAtMs < nextStepMs && withinClickWindow) {
      return index;
    }
  }

  return -1;
}

async function readActiveTraceId<TRoot>(
  storage: ScenarioTraceStorage<TRoot>,
  root: TRoot
): Promise<string | null> {
  const active = await storage.readOptionalJson<ActiveScenarioTraceRef>(root, SCENARIO_TRACE_ACTIVE_FILE);
  return active?.traceId ?? null;
}

export function createScenarioTraceStore<TRoot>({
  root,
  storage,
  ensureReady
}: CreateScenarioTraceStoreDependencies<TRoot>) {
  async function readTrace(traceId: string): Promise<ScenarioTraceRecord | null> {
    await ensureReady();
    return storage.readOptionalJson<ScenarioTraceRecord>(root, tracePath(validateTraceId(traceId)));
  }

  async function writeTrace(trace: ScenarioTraceRecord): Promise<void> {
    await storage.writeJson(root, tracePath(validateTraceId(trace.traceId)), trace);
  }

  async function setActiveTraceId(traceId: string | null, updatedAt = new Date().toISOString()): Promise<void> {
    await storage.writeJson(root, SCENARIO_TRACE_ACTIVE_FILE, {
      traceId,
      updatedAt
    } satisfies ActiveScenarioTraceRef);
  }

  async function getActiveTrace(): Promise<ScenarioTraceRecord | null> {
    await ensureReady();
    const activeTraceId = await readActiveTraceId(storage, root);
    if (!activeTraceId) {
      return null;
    }

    return readTrace(activeTraceId);
  }

  async function listTraces(): Promise<ScenarioTraceSummary[]> {
    await ensureReady();

    let entries: Array<{ name: string; kind: "file" | "directory" }>;
    try {
      entries = await storage.listDirectory(root, SCENARIO_TRACES_DIR);
    } catch {
      return [];
    }

    const traces = await Promise.all(
      entries
        .filter((entry) => entry.kind === "directory")
        .map(async (entry) => readTrace(entry.name))
    );

    return traces
      .filter((trace): trace is ScenarioTraceRecord => Boolean(trace))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(toSummary);
  }

  async function startTrace({
    traceId,
    name,
    selectedOrigins,
    extensionClientId,
    createdAt = new Date().toISOString()
  }: {
    traceId: string;
    name?: string;
    selectedOrigins: string[];
    extensionClientId: string;
    createdAt?: string;
  }): Promise<ScenarioTraceRecord> {
    const sentinel = await ensureReady();
    const normalizedTraceId = validateTraceId(traceId);
    const existing = await getActiveTrace();
    if (existing) {
      throw new Error(`Trace "${existing.traceId}" is already active.`);
    }

    const trace: ScenarioTraceRecord = {
      schemaVersion: SCENARIO_TRACE_SCHEMA_VERSION,
      traceId: normalizedTraceId,
      ...(name?.trim() ? { name: name.trim() } : {}),
      status: "armed",
      createdAt,
      rootId: sentinel.rootId,
      selectedOrigins: [...selectedOrigins],
      extensionClientId,
      steps: []
    };

    await writeTrace(trace);
    await setActiveTraceId(normalizedTraceId, createdAt);
    return trace;
  }

  async function stopTrace(traceId: string, endedAt = new Date().toISOString()): Promise<ScenarioTraceRecord> {
    const trace = await readTrace(traceId);
    if (!trace) {
      throw new Error(`Trace "${traceId}" does not exist.`);
    }

    const nextTrace: ScenarioTraceRecord = {
      ...trace,
      status: "completed",
      ...(trace.startedAt ? {} : { startedAt: trace.createdAt }),
      endedAt
    };

    await writeTrace(nextTrace);
    const activeTraceId = await readActiveTraceId(storage, root);
    if (activeTraceId === nextTrace.traceId) {
      await setActiveTraceId(null, endedAt);
    }
    return nextTrace;
  }

  async function recordClick({
    traceId,
    step
  }: {
    traceId: string;
    step: Omit<ScenarioTraceStep, "linkedFixtures">;
  }): Promise<ScenarioTraceRecord | null> {
    const trace = await readTrace(traceId);
    if (!trace) {
      return null;
    }

    const nextTrace: ScenarioTraceRecord = {
      ...trace,
      status: trace.status === "armed" ? "recording" : trace.status,
      ...(trace.startedAt ? {} : { startedAt: step.recordedAt }),
      steps: [
        ...trace.steps,
        {
          ...step,
          linkedFixtures: []
        }
      ]
    };

    await writeTrace(nextTrace);
    return nextTrace;
  }

  async function linkFixture({
    traceId,
    tabId,
    requestedAt,
    fixture
  }: {
    traceId: string;
    tabId: number;
    requestedAt: string;
    fixture: ScenarioTraceLinkedFixture;
  }): Promise<{ linked: boolean; trace: ScenarioTraceRecord | null }> {
    const trace = await readTrace(traceId);
    if (!trace) {
      return { linked: false, trace: null };
    }

    const stepIndex = findLinkedStepIndex(trace, { tabId, requestedAt });
    if (stepIndex < 0) {
      return { linked: false, trace };
    }

    const targetStep = trace.steps[stepIndex];
    const alreadyLinked = targetStep.linkedFixtures.some((candidate) => (
      candidate.bodyPath === fixture.bodyPath
      && candidate.requestUrl === fixture.requestUrl
      && candidate.capturedAt === fixture.capturedAt
    ));
    if (alreadyLinked) {
      return { linked: false, trace };
    }

    const nextTrace: ScenarioTraceRecord = {
      ...trace,
      steps: trace.steps.map((step, index) => (
        index === stepIndex
          ? {
              ...step,
              linkedFixtures: [...step.linkedFixtures, fixture]
            }
          : step
      ))
    };

    await writeTrace(nextTrace);
    return { linked: true, trace: nextTrace };
  }

  return {
    getActiveTrace,
    listTraces,
    readTrace,
    startTrace,
    stopTrace,
    recordClick,
    linkFixture
  };
}
