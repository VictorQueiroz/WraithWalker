import { createHash } from "node:crypto";

export const AGENT_EVAL_TASKS = [
  {
    id: "seed-discovery",
    title: "Seed Discovery",
    requiredTools: ["list-sites", "list-files", "suggest-js-seeds"],
    evidence: ["seed-kinds", "node-id"],
    objective: [
      "Task: seed-discovery.",
      "Inspect the capture as an AI coding agent.",
      "Use list-sites/list-files, then suggest-js-seeds for endpoint, selector, call, and string seeds.",
      "Do not guess capture-specific literals.",
      "Finish with the seed kinds found and the next bounded evidence step you would take.",
      "Do not name captured origins, private domains, product names, local paths, tokens, or exact captured literals."
    ].join(" ")
  },
  {
    id: "pipeline-evidence",
    title: "Pipeline Evidence",
    requiredTools: ["suggest-js-seeds", "trace-js-pipeline", "read-js-symbol"],
    evidence: ["seed-kinds", "node-id", "trace", "bounded-read"],
    objective: [
      "Task: pipeline-evidence.",
      "Use suggested JS seeds to choose a useful node id or semantic seed.",
      "Call trace-js-pipeline from that discovered seed, then read-js-symbol for bounded evidence.",
      "The goal is an evidence chain, not a broad summary.",
      "Do not name captured origins, private domains, product names, local paths, tokens, or exact captured literals."
    ].join(" ")
  },
  {
    id: "huge-bundle-safety",
    title: "Huge Bundle Safety",
    requiredTools: ["list-files", "analyze-js-file", "read-file"],
    evidence: ["text-scan", "bounded-read"],
    objective: [
      "Task: huge-bundle-safety.",
      "Find a large readable JavaScript file through MCP discovery.",
      "Use analyze-js-file to confirm whether it safely degrades instead of full parsing.",
      "Use bounded read-file or read-js-symbol follow-up without flooding context.",
      "Do not name captured origins, private domains, product names, local paths, tokens, or exact captured literals."
    ].join(" ")
  },
  {
    id: "api-response-link",
    title: "API Response Link",
    requiredTools: [
      "list-api-routes",
      "suggest-js-seeds",
      "trace-js-pipeline",
      "read-api-response"
    ],
    evidence: ["seed-kinds", "trace", "api-metadata", "bounded-read"],
    objective: [
      "Task: api-response-link.",
      "Use captured API route metadata and JS seed discovery to connect an endpoint-like seed to captured response metadata.",
      "Use trace-js-pipeline when possible and read-api-response only as a bounded metadata/body page.",
      "Do not name captured origins, private domains, product names, local paths, tokens, or exact captured literals."
    ].join(" ")
  }
] as const satisfies readonly AgentEvalTask[];

export type AgentEvalTaskId = (typeof AGENT_EVAL_TASKS)[number]["id"];

export type EvidenceRequirement =
  | "api-metadata"
  | "bounded-read"
  | "node-id"
  | "seed-kinds"
  | "text-scan"
  | "trace";

export type FailureCategory =
  | "context-heavy"
  | "discovery-only"
  | "missing-api-metadata"
  | "missing-bounded-read"
  | "missing-evidence"
  | "missing-required-tools"
  | "missing-text-scan"
  | "runner-failure"
  | "tool-error"
  | "tool-loop"
  | "tool-starved"
  | "trace-unproductive";

export interface AgentEvalTask {
  id: string;
  title: string;
  requiredTools: readonly string[];
  evidence: readonly EvidenceRequirement[];
  objective: string;
}

export interface ToolObservation {
  resultItemCount?: number;
  seedKinds?: string[];
  hasNodeId?: boolean;
  analysisModes?: string[];
  traceConfidence?: string[];
  traceStepKinds?: string[];
  readTruncated?: boolean;
  apiResponseMetadata?: boolean;
  parseSkippedReason?: string;
}

export interface SanitizedToolEvent {
  step: number;
  tool: string;
  ok: boolean;
  durationMs: number;
  returnedBytes: number;
  bytesSentToModel: number;
  truncatedForModel: boolean;
  argumentShape: Record<string, string>;
  observations: ToolObservation;
}

export interface ToolMetric {
  step?: number;
  tool: string;
  durationMs: number;
  returnedBytes: number;
  bytesSentToModel: number;
  truncatedForModel: boolean;
  ok: boolean;
}

export interface RunReport {
  name?: string;
  taskId?: string | null;
  model: string;
  rootHash: string;
  elapsedMs: number;
  maxSteps?: number;
  completed: boolean;
  finalText: string;
  redactedTerms: number;
  totals: {
    modelCalls: number;
    toolCalls: number;
    toolReturnedBytes: number;
    toolBytesSentToModel: number;
    truncatedToolResults: number;
  };
  toolMetrics: ToolMetric[];
  toolEvents?: SanitizedToolEvent[];
}

export interface ComponentScore {
  name: string;
  points: number;
  max: number;
  reason: string;
}

export interface TaskScore {
  model: string;
  taskId: string;
  title: string;
  total: number;
  grade: string;
  completed: boolean;
  error: string | null;
  elapsedMs: number;
  toolCalls: number;
  bytesSentToModel: number;
  truncatedToolResults: number;
  requiredToolsUsed: string;
  evidenceStatus: string;
  failureCategories: FailureCategory[];
  nextActionHints: string[];
  components: ComponentScore[];
}

export interface ModelScore {
  model: string;
  total: number;
  grade: string;
  completedTasks: number;
  taskCount: number;
  toolCalls: number;
  bytesSentToModel: number;
  truncatedToolResults: number;
  elapsedMs: number;
}

export interface ModelEvalResult {
  model: string;
  tasks: TaskScore[];
}

export function sanitizeArgumentShape(
  args: Record<string, unknown>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(args)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, summarizeValueShape(value)])
  );
}

export function extractToolObservations(
  tool: string,
  rawToolText: string
): ToolObservation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawToolText);
  } catch {
    return {};
  }

  const items = getArrayProperty(parsed, "items");
  const observation: ToolObservation = {};
  if (items) {
    observation.resultItemCount = items.length;
  }

  const seedKinds = collectStringValues(parsed, "kind", 20).filter((kind) =>
    ["call", "endpoint", "selector", "string"].includes(kind)
  );
  if (tool === "suggest-js-seeds" && seedKinds.length > 0) {
    observation.seedKinds = unique(seedKinds);
  }

  observation.hasNodeId =
    collectStringValues(parsed, "nodeId", 1).length > 0 || undefined;

  const analysisModes = collectStringValues(parsed, "analysisMode", 20).filter(
    (mode) => mode === "ast" || mode === "text-scan"
  );
  if (analysisModes.length > 0) {
    observation.analysisModes = unique(analysisModes);
  }

  if (tool === "trace-js-pipeline") {
    const confidences = collectStringValues(parsed, "confidence", 20).filter(
      (value) => ["high", "low", "medium"].includes(value)
    );
    if (confidences.length > 0) {
      observation.traceConfidence = unique(confidences);
    }

    const stepKinds = collectTraceStepKinds(items ?? []);
    if (stepKinds.length > 0) {
      observation.traceStepKinds = unique(stepKinds);
    }
  }

  const readTruncated =
    getBooleanProperty(parsed, "truncated") ??
    getNestedBooleanProperty(parsed, ["body", "truncated"]);
  if (
    readTruncated !== undefined &&
    [
      "read-api-response",
      "read-file",
      "read-file-snippet",
      "read-js-symbol"
    ].includes(tool)
  ) {
    observation.readTruncated = readTruncated;
  }

  if (
    tool === "read-api-response" ||
    (tool === "list-api-routes" && items?.some(hasApiMetadata))
  ) {
    observation.apiResponseMetadata =
      hasApiMetadata(parsed) || items?.some(hasApiMetadata) || undefined;
  }

  const parseObject = getObjectProperty(parsed, "parse");
  if (parseObject && getBooleanProperty(parseObject, "skipped") === true) {
    const reason = getStringProperty(parseObject, "reason");
    if (reason) {
      observation.parseSkippedReason = reason;
    }
  }

  return observation;
}

export function scoreTaskRun(
  report: RunReport,
  task: AgentEvalTask
): TaskScore {
  const events = report.toolEvents ?? metricsToEvents(report.toolMetrics);
  const requiredTools = new Set(task.requiredTools);
  const usedRequiredTools = task.requiredTools.filter((tool) =>
    events.some((event) => event.tool === tool)
  );
  const evidence = collectEvidence(task, events);
  const evidencePoints = Math.round(
    (evidence.satisfied.length / Math.max(1, task.evidence.length)) * 40
  );
  const requiredToolPoints = Math.round(
    (usedRequiredTools.length / Math.max(1, requiredTools.size)) * 25
  );
  const reliabilityPoints = Math.round(
    (events.filter((event) => event.ok).length / Math.max(1, events.length)) *
      10
  );
  const contextPoints = scoreContextSafety(report, events);
  const assessmentPoints = scoreTaskAssessment(report.finalText);
  const components = [
    component(
      "Evidence Chain",
      evidencePoints,
      40,
      `${evidence.satisfied.length}/${task.evidence.length} evidence requirements met`
    ),
    component(
      "Required Tool Use",
      requiredToolPoints,
      25,
      `${usedRequiredTools.length}/${requiredTools.size} required tools used`
    ),
    component(
      "Context Safety",
      contextPoints,
      15,
      `${formatBytes(report.totals.toolBytesSentToModel)} sent to model`
    ),
    component(
      "Tool Reliability",
      reliabilityPoints,
      10,
      `${events.filter((event) => event.ok).length}/${Math.max(
        1,
        events.length
      )} tool calls succeeded`
    ),
    component(
      "Final Assessment Quality",
      assessmentPoints,
      10,
      report.completed
        ? "model returned task assessment"
        : "model did not complete the task"
    )
  ];
  const rawTotal = components.reduce((sum, item) => sum + item.points, 0);
  const total = evidencePoints < 20 ? Math.min(rawTotal, 69) : rawTotal;
  const diagnostics = analyzeTaskDiagnostics({
    task,
    events,
    evidence,
    usedRequiredTools,
    total,
    report
  });

  return {
    model: report.model,
    taskId: task.id,
    title: task.title,
    total,
    grade: gradeForScore(total),
    completed: report.completed,
    error: null,
    elapsedMs: report.elapsedMs,
    toolCalls: report.totals.toolCalls,
    bytesSentToModel: report.totals.toolBytesSentToModel,
    truncatedToolResults: report.totals.truncatedToolResults,
    requiredToolsUsed: `${usedRequiredTools.length}/${requiredTools.size}`,
    evidenceStatus: `${evidence.satisfied.length}/${task.evidence.length}`,
    failureCategories: diagnostics.categories,
    nextActionHints: diagnostics.hints,
    components
  };
}

export function scoreTaskFailure(
  model: string,
  task: AgentEvalTask,
  error: unknown
): TaskScore {
  const message = sanitizeText(
    error instanceof Error ? error.message : String(error)
  );
  return {
    model,
    taskId: task.id,
    title: task.title,
    total: 0,
    grade: "F",
    completed: false,
    error: message,
    elapsedMs: 0,
    toolCalls: 0,
    bytesSentToModel: 0,
    truncatedToolResults: 0,
    requiredToolsUsed: `0/${task.requiredTools.length}`,
    evidenceStatus: `0/${task.evidence.length}`,
    failureCategories: ["runner-failure"],
    nextActionHints: [
      "rerun this task with a tool-capable model or inspect the sanitized runner error"
    ],
    components: [
      component("Evidence Chain", 0, 40, `task failed: ${message}`),
      component("Required Tool Use", 0, 25, "no completed MCP workflow"),
      component("Context Safety", 0, 15, "no completed MCP workflow"),
      component("Tool Reliability", 0, 10, "no completed MCP workflow"),
      component("Final Assessment Quality", 0, 10, "no completed assessment")
    ]
  };
}

export function aggregateModelScore(
  model: string,
  tasks: TaskScore[]
): ModelScore {
  const total =
    tasks.length === 0
      ? 0
      : Math.round(
          tasks.reduce((sum, task) => sum + task.total, 0) / tasks.length
        );
  return {
    model,
    total,
    grade: gradeForScore(total),
    completedTasks: tasks.filter((task) => task.completed).length,
    taskCount: tasks.length,
    toolCalls: tasks.reduce((sum, task) => sum + task.toolCalls, 0),
    bytesSentToModel: tasks.reduce(
      (sum, task) => sum + task.bytesSentToModel,
      0
    ),
    truncatedToolResults: tasks.reduce(
      (sum, task) => sum + task.truncatedToolResults,
      0
    ),
    elapsedMs: tasks.reduce((sum, task) => sum + task.elapsedMs, 0)
  };
}

export function renderTaskScoreMarkdown({
  rootPath,
  results,
  generatedAt = new Date()
}: {
  rootPath: string;
  results: ModelEvalResult[];
  generatedAt?: Date;
}): string {
  const modelScores = results
    .map((result) => aggregateModelScore(result.model, result.tasks))
    .sort((left, right) => right.total - left.total);
  const best = modelScores[0];
  const taskRows = results
    .flatMap((result) => result.tasks)
    .sort(
      (left, right) =>
        right.total - left.total ||
        left.model.localeCompare(right.model) ||
        left.taskId.localeCompare(right.taskId)
    );
  const failureRows = taskRows.filter(
    (task) => task.failureCategories.length > 0
  );
  const rootHash = createHash("sha256")
    .update(rootPath)
    .digest("hex")
    .slice(0, 16);

  return `${[
    "# Agent-Grade JS Inspection Eval",
    "",
    `Updated: ${generatedAt.toISOString()}`,
    "",
    "This score is generated from opt-in private capture roots. The checked-in markdown stores only aggregate metrics, model ids, task ids, and a hashed corpus id; raw reports stay outside the repo by default.",
    "",
    `Current score: **${best?.total ?? 0}/100 (${best?.grade ?? "F"})**`,
    "",
    `Corpus hash: \`${rootHash}\``,
    "Raw JSON reports are written outside the repo by default.",
    "",
    "## Model Scores",
    "",
    "| Model | Score | Grade | Completed Tasks | Tool Calls | Bytes To Model | Truncated Tool Results | Elapsed |",
    "| --- | ---: | :---: | :---: | ---: | ---: | ---: | ---: |",
    ...modelScores.map(
      (score) =>
        `| \`${score.model}\` | ${score.total}/100 | ${score.grade} | ${
          score.completedTasks
        }/${score.taskCount} | ${score.toolCalls} | ${formatBytes(
          score.bytesSentToModel
        )} | ${score.truncatedToolResults} | ${formatDuration(
          score.elapsedMs
        )} |`
    ),
    "",
    "## Task Scores",
    "",
    "| Model | Task | Score | Grade | Required Tools | Evidence Chain | Bytes To Model | Truncations | Elapsed |",
    "| --- | --- | ---: | :---: | :---: | :---: | ---: | ---: | ---: |",
    ...taskRows.map(
      (task) =>
        `| \`${task.model}\` | \`${task.taskId}\` | ${task.total}/100 | ${
          task.grade
        } | ${task.requiredToolsUsed} | ${task.evidenceStatus} | ${formatBytes(
          task.bytesSentToModel
        )} | ${task.truncatedToolResults} | ${formatDuration(task.elapsedMs)} |`
    ),
    "",
    "## Failure Analysis",
    "",
    "Categories and next actions are derived only from sanitized tool-event metadata.",
    "",
    "| Model | Task | Categories | Next Action |",
    "| --- | --- | --- | --- |",
    ...renderFailureAnalysisRows(failureRows),
    "",
    "## Rubric",
    "",
    "| Component | Max | What It Measures |",
    "| --- | ---: | --- |",
    "| Evidence Chain | 40 | The task produced required observations such as seeds, node ids, traces, bounded reads, API metadata, or text-scan degradation. |",
    "| Required Tool Use | 25 | The model used the MCP tools expected for the task instead of stopping at a summary. |",
    "| Context Safety | 15 | The model stayed within bounded tool output and respected truncation/large-file behavior. |",
    "| Tool Reliability | 10 | MCP tool calls succeeded without validation or runtime errors. |",
    "| Final Assessment Quality | 10 | The final task answer was useful and privacy-preserving. |",
    "",
    "If a task lacks enough evidence-chain observations, the task score is capped below pass level even when the final prose sounds plausible.",
    "",
    "## Component Breakdown",
    "",
    ...taskRows.flatMap((task) => [
      `### ${task.model} / ${task.taskId}`,
      "",
      "| Component | Points | Reason |",
      "| --- | ---: | --- |",
      ...task.components.map(
        (item) =>
          `| ${item.name} | ${item.points}/${item.max} | ${escapeMarkdownCell(
            item.reason
          )} |`
      ),
      ...(task.error ? ["", `Failure: ${escapeMarkdownCell(task.error)}`] : []),
      ""
    ]),
    "## Findings",
    "",
    ...renderTaskFindings(taskRows),
    "",
    "## Interpretation",
    "",
    "The near-term goal is not source-map recovery. Source maps are valuable when present, but the agent-grade bar is whether an agent can reconstruct useful execution evidence from minified or bundled captures using bounded semantic facts.",
    "",
    "Recommended next direction: harden tool guidance and task-oriented affordances where weaker models stop after discovery instead of producing a seed-to-trace-to-snippet evidence chain.",
    ""
  ].join("\n")}\n`;
}

export function sanitizeText(value: string): string {
  return value
    .replace(/\/Users\/[^\s)"'`]+/g, "[local-path]")
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi, "[origin]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]")
    .slice(0, 500);
}

function metricsToEvents(metrics: ToolMetric[]): SanitizedToolEvent[] {
  return metrics.map((metric, index) => ({
    step: metric.step ?? index + 1,
    tool: metric.tool,
    ok: metric.ok,
    durationMs: metric.durationMs,
    returnedBytes: metric.returnedBytes,
    bytesSentToModel: metric.bytesSentToModel,
    truncatedForModel: metric.truncatedForModel,
    argumentShape: {},
    observations: {}
  }));
}

function analyzeTaskDiagnostics({
  task,
  events,
  evidence,
  usedRequiredTools,
  total,
  report
}: {
  task: AgentEvalTask;
  events: SanitizedToolEvent[];
  evidence: ReturnType<typeof collectEvidence>;
  usedRequiredTools: readonly string[];
  total: number;
  report: RunReport;
}): { categories: FailureCategory[]; hints: string[] } {
  const categories: FailureCategory[] = [];
  const requiredTools = new Set(task.requiredTools);
  const hasTraceTool = events.some(
    (event) => event.tool === "trace-js-pipeline"
  );
  const hasReadTool = events.some((event) => isReadTool(event.tool));
  const hasDiscoveryEvidence =
    hasEvidence(evidence, "seed-kinds") || hasEvidence(evidence, "node-id");
  const meaningfulToolCalls = events.filter(
    (event) => event.bytesSentToModel > 128 || hasObservation(event)
  ).length;

  if (
    total < 70 &&
    (meaningfulToolCalls <= 1 || report.totals.toolBytesSentToModel <= 1024)
  ) {
    categories.push("tool-starved");
  }

  if (hasRepeatedToolLoop(events) && evidence.missing.length > 0) {
    categories.push("tool-loop");
  }

  if (usedRequiredTools.length < requiredTools.size) {
    categories.push("missing-required-tools");
  }

  if (evidence.missing.length > 0) {
    categories.push("missing-evidence");
  }

  if (
    hasDiscoveryEvidence &&
    ((task.evidence.includes("trace") && !hasTraceTool) ||
      (task.evidence.includes("bounded-read") && !hasReadTool))
  ) {
    categories.push("discovery-only");
  }

  if (
    task.evidence.includes("trace") &&
    hasTraceTool &&
    !hasEvidence(evidence, "trace")
  ) {
    categories.push("trace-unproductive");
  }

  if (
    task.evidence.includes("bounded-read") &&
    !hasEvidence(evidence, "bounded-read")
  ) {
    categories.push("missing-bounded-read");
  }

  if (
    task.evidence.includes("api-metadata") &&
    !hasEvidence(evidence, "api-metadata")
  ) {
    categories.push("missing-api-metadata");
  }

  if (
    task.evidence.includes("text-scan") &&
    !hasEvidence(evidence, "text-scan")
  ) {
    categories.push("missing-text-scan");
  }

  if (
    report.totals.toolBytesSentToModel > 768 * 1024 ||
    report.totals.truncatedToolResults >= 8
  ) {
    categories.push("context-heavy");
  }

  if (events.some((event) => !event.ok)) {
    categories.push("tool-error");
  }

  const uniqueCategories = unique(categories) as FailureCategory[];
  return {
    categories: uniqueCategories,
    hints: uniqueCategories.map(nextActionHintForCategory)
  };
}

function collectEvidence(task: AgentEvalTask, events: SanitizedToolEvent[]) {
  const satisfied = task.evidence.filter((requirement) => {
    switch (requirement) {
      case "api-metadata":
        return events.some((event) => event.observations.apiResponseMetadata);
      case "bounded-read":
        return events.some(
          (event) =>
            event.truncatedForModel ||
            event.observations.readTruncated !== undefined ||
            [
              "read-api-response",
              "read-file",
              "read-file-snippet",
              "read-js-symbol"
            ].includes(event.tool)
        );
      case "node-id":
        return events.some((event) => event.observations.hasNodeId);
      case "seed-kinds":
        return events.some((event) => event.observations.seedKinds?.length);
      case "text-scan":
        return events.some(
          (event) =>
            event.observations.analysisModes?.includes("text-scan") ||
            event.observations.parseSkippedReason === "file-too-large"
        );
      case "trace":
        return events.some(
          (event) =>
            event.observations.traceConfidence?.length ||
            event.observations.traceStepKinds?.length
        );
    }
  });
  const missing = task.evidence.filter(
    (requirement) => !satisfied.includes(requirement)
  );
  return { missing, satisfied };
}

function hasEvidence(
  evidence: ReturnType<typeof collectEvidence>,
  requirement: EvidenceRequirement
): boolean {
  return evidence.satisfied.includes(requirement);
}

function hasObservation(event: SanitizedToolEvent): boolean {
  const observation = event.observations;
  return Boolean(
    observation.resultItemCount ||
    observation.seedKinds?.length ||
    observation.hasNodeId ||
    observation.analysisModes?.length ||
    observation.traceConfidence?.length ||
    observation.traceStepKinds?.length ||
    observation.readTruncated !== undefined ||
    observation.apiResponseMetadata ||
    observation.parseSkippedReason
  );
}

function hasRepeatedToolLoop(events: SanitizedToolEvent[]): boolean {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.tool, (counts.get(event.tool) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 3);
}

function isReadTool(tool: string): boolean {
  return [
    "read-api-response",
    "read-file",
    "read-file-snippet",
    "read-js-symbol"
  ].includes(tool);
}

function nextActionHintForCategory(category: FailureCategory): string {
  switch (category) {
    case "context-heavy":
      return "prefer narrower seed filters and node-id reads before broad listing";
    case "discovery-only":
      return "after seed discovery, trace the selected node id and read bounded evidence";
    case "missing-api-metadata":
      return "link endpoint-like seeds to list-api-routes or read-api-response metadata";
    case "missing-bounded-read":
      return "follow traces with read-js-symbol, read-file, or read-api-response";
    case "missing-evidence":
      return "continue until every task evidence observation is present";
    case "missing-required-tools":
      return "call the task-required MCP tools instead of ending with prose";
    case "missing-text-scan":
      return "analyze an oversized JS file and confirm text-scan degradation";
    case "runner-failure":
      return "rerun this task with a tool-capable model or inspect the sanitized runner error";
    case "tool-error":
      return "retry with corrected sanitized arguments or inspect the failing tool";
    case "tool-loop":
      return "switch to the next workflow step when repeated calls add no evidence";
    case "tool-starved":
      return "start with discovery, then make a concrete semantic/search/read call";
    case "trace-unproductive":
      return "try a different discovered node id, endpoint, selector, or path filter";
  }
}

function scoreContextSafety(report: RunReport, events: SanitizedToolEvent[]) {
  const largestToolOutput = Math.max(
    0,
    ...events.map((event) => event.bytesSentToModel)
  );
  let points = 0;
  if (largestToolOutput <= 32 * 1024) points += 8;
  else if (largestToolOutput <= 64 * 1024) points += 5;
  else points += 2;

  if (report.totals.toolBytesSentToModel <= 384 * 1024) points += 4;
  else if (report.totals.toolBytesSentToModel <= 768 * 1024) points += 2;

  if (
    events.some(
      (event) =>
        event.truncatedForModel ||
        event.observations.readTruncated ||
        event.observations.parseSkippedReason === "file-too-large"
    ) ||
    report.totals.toolBytesSentToModel <= 128 * 1024
  ) {
    points += 3;
  }

  return Math.min(15, points);
}

function scoreTaskAssessment(text: string): number {
  const lower = text.toLowerCase();
  const checks = [
    text.length >= 600,
    lower.includes("evidence") || lower.includes("trace"),
    lower.includes("bounded") || lower.includes("context"),
    lower.includes("recommend") || lower.includes("next"),
    !/\/Users\/|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i.test(text)
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 10);
}

function renderFailureAnalysisRows(tasks: TaskScore[]): string[] {
  if (tasks.length === 0) {
    return ["| `n/a` | `n/a` | none | no action needed |"];
  }
  return tasks.map((task) => {
    const categories = task.failureCategories
      .map((category) => `\`${category}\``)
      .join(", ");
    const nextAction = task.nextActionHints.slice(0, 2).join("; ");
    return `| \`${task.model}\` | \`${task.taskId}\` | ${categories} | ${escapeMarkdownCell(
      nextAction
    )} |`;
  });
}

function renderTaskFindings(tasks: TaskScore[]): string[] {
  const findings: string[] = [];
  const categories = tasks.flatMap((task) => task.failureCategories);
  if (tasks.some((task) => task.error)) {
    findings.push(
      "- Some model/task pairs could not run because the selected backend failed or did not support tool use."
    );
  }
  if (
    tasks.some((task) => {
      const evidence = Number.parseInt(
        task.evidenceStatus.split("/")[0] ?? "0",
        10
      );
      return evidence < 2;
    })
  ) {
    findings.push(
      "- Shallow completions are visible now: a model can finish the task prose but still miss the required evidence chain."
    );
  }
  if (categories.includes("tool-starved")) {
    findings.push(
      "- Tool-starved failures show models stopping before they have enough MCP evidence to answer the task."
    );
  }
  if (categories.includes("discovery-only")) {
    findings.push(
      "- Discovery-only failures show that seeds and node ids need to be followed by trace and bounded-read evidence."
    );
  }
  if (categories.includes("trace-unproductive")) {
    findings.push(
      "- Some traces were unproductive, so agents need to retry with another discovered seed or a narrower path filter."
    );
  }
  if (categories.includes("context-heavy")) {
    findings.push(
      "- Context-heavy runs are visible as a reporting risk even when the final task score remains strong."
    );
  }
  if (tasks.some((task) => task.truncatedToolResults > 0)) {
    findings.push(
      "- Truncated tool results remain common for deeper inspections, so compact previews and follow-up node ids are part of the agent-grade contract."
    );
  }
  findings.push(
    "- Source maps are intentionally not part of the score; the eval rewards source-map-independent reconstruction."
  );
  return findings;
}

function summarizeValueShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object") {
    return `object(${Object.keys(value as Record<string, unknown>).length})`;
  }
  return typeof value;
}

function collectTraceStepKinds(items: unknown[]) {
  const stepKinds: string[] = [];
  for (const item of items) {
    const steps = getArrayProperty(item, "steps");
    if (!steps) continue;
    for (const step of steps) {
      const kind = getStringProperty(step, "kind");
      if (kind) stepKinds.push(kind);
    }
  }
  return stepKinds;
}

function collectStringValues(
  value: unknown,
  key: string,
  limit: number
): string[] {
  const results: string[] = [];
  const queue: unknown[] = [value];
  while (queue.length > 0 && results.length < limit) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      queue.push(...current.slice(0, 50));
      continue;
    }
    for (const [entryKey, entryValue] of Object.entries(
      current as Record<string, unknown>
    )) {
      if (entryKey === key && typeof entryValue === "string") {
        results.push(entryValue);
        if (results.length >= limit) break;
        continue;
      }
      if (entryValue && typeof entryValue === "object") {
        queue.push(entryValue);
      }
    }
  }
  return results;
}

function hasApiMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.fixtureDir === "string" ||
    typeof record.bodyPath === "string" ||
    Boolean(record.body && typeof record.body === "object")
  );
}

function getArrayProperty(value: unknown, key: string): unknown[] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const property = (value as Record<string, unknown>)[key];
  return Array.isArray(property) ? property : undefined;
}

function getObjectProperty(
  value: unknown,
  key: string
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const property = (value as Record<string, unknown>)[key];
  return property && typeof property === "object" && !Array.isArray(property)
    ? (property as Record<string, unknown>)
    : undefined;
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : undefined;
}

function getBooleanProperty(value: unknown, key: string): boolean | undefined {
  if (!value || typeof value !== "object") return undefined;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "boolean" ? property : undefined;
}

function getNestedBooleanProperty(
  value: unknown,
  path: readonly string[]
): boolean | undefined {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "boolean" ? current : undefined;
}

function component(
  name: string,
  points: number,
  max: number,
  reason: string
): ComponentScore {
  return { name, points: Math.min(max, Math.max(0, points)), max, reason };
}

function gradeForScore(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}
