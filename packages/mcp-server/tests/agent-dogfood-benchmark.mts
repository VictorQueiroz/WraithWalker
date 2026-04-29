import { promises as fs } from "node:fs";
import { performance } from "node:perf_hooks";

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export type AgentDogfoodObservationKind =
  | "seed-discovery"
  | "trace-usefulness"
  | "symbol-read-usefulness"
  | "huge-bundle-safety";

export interface AgentDogfoodMetric {
  task: string;
  label: string;
  tool: string;
  durationMs: number;
  returnedBytes: number;
  truncated: boolean;
  analysisMode: string | null;
}

export interface AgentDogfoodObservation {
  kind: AgentDogfoodObservationKind;
  label: string;
  passed: boolean;
  details?: Record<string, boolean | number | string | null>;
}

export interface AgentDogfoodReport {
  name: string;
  elapsedMs: number;
  heapDeltaBytes: number | null;
  totals: {
    toolCalls: number;
    returnedBytes: number;
    truncatedCalls: number;
    quality: Record<AgentDogfoodObservationKind, number>;
    failedQuality: number;
  };
  observations: AgentDogfoodObservation[];
  metrics: AgentDogfoodMetric[];
}

export interface AgentDogfoodBudgets {
  maxToolCalls?: number;
  maxReturnedBytes?: number;
  maxElapsedMs?: number;
  maxTruncatedCalls?: number;
  maxSingleToolDurationMs?: number;
  maxSingleResponseBytes?: number;
  maxHeapDeltaBytes?: number;
  minQuality?: Partial<Record<AgentDogfoodObservationKind, number>>;
}

export interface AgentDogfoodRecorder {
  readonly metrics: AgentDogfoodMetric[];
  readonly observations: AgentDogfoodObservation[];
  measureJson<T>(options: {
    task: string;
    label: string;
    tool: string;
    run: () => Promise<T>;
  }): Promise<T>;
  callJsonTool<T>(options: {
    task: string;
    label: string;
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<T>;
  observe(observation: AgentDogfoodObservation): void;
  buildReport(options?: {
    elapsedMs?: number;
    heapDeltaBytes?: number;
  }): AgentDogfoodReport;
}

export function createAgentDogfoodRecorder({
  name,
  client,
  requestTimeoutMs
}: {
  name: string;
  client: Client;
  requestTimeoutMs?: number;
}): AgentDogfoodRecorder {
  const startedAt = performance.now();
  const metrics: AgentDogfoodMetric[] = [];
  const observations: AgentDogfoodObservation[] = [];

  return {
    metrics,
    observations,
    async measureJson<T>({
      task,
      label,
      tool,
      run
    }: {
      task: string;
      label: string;
      tool: string;
      run: () => Promise<T>;
    }): Promise<T> {
      const start = performance.now();
      let value: T | null = null;
      let text = "";
      try {
        value = await run();
        text = JSON.stringify(value);
        return value;
      } finally {
        metrics.push({
          task,
          label,
          tool,
          durationMs: performance.now() - start,
          returnedBytes: Buffer.byteLength(text, "utf8"),
          truncated: containsTruncatedTrue(value),
          analysisMode: extractAnalysisMode(value)
        });
      }
    },
    async callJsonTool<T>({
      task,
      label,
      name: toolName,
      arguments: args
    }: {
      task: string;
      label: string;
      name: string;
      arguments: Record<string, unknown>;
    }): Promise<T> {
      const start = performance.now();
      let text = "";
      try {
        const result = await client.callTool(
          {
            name: toolName,
            arguments: args
          },
          undefined,
          requestTimeoutMs ? { timeout: requestTimeoutMs } : undefined
        );
        text = readTextContent(result);
        return JSON.parse(text) as T;
      } finally {
        let parsed: unknown = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        metrics.push({
          task,
          label,
          tool: toolName,
          durationMs: performance.now() - start,
          returnedBytes: Buffer.byteLength(text, "utf8"),
          truncated: containsTruncatedTrue(parsed),
          analysisMode: extractAnalysisMode(parsed)
        });
      }
    },
    observe(observation: AgentDogfoodObservation): void {
      observations.push(observation);
    },
    buildReport({
      elapsedMs = performance.now() - startedAt,
      heapDeltaBytes
    }: {
      elapsedMs?: number;
      heapDeltaBytes?: number;
    } = {}): AgentDogfoodReport {
      return buildAgentDogfoodReport({
        name,
        metrics,
        observations,
        elapsedMs,
        heapDeltaBytes: heapDeltaBytes ?? null
      });
    }
  };
}

export async function maybeEmitAgentDogfoodReport(
  report: AgentDogfoodReport
): Promise<void> {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const reportPath = process.env.WRAITHWALKER_AGENT_DOGFOOD_REPORT_PATH;

  if (reportPath) {
    await fs.writeFile(reportPath, serialized, "utf8");
  }

  if (process.env.WRAITHWALKER_AGENT_DOGFOOD_REPORT === "1") {
    process.stdout.write(serialized);
  }
}

export function assertAgentDogfoodBudgets(
  report: AgentDogfoodReport,
  budgets: AgentDogfoodBudgets
): void {
  const failures: string[] = [];

  if (
    budgets.maxToolCalls !== undefined &&
    report.totals.toolCalls > budgets.maxToolCalls
  ) {
    failures.push(
      `tool calls: ${report.totals.toolCalls} > ${budgets.maxToolCalls}`
    );
  }
  if (
    budgets.maxReturnedBytes !== undefined &&
    report.totals.returnedBytes > budgets.maxReturnedBytes
  ) {
    failures.push(
      `returned bytes: ${formatBytes(
        report.totals.returnedBytes
      )} > ${formatBytes(budgets.maxReturnedBytes)}`
    );
  }
  if (
    budgets.maxElapsedMs !== undefined &&
    report.elapsedMs > budgets.maxElapsedMs
  ) {
    failures.push(
      `elapsed: ${formatDuration(report.elapsedMs)} > ${formatDuration(
        budgets.maxElapsedMs
      )}`
    );
  }
  if (
    budgets.maxTruncatedCalls !== undefined &&
    report.totals.truncatedCalls > budgets.maxTruncatedCalls
  ) {
    failures.push(
      `truncated calls: ${report.totals.truncatedCalls} > ${budgets.maxTruncatedCalls}`
    );
  }
  if (
    budgets.maxHeapDeltaBytes !== undefined &&
    report.heapDeltaBytes !== null &&
    report.heapDeltaBytes > budgets.maxHeapDeltaBytes
  ) {
    failures.push(
      `heap delta: ${formatBytes(report.heapDeltaBytes)} > ${formatBytes(
        budgets.maxHeapDeltaBytes
      )}`
    );
  }

  for (const metric of report.metrics) {
    if (
      budgets.maxSingleToolDurationMs !== undefined &&
      metric.durationMs > budgets.maxSingleToolDurationMs
    ) {
      failures.push(
        `${metric.task}/${metric.label} duration: ${formatDuration(
          metric.durationMs
        )} > ${formatDuration(budgets.maxSingleToolDurationMs)}`
      );
    }
    if (
      budgets.maxSingleResponseBytes !== undefined &&
      metric.returnedBytes > budgets.maxSingleResponseBytes
    ) {
      failures.push(
        `${metric.task}/${metric.label} response: ${formatBytes(
          metric.returnedBytes
        )} > ${formatBytes(budgets.maxSingleResponseBytes)}`
      );
    }
  }

  for (const [kind, minimum] of Object.entries(budgets.minQuality ?? {})) {
    const observed =
      report.totals.quality[kind as AgentDogfoodObservationKind] ?? 0;
    if (minimum !== undefined && observed < minimum) {
      failures.push(`quality ${kind}: ${observed} < ${minimum}`);
    }
  }

  if (report.totals.failedQuality > 0) {
    failures.push(
      `failed quality observations: ${report.totals.failedQuality}`
    );
  }

  if (failures.length === 0) {
    return;
  }

  const timings = [...report.metrics]
    .sort((left, right) => right.durationMs - left.durationMs)
    .map(
      (metric) =>
        `  ${metric.task}/${metric.label} (${metric.tool}): ${formatDuration(
          metric.durationMs
        )}, ${formatBytes(metric.returnedBytes)}, truncated=${
          metric.truncated
        }, analysisMode=${metric.analysisMode ?? "n/a"}`
    )
    .join("\n");
  const observations = report.observations
    .map(
      (observation) =>
        `  ${observation.kind}/${observation.label}: passed=${
          observation.passed
        }${formatObservationDetails(observation.details)}`
    )
    .join("\n");

  throw new Error(
    [
      `${report.name} dogfood budget exceeded.`,
      "Failures:",
      ...failures.map((failure) => `  ${failure}`),
      `Totals: calls=${report.totals.toolCalls}, bytes=${formatBytes(
        report.totals.returnedBytes
      )}, elapsed=${formatDuration(report.elapsedMs)}, truncated=${
        report.totals.truncatedCalls
      }, heapDelta=${
        report.heapDeltaBytes === null
          ? "n/a"
          : formatBytes(report.heapDeltaBytes)
      }`,
      "Quality:",
      `  seed-discovery=${report.totals.quality["seed-discovery"]}`,
      `  trace-usefulness=${report.totals.quality["trace-usefulness"]}`,
      `  symbol-read-usefulness=${report.totals.quality["symbol-read-usefulness"]}`,
      `  huge-bundle-safety=${report.totals.quality["huge-bundle-safety"]}`,
      "Observations:",
      observations || "  none",
      "Calls:",
      timings || "  none"
    ].join("\n")
  );
}

export function readTextContent(result: unknown): string {
  if (
    !result ||
    typeof result !== "object" ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    throw new Error("Expected a CallTool content result.");
  }

  const entry = result.content.find(
    (item): item is { type: string; text?: string } =>
      Boolean(item) &&
      typeof item === "object" &&
      "type" in item &&
      typeof item.type === "string"
  );
  if (!entry?.text) {
    throw new Error("Expected text content.");
  }

  return entry.text;
}

export function containsTruncatedTrue(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if ("truncated" in value && value.truncated === true) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some(containsTruncatedTrue);
  }

  return Object.values(value).some(containsTruncatedTrue);
}

export function extractAnalysisMode(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if ("analysisMode" in value && typeof value.analysisMode === "string") {
    return value.analysisMode;
  }

  if ("items" in value && Array.isArray(value.items)) {
    const modes = [
      ...new Set(
        value.items
          .map((item) =>
            item && typeof item === "object" && "analysisMode" in item
              ? item.analysisMode
              : null
          )
          .filter((mode): mode is string => typeof mode === "string")
      )
    ];
    return modes.length > 0 ? modes.join(",") : null;
  }

  return null;
}

export function compactJsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function buildAgentDogfoodReport({
  name,
  metrics,
  observations,
  elapsedMs,
  heapDeltaBytes
}: {
  name: string;
  metrics: AgentDogfoodMetric[];
  observations: AgentDogfoodObservation[];
  elapsedMs: number;
  heapDeltaBytes: number | null;
}): AgentDogfoodReport {
  const quality: Record<AgentDogfoodObservationKind, number> = {
    "seed-discovery": 0,
    "trace-usefulness": 0,
    "symbol-read-usefulness": 0,
    "huge-bundle-safety": 0
  };

  for (const observation of observations) {
    if (observation.passed) {
      quality[observation.kind] += 1;
    }
  }

  return {
    name,
    elapsedMs,
    heapDeltaBytes,
    totals: {
      toolCalls: metrics.length,
      returnedBytes: metrics.reduce(
        (total, metric) => total + metric.returnedBytes,
        0
      ),
      truncatedCalls: metrics.filter((metric) => metric.truncated).length,
      quality,
      failedQuality: observations.filter((observation) => !observation.passed)
        .length
    },
    observations,
    metrics
  };
}

function formatBytes(value: number): string {
  return `${(value / 1024).toFixed(1)}KiB`;
}

function formatDuration(value: number): string {
  return `${Math.round(value)}ms`;
}

function formatObservationDetails(
  details?: Record<string, boolean | number | string | null>
): string {
  if (!details || Object.keys(details).length === 0) {
    return "";
  }

  return `, details=${JSON.stringify(details)}`;
}
