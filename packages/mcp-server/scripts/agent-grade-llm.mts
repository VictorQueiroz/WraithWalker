#!/usr/bin/env node
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  extractToolObservations,
  sanitizeArgumentShape,
  type SanitizedToolEvent
} from "./agent-grade-eval-core.mts";
import { startHttpServer } from "../src/server.mts";

const CHEAP_MODEL_PREFERENCES = [
  "deepseek/deepseek-v3.2",
  "deepseek/deepseek-v3.1",
  "deepseek/deepseek-chat",
  "deepseek/deepseek-r1"
];
const DEFAULT_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
const DEFAULT_MAX_STEPS = 8;
const DEFAULT_TOOL_OUTPUT_BYTES = 24 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
const NON_PRIVATE_DOMAIN_LABELS = new Set([
  "assets",
  "cdn",
  "com",
  "dev",
  "example",
  "html",
  "http",
  "https",
  "local",
  "localhost",
  "net",
  "org",
  "static",
  "test",
  "www"
]);

const READ_ONLY_TOOL_NAMES = new Set([
  "analyze-js-file",
  "list-api-routes",
  "list-files",
  "list-sites",
  "read-api-response",
  "read-file",
  "read-file-snippet",
  "read-js-symbol",
  "search-files",
  "search-js",
  "suggest-js-seeds",
  "trace-js-pipeline"
]);

interface ScriptOptions {
  rootPath: string;
  model: string | null;
  gatewayBaseUrl: string;
  maxSteps: number;
  maxToolOutputBytes: number;
  requestTimeoutMs: number;
  reportPath: string | null;
  taskId: string | null;
  objective: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: ChatMessage;
    finish_reason?: string;
  }>;
  usage?: unknown;
}

interface GatewayModelSummary {
  id: string;
  name?: string;
  pricing?: {
    input?: string | number;
    output?: string | number;
  };
}

interface ToolMetric {
  step: number;
  tool: string;
  durationMs: number;
  returnedBytes: number;
  bytesSentToModel: number;
  truncatedForModel: boolean;
  ok: boolean;
}

interface ModelMetric {
  step: number;
  durationMs: number;
  promptBytes: number;
  responseBytes: number;
  toolCalls: number;
}

interface RunReport {
  name: string;
  taskId: string | null;
  model: string;
  rootHash: string;
  elapsedMs: number;
  maxSteps: number;
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
  modelMetrics: ModelMetric[];
  toolMetrics: ToolMetric[];
  toolEvents: SanitizedToolEvent[];
  availableReadOnlyTools: string[];
}

async function resolveGatewayModel({
  apiKey,
  baseUrl,
  requestedModel,
  requestTimeoutMs
}: {
  apiKey: string;
  baseUrl: string;
  requestedModel: string | null;
  requestTimeoutMs: number;
}): Promise<string> {
  if (requestedModel?.trim()) {
    return requestedModel.trim();
  }

  const models = await listGatewayModels({ apiKey, baseUrl, requestTimeoutMs });
  const modelIds = new Set(models.map((model) => model.id));
  const preferred = CHEAP_MODEL_PREFERENCES.find((model) =>
    modelIds.has(model)
  );
  if (preferred) {
    return preferred;
  }

  const deepSeekModels = models
    .filter((model) => model.id.toLowerCase().startsWith("deepseek/"))
    .sort(compareGatewayModelsByEstimatedCost);
  if (deepSeekModels[0]) {
    return deepSeekModels[0].id;
  }

  throw new Error(
    "Could not find a DeepSeek model in the AI Gateway catalog. Pass --model to choose one explicitly."
  );
}

async function listGatewayModels({
  apiKey,
  baseUrl,
  requestTimeoutMs
}: {
  apiKey: string;
  baseUrl: string;
  requestTimeoutMs: number;
}): Promise<GatewayModelSummary[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `AI Gateway model catalog failed with ${response.status}: ${text.slice(
          0,
          1000
        )}`
      );
    }
    const parsed = JSON.parse(text) as {
      data?: unknown;
      models?: unknown;
    };
    const rawModels = Array.isArray(parsed.data)
      ? parsed.data
      : Array.isArray(parsed.models)
        ? parsed.models
        : [];
    return rawModels
      .map((model) => {
        if (!model || typeof model !== "object") return null;
        const id = (model as { id?: unknown }).id;
        if (typeof id !== "string") return null;
        return model as GatewayModelSummary;
      })
      .filter((model): model is GatewayModelSummary => Boolean(model));
  } finally {
    clearTimeout(timeout);
  }
}

function compareGatewayModelsByEstimatedCost(
  left: GatewayModelSummary,
  right: GatewayModelSummary
): number {
  return estimateGatewayModelCost(left) - estimateGatewayModelCost(right);
}

function estimateGatewayModelCost(model: GatewayModelSummary): number {
  const input = Number(model.pricing?.input ?? 0);
  const output = Number(model.pricing?.output ?? 0);
  const cost = input + output;
  return Number.isFinite(cost) && cost > 0 ? cost : Number.MAX_SAFE_INTEGER;
}

async function main(): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  await loadDotEnv(path.join(repoRoot, ".env"));

  const options = parseArgs(process.argv.slice(2));
  const privacyTerms = new Set<string>();
  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "AI_GATEWAY_API_KEY is required. Add it to .env or export it in the shell."
    );
  }
  const model = await resolveGatewayModel({
    apiKey,
    baseUrl: options.gatewayBaseUrl,
    requestedModel: options.model,
    requestTimeoutMs: options.requestTimeoutMs
  });

  const startedAt = performance.now();
  const server = await startHttpServer(options.rootPath, {
    host: "127.0.0.1",
    port: 0
  });
  const client = new Client({
    name: "wraithwalker-agent-grade-llm",
    version: "1.0.0"
  });

  const toolMetrics: ToolMetric[] = [];
  const toolEvents: SanitizedToolEvent[] = [];
  const modelMetrics: ModelMetric[] = [];

  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url))
    );
    const { tools: mcpTools } = await client.listTools();
    const readOnlyTools = mcpTools
      .filter((tool) => READ_ONLY_TOOL_NAMES.has(tool.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    const openAiTools = readOnlyTools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description ?? `Call the ${tool.name} MCP tool.`,
        parameters: tool.inputSchema ?? {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      }
    }));

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt(options)
      },
      {
        role: "user",
        content: options.objective
      }
    ];

    let finalText = "";
    let completed = false;

    for (let step = 1; step <= options.maxSteps; step += 1) {
      const modelStart = performance.now();
      const completion = await callAiGateway({
        apiKey,
        baseUrl: options.gatewayBaseUrl,
        model,
        messages,
        tools: openAiTools,
        requestTimeoutMs: options.requestTimeoutMs
      });
      const responseText = JSON.stringify(completion);
      const message = completion.choices?.[0]?.message;
      const toolCalls = message?.tool_calls ?? [];

      modelMetrics.push({
        step,
        durationMs: performance.now() - modelStart,
        promptBytes: Buffer.byteLength(JSON.stringify(messages), "utf8"),
        responseBytes: Buffer.byteLength(responseText, "utf8"),
        toolCalls: toolCalls.length
      });

      if (!message) {
        throw new Error(`AI Gateway response did not include a message.`);
      }

      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      });

      if (toolCalls.length === 0) {
        finalText = message.content ?? "";
        completed = true;
        break;
      }

      for (const toolCall of toolCalls) {
        const toolStart = performance.now();
        const name = toolCall.function.name;
        const args = parseToolArguments(toolCall.function.arguments);
        const argumentShape = sanitizeArgumentShape(args);
        let ok = true;
        let rawToolText = "";

        try {
          if (!READ_ONLY_TOOL_NAMES.has(name)) {
            throw new Error(`Tool "${name}" is not allowed in this benchmark.`);
          }

          const result = await client.callTool(
            {
              name,
              arguments: args
            },
            undefined,
            { timeout: options.requestTimeoutMs }
          );
          rawToolText = readMcpTextContent(result);
        } catch (error) {
          ok = false;
          rawToolText = JSON.stringify({
            error: error instanceof Error ? error.message : String(error)
          });
        }

        collectPrivacyTerms(rawToolText, privacyTerms);
        const bounded = boundToolText(rawToolText, options.maxToolOutputBytes);
        const metric = {
          step,
          tool: name,
          durationMs: performance.now() - toolStart,
          returnedBytes: Buffer.byteLength(rawToolText, "utf8"),
          bytesSentToModel: Buffer.byteLength(bounded, "utf8"),
          truncatedForModel: bounded !== rawToolText,
          ok
        };
        toolMetrics.push(metric);
        toolEvents.push({
          ...metric,
          argumentShape,
          observations: extractToolObservations(name, rawToolText)
        });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: bounded
        });
      }
    }

    if (!completed) {
      messages.push({
        role: "user",
        content:
          "Stop using tools now. Return a concise final benchmark assessment with findings, missing capabilities, and recommended next tests. Keep it privacy-preserving."
      });
      const completion = await callAiGateway({
        apiKey,
        baseUrl: options.gatewayBaseUrl,
        model,
        messages,
        tools: [],
        requestTimeoutMs: options.requestTimeoutMs
      });
      finalText = completion.choices?.[0]?.message?.content ?? "";
      completed = Boolean(finalText);
    }

    const redactedFinalText = redactText(finalText, privacyTerms);
    const report = buildReport({
      model,
      rootPath: options.rootPath,
      taskId: options.taskId,
      elapsedMs: performance.now() - startedAt,
      maxSteps: options.maxSteps,
      completed,
      finalText: redactedFinalText,
      redactedTerms: privacyTerms.size,
      toolMetrics,
      toolEvents,
      modelMetrics,
      availableReadOnlyTools: readOnlyTools.map((tool) => tool.name)
    });

    if (options.reportPath) {
      await fs.mkdir(path.dirname(options.reportPath), { recursive: true });
      await fs.writeFile(
        options.reportPath,
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8"
      );
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          completed: report.completed,
          taskId: report.taskId,
          model: report.model,
          elapsedMs: Math.round(report.elapsedMs),
          totals: report.totals,
          reportPath: options.reportPath,
          redactedTerms: report.redactedTerms,
          finalTextBytes: Buffer.byteLength(report.finalText, "utf8")
        },
        null,
        2
      )}\n`
    );
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

function parseArgs(args: string[]): ScriptOptions {
  let rootPath =
    process.env.WRAITHWALKER_AGENT_ROOT ??
    process.env.WRAITHWALKER_LIVE_DOGFOOD_ROOT ??
    "";
  let model = process.env.AI_GATEWAY_MODEL ?? null;
  let gatewayBaseUrl =
    process.env.AI_GATEWAY_BASE_URL ?? DEFAULT_GATEWAY_BASE_URL;
  let maxSteps = parseIntegerEnv("WRAITHWALKER_AGENT_LLM_MAX_STEPS");
  let maxToolOutputBytes = parseIntegerEnv(
    "WRAITHWALKER_AGENT_LLM_TOOL_OUTPUT_BYTES"
  );
  let requestTimeoutMs = parseIntegerEnv(
    "WRAITHWALKER_AGENT_LLM_REQUEST_TIMEOUT_MS"
  );
  let reportPath = process.env.WRAITHWALKER_AGENT_LLM_REPORT_PATH ?? null;
  let taskId = process.env.WRAITHWALKER_AGENT_LLM_TASK_ID ?? null;
  let objective =
    process.env.WRAITHWALKER_AGENT_LLM_OBJECTIVE ??
    [
      "Inspect this WraithWalker capture root as an AI coding agent.",
      "Use the MCP tools to discover sites, scripts, JS seeds, pipeline traces, bounded snippets, and huge-bundle behavior.",
      "Return a concise assessment of whether the JS tools feel agent-grade, with concrete gaps and next tests.",
      "Do not include private domain names, product names, or capture-specific literal strings in the final answer."
    ].join(" ");

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--root") {
      rootPath = requireValue(args, ++index, arg);
      continue;
    }
    if (arg === "--model") {
      model = requireValue(args, ++index, arg);
      continue;
    }
    if (arg === "--gateway-base-url") {
      gatewayBaseUrl = requireValue(args, ++index, arg);
      continue;
    }
    if (arg === "--max-steps") {
      maxSteps = parsePositiveInt(requireValue(args, ++index, arg), arg);
      continue;
    }
    if (arg === "--tool-output-bytes") {
      maxToolOutputBytes = parsePositiveInt(
        requireValue(args, ++index, arg),
        arg
      );
      continue;
    }
    if (arg === "--request-timeout-ms") {
      requestTimeoutMs = parsePositiveInt(
        requireValue(args, ++index, arg),
        arg
      );
      continue;
    }
    if (arg === "--report") {
      reportPath = requireValue(args, ++index, arg);
      continue;
    }
    if (arg === "--task-id") {
      taskId = requireValue(args, ++index, arg);
      continue;
    }
    if (arg === "--objective") {
      objective = requireValue(args, ++index, arg);
      continue;
    }
    if (!arg.startsWith("-") && !rootPath) {
      rootPath = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!rootPath) {
    throw new Error(
      "A capture root path is required. Pass --root /path/to/root or set WRAITHWALKER_AGENT_ROOT."
    );
  }

  return {
    rootPath: path.resolve(rootPath),
    model,
    gatewayBaseUrl: gatewayBaseUrl.replace(/\/+$/, ""),
    maxSteps: maxSteps ?? DEFAULT_MAX_STEPS,
    maxToolOutputBytes: maxToolOutputBytes ?? DEFAULT_TOOL_OUTPUT_BYTES,
    requestTimeoutMs: requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    reportPath: reportPath ? path.resolve(reportPath) : null,
    taskId,
    objective
  };
}

async function callAiGateway({
  apiKey,
  baseUrl,
  model,
  messages,
  tools,
  requestTimeoutMs
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  tools: unknown[];
  requestTimeoutMs: number;
}): Promise<ChatCompletionResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? "auto" : undefined,
        temperature: 0.1,
        max_tokens: 1800
      }),
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `AI Gateway request failed with ${response.status}: ${text.slice(
          0,
          1000
        )}`
      );
    }

    return JSON.parse(text) as ChatCompletionResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function buildSystemPrompt(options: ScriptOptions): string {
  return [
    "You are an AI coding agent dogfooding WraithWalker MCP tools.",
    "You may only inspect through the provided read-only MCP tools.",
    "Use a progressive workflow: list sites, list files, identify huge/medium/small scripts, suggest JS seeds, search JS facts, trace at least one pipeline, and read bounded snippets or pages.",
    "Prefer suggest-js-seeds before guessing search literals.",
    "Treat bounded output and text-scan degradation as expected behavior for huge bundles.",
    "Your final answer must be privacy-preserving: never name captured origins, private domain names, product names, personal names, exact capture-specific literals, tokens, or absolute local paths.",
    "Refer to captured sites only as Origin A, Origin B, and so on.",
    "Evaluate agent-grade quality: task success, discoverability, compactness, false-positive noise, missing links, and concrete next tests.",
    `Stop after at most ${options.maxSteps} tool-planning turns.`
  ].join("\n");
}

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Tool arguments must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function readMcpTextContent(result: unknown): string {
  if (!result || typeof result !== "object") {
    return JSON.stringify(result);
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return JSON.stringify(result);
  }
  return content
    .map((item) => {
      if (
        item &&
        typeof item === "object" &&
        (item as { type?: unknown }).type === "text" &&
        typeof (item as { text?: unknown }).text === "string"
      ) {
        return (item as { text: string }).text;
      }
      return JSON.stringify(item);
    })
    .join("\n");
}

function boundToolText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }
  const head = Buffer.from(text, "utf8")
    .subarray(0, Math.max(0, maxBytes - 256))
    .toString("utf8");
  return JSON.stringify({
    toolResultTruncatedForModel: true,
    originalBytes: Buffer.byteLength(text, "utf8"),
    preview: head
  });
}

function collectPrivacyTerms(text: string, terms: Set<string>): void {
  for (const match of text.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi)) {
    const domain = match[0].toLowerCase();
    terms.add(domain);
    for (const label of domain.split(".")) {
      if (shouldRedactDomainLabel(label)) {
        terms.add(label);
      }
    }
  }
}

function shouldRedactDomainLabel(label: string): boolean {
  return label.length >= 4 && !NON_PRIVATE_DOMAIN_LABELS.has(label);
}

function redactText(text: string, terms: Set<string>): string {
  let redacted = text
    .replace(/\/Users\/[^\s)"'`]+/g, "[local-path]")
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi, "[origin]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]");

  const sortedTerms = [...terms]
    .filter((term) => term.length >= 4 && !term.includes("."))
    .sort((left, right) => right.length - left.length);
  for (const term of sortedTerms) {
    redacted = redacted.replace(
      new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi"),
      "[redacted]"
    );
  }
  return redacted;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildReport({
  model,
  rootPath,
  taskId,
  elapsedMs,
  maxSteps,
  completed,
  finalText,
  redactedTerms,
  toolMetrics,
  toolEvents,
  modelMetrics,
  availableReadOnlyTools
}: {
  model: string;
  rootPath: string;
  taskId: string | null;
  elapsedMs: number;
  maxSteps: number;
  completed: boolean;
  finalText: string;
  redactedTerms: number;
  toolMetrics: ToolMetric[];
  toolEvents: SanitizedToolEvent[];
  modelMetrics: ModelMetric[];
  availableReadOnlyTools: string[];
}): RunReport {
  return {
    name: "agent-grade-llm",
    taskId,
    model,
    rootHash: createHash("sha256").update(rootPath).digest("hex").slice(0, 16),
    elapsedMs,
    maxSteps,
    completed,
    finalText,
    redactedTerms,
    totals: {
      modelCalls: modelMetrics.length,
      toolCalls: toolMetrics.length,
      toolReturnedBytes: toolMetrics.reduce(
        (total, metric) => total + metric.returnedBytes,
        0
      ),
      toolBytesSentToModel: toolMetrics.reduce(
        (total, metric) => total + metric.bytesSentToModel,
        0
      ),
      truncatedToolResults: toolMetrics.filter(
        (metric) => metric.truncatedForModel
      ).length
    },
    modelMetrics,
    toolMetrics,
    toolEvents,
    availableReadOnlyTools
  };
}

async function findRepoRoot(startPath: string): Promise<string> {
  let current = path.resolve(startPath);
  while (true) {
    const packagePath = path.join(current, "package.json");
    try {
      const raw = await fs.readFile(packagePath, "utf8");
      const manifest = JSON.parse(raw) as {
        name?: string;
        workspaces?: unknown;
      };
      if (manifest.name === "wraithwalker" && manifest.workspaces) {
        return current;
      }
    } catch {
      // Keep walking.
    }

    const parent = path.dirname(current);
    if (parent === current) return startPath;
    current = parent;
  }
}

async function loadDotEnv(filePath: string): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, name, value] = match;
    process.env[name] ??= unquoteEnvValue(value);
  }
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseIntegerEnv(name: string): number | null {
  const value = process.env[name]?.trim();
  return value ? parsePositiveInt(value, name) : null;
}

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function requireValue(args: string[], index: number, name: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function printHelp(): void {
  process.stdout.write(`Usage:
  npm run dogfood:agent:llm -w @wraithwalker/mcp-server -- --root /path/to/capture-root [options]

Options:
  --root <path>                WraithWalker capture root to inspect
  --model <id>                 AI Gateway model id (default: auto-select cheap DeepSeek)
  --report <path>              Write the full JSON report
  --task-id <id>               Optional labeled eval task id
  --max-steps <n>              Max model tool-planning turns (default: ${DEFAULT_MAX_STEPS})
  --tool-output-bytes <n>      Per-tool output cap passed back to the model
  --request-timeout-ms <n>     Gateway and MCP request timeout
  --objective <text>           Override the benchmark objective
`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
