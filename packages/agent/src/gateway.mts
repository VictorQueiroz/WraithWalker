import { createGateway } from "ai";
import type { EmbeddingModel, LanguageModel } from "ai";

import type { AgentEnvConfig, AgentReasoningEffort } from "./env-config.mjs";

export interface AgentModelProvider {
  modelId: string;
  embeddingModelId: string;
  reasoningEffort: AgentReasoningEffort;
  languageModel(): LanguageModel;
  embeddingModel(): EmbeddingModel;
}

export interface CreateAgentGatewayOptions {
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
}

export function createAgentGateway(
  config: AgentEnvConfig,
  options: CreateAgentGatewayOptions = {}
): AgentModelProvider | null {
  if (!config.apiKey) {
    return null;
  }

  const gateway = createGateway({
    apiKey: config.apiKey,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {})
  });

  return {
    modelId: config.model,
    embeddingModelId: config.embeddingModel,
    reasoningEffort: config.reasoningEffort,
    languageModel: () => gateway(config.model),
    embeddingModel: () => gateway.embeddingModel(config.embeddingModel)
  };
}
