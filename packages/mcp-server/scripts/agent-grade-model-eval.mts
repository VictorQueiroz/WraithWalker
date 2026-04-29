#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  AGENT_EVAL_TASKS,
  aggregateModelScore,
  renderTaskScoreMarkdown,
  sanitizeText,
  scoreTaskFailure,
  scoreTaskRun,
  type AgentEvalTask,
  type ModelEvalResult,
  type RunReport
} from "./agent-grade-eval-core.mts";

const DEFAULT_OUTPUT_PATH = "docs/evals/agent-grade-js-tools.md";
const DEFAULT_MAX_STEPS = 5;
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;

interface EvalOptions {
  rootPath: string;
  models: string[];
  tasks: AgentEvalTask[];
  outputPath: string;
  reportsDir: string;
  maxSteps: number;
  requestTimeoutMs: number;
}

async function main(): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const options = parseArgs(process.argv.slice(2), repoRoot);
  await fs.mkdir(options.reportsDir, { recursive: true });

  const results: ModelEvalResult[] = [];
  for (const model of options.models) {
    const taskScores = [];
    for (const task of options.tasks) {
      const reportPath = path.join(
        options.reportsDir,
        `${sanitizeFilePart(model)}__${task.id}.json`
      );
      try {
        await runSingleModelTask({
          repoRoot,
          rootPath: options.rootPath,
          model,
          task,
          reportPath,
          maxSteps: options.maxSteps,
          requestTimeoutMs: options.requestTimeoutMs
        });
        const report = JSON.parse(
          await fs.readFile(reportPath, "utf8")
        ) as RunReport;
        taskScores.push(scoreTaskRun(report, task));
      } catch (error) {
        taskScores.push(scoreTaskFailure(model, task, error));
      }
    }
    results.push({ model, tasks: taskScores });
  }

  const markdown = renderTaskScoreMarkdown({
    rootPath: options.rootPath,
    results
  });
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.writeFile(options.outputPath, markdown, "utf8");

  process.stdout.write(
    `${JSON.stringify(
      {
        outputPath: options.outputPath,
        reportsDir: options.reportsDir,
        models: results.map((result) => {
          const score = aggregateModelScore(result.model, result.tasks);
          return {
            model: score.model,
            score: score.total,
            grade: score.grade,
            completedTasks: `${score.completedTasks}/${score.taskCount}`,
            toolCalls: score.toolCalls,
            bytesSentToModel: score.bytesSentToModel,
            elapsedMs: Math.round(score.elapsedMs)
          };
        })
      },
      null,
      2
    )}\n`
  );
}

function parseArgs(args: string[], repoRoot: string): EvalOptions {
  let rootPath =
    process.env.WRAITHWALKER_AGENT_ROOT ??
    process.env.WRAITHWALKER_LIVE_DOGFOOD_ROOT ??
    "";
  const models: string[] = [];
  let taskIds = splitOptionalList(process.env.WRAITHWALKER_AGENT_EVAL_TASKS);
  let outputPath =
    process.env.WRAITHWALKER_AGENT_MODEL_EVAL_MD ?? DEFAULT_OUTPUT_PATH;
  let reportsDir =
    process.env.WRAITHWALKER_AGENT_MODEL_EVAL_REPORTS_DIR ??
    path.join(os.tmpdir(), "wraithwalker-agent-grade-model-evals");
  let maxSteps = parseIntegerEnv("WRAITHWALKER_AGENT_LLM_MAX_STEPS");
  let requestTimeoutMs = parseIntegerEnv(
    "WRAITHWALKER_AGENT_LLM_REQUEST_TIMEOUT_MS"
  );

  const envModels = process.env.AI_GATEWAY_EVAL_MODELS?.trim();
  if (envModels) {
    models.push(...splitList(envModels));
  }

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
      models.push(requireValue(args, ++index, arg));
      continue;
    }
    if (arg === "--models") {
      models.push(...splitList(requireValue(args, ++index, arg)));
      continue;
    }
    if (arg === "--task") {
      taskIds.push(requireValue(args, ++index, arg));
      continue;
    }
    if (arg === "--tasks") {
      taskIds.push(...splitList(requireValue(args, ++index, arg)));
      continue;
    }
    if (arg === "--output") {
      outputPath = requireValue(args, ++index, arg);
      continue;
    }
    if (arg === "--reports-dir") {
      reportsDir = requireValue(args, ++index, arg);
      continue;
    }
    if (arg === "--max-steps") {
      maxSteps = parsePositiveInt(requireValue(args, ++index, arg), arg);
      continue;
    }
    if (arg === "--request-timeout-ms") {
      requestTimeoutMs = parsePositiveInt(
        requireValue(args, ++index, arg),
        arg
      );
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
  if (models.length === 0) {
    models.push("deepseek/deepseek-v3.2");
  }

  const tasks = selectTasks(taskIds);
  return {
    rootPath: path.resolve(rootPath),
    models: [...new Set(models)],
    tasks,
    outputPath: path.resolve(repoRoot, outputPath),
    reportsDir: path.resolve(reportsDir),
    maxSteps: maxSteps ?? DEFAULT_MAX_STEPS,
    requestTimeoutMs: requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  };
}

async function runSingleModelTask({
  repoRoot,
  rootPath,
  model,
  task,
  reportPath,
  maxSteps,
  requestTimeoutMs
}: {
  repoRoot: string;
  rootPath: string;
  model: string;
  task: AgentEvalTask;
  reportPath: string;
  maxSteps: number;
  requestTimeoutMs: number;
}): Promise<void> {
  const args = [
    "run",
    "dogfood:agent:llm",
    "-w",
    "@wraithwalker/mcp-server",
    "--",
    "--root",
    rootPath,
    "--model",
    model,
    "--task-id",
    task.id,
    "--objective",
    task.objective,
    "--report",
    reportPath,
    "--max-steps",
    String(maxSteps),
    "--request-timeout-ms",
    String(requestTimeoutMs)
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "npm.cmd" : "npm",
      args,
      {
        cwd: repoRoot,
        env: process.env,
        stdio: ["ignore", "inherit", "inherit"]
      }
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Model eval for ${model}/${task.id} exited with code ${code}.`
        )
      );
    });
  });
}

function selectTasks(taskIds: string[]): AgentEvalTask[] {
  if (taskIds.length === 0) return [...AGENT_EVAL_TASKS];
  const tasks = [];
  for (const taskId of [...new Set(taskIds)]) {
    const task = AGENT_EVAL_TASKS.find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error(
        `Unknown task "${sanitizeText(taskId)}". Available tasks: ${AGENT_EVAL_TASKS.map(
          (candidate) => candidate.id
        ).join(", ")}.`
      );
    }
    tasks.push(task);
  }
  return tasks;
}

async function findRepoRoot(startPath: string): Promise<string> {
  let current = path.resolve(startPath);
  while (true) {
    try {
      const raw = await fs.readFile(path.join(current, "package.json"), "utf8");
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

function splitOptionalList(value: string | undefined): string[] {
  return value ? splitList(value) : [];
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-z0-9_.-]+/gi, "_");
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
  npm run dogfood:agent:models -w @wraithwalker/mcp-server -- --root /path/to/capture-root --models deepseek/deepseek-v3.2,provider/model

Options:
  --root <path>             WraithWalker capture root to inspect
  --model <id>              Add one model id
  --models <ids>            Comma-separated model ids
  --task <id>               Add one labeled task id
  --tasks <ids>             Comma-separated task ids
  --output <path>           Markdown score file (default: ${DEFAULT_OUTPUT_PATH})
  --reports-dir <path>      Raw JSON report directory (default: OS temp)
  --max-steps <n>           Max model tool-planning turns per task
  --request-timeout-ms <n>  Gateway and MCP request timeout

Tasks:
  ${AGENT_EVAL_TASKS.map((task) => task.id).join(", ")}
`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
