import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_AGENT_MODEL = "deepseek/deepseek-v4-pro";
export const DEFAULT_AGENT_EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const DEFAULT_AGENT_REASONING_EFFORT = "xhigh";

export const AGENT_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
] as const;

export type AgentReasoningEffort = (typeof AGENT_REASONING_EFFORTS)[number];

export interface AgentEnvConfig {
  apiKey: string | null;
  model: string;
  embeddingModel: string;
  reasoningEffort: AgentReasoningEffort;
  envFilePath: string;
  loadedFromFile: boolean;
}

export interface LoadAgentEnvOptions {
  env?: Record<string, string | undefined>;
  homeDir?: string;
  envFilePath?: string;
}

export function resolveAgentEnvFilePath(
  env: Record<string, string | undefined> = process.env,
  homeDir: string = os.homedir()
): string {
  const configHome =
    env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() !== ""
      ? env.XDG_CONFIG_HOME
      : path.join(homeDir, ".config");

  return path.join(configHome, "wraithwalker", ".env");
}

export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const withoutExport = line.startsWith("export ")
      ? line.slice("export ".length).trimStart()
      : line;
    const separatorIndex = withoutExport.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = withoutExport.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    let value = withoutExport.slice(separatorIndex + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function normalizeReasoningEffort(value: string | undefined) {
  if (value && (AGENT_REASONING_EFFORTS as readonly string[]).includes(value)) {
    return value as AgentReasoningEffort;
  }

  return DEFAULT_AGENT_REASONING_EFFORT as AgentReasoningEffort;
}

export async function loadAgentEnv(
  options: LoadAgentEnvOptions = {}
): Promise<AgentEnvConfig> {
  const env = options.env ?? process.env;
  const envFilePath =
    options.envFilePath ?? resolveAgentEnvFilePath(env, options.homeDir);

  let fileValues: Record<string, string> = {};
  let loadedFromFile = false;
  try {
    fileValues = parseEnvFile(await fs.readFile(envFilePath, "utf-8"));
    loadedFromFile = true;
  } catch {
    fileValues = {};
  }

  const read = (key: string): string | undefined => {
    const processValue = env[key];
    if (processValue !== undefined && processValue !== "") {
      return processValue;
    }

    const fileValue = fileValues[key];
    return fileValue !== undefined && fileValue !== "" ? fileValue : undefined;
  };

  return {
    apiKey: read("AI_GATEWAY_API_KEY") ?? null,
    model: read("WRAITHWALKER_AI_MODEL") ?? DEFAULT_AGENT_MODEL,
    embeddingModel:
      read("WRAITHWALKER_AI_EMBEDDING_MODEL") ?? DEFAULT_AGENT_EMBEDDING_MODEL,
    reasoningEffort: normalizeReasoningEffort(
      read("WRAITHWALKER_AI_REASONING")
    ),
    envFilePath,
    loadedFromFile
  };
}
