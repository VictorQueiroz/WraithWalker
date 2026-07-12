import { describe, expect, it } from "vitest";

import type { AgentEnvConfig } from "../src/env-config.mts";
import { createAgentGateway } from "../src/gateway.mts";

function envConfig(overrides: Partial<AgentEnvConfig> = {}): AgentEnvConfig {
  return {
    apiKey: "vck_test",
    model: "deepseek/deepseek-v4-pro",
    embeddingModel: "openai/text-embedding-3-small",
    reasoningEffort: "xhigh",
    envFilePath: "/tmp/.env",
    loadedFromFile: true,
    ...overrides
  };
}

describe("createAgentGateway", () => {
  it("returns null when no API key is configured", () => {
    expect(createAgentGateway(envConfig({ apiKey: null }))).toBeNull();
  });

  it("creates a provider exposing the configured models", () => {
    const provider = createAgentGateway(envConfig());
    expect(provider).not.toBeNull();
    expect(provider!.modelId).toBe("deepseek/deepseek-v4-pro");
    expect(provider!.embeddingModelId).toBe("openai/text-embedding-3-small");
    expect(provider!.reasoningEffort).toBe("xhigh");

    const languageModel = provider!.languageModel() as {
      modelId?: string;
      specificationVersion?: string;
    };
    expect(languageModel.modelId).toBe("deepseek/deepseek-v4-pro");

    const embeddingModel = provider!.embeddingModel() as {
      modelId?: string;
    };
    expect(embeddingModel.modelId).toBe("openai/text-embedding-3-small");
  });

  it("honors base URL and fetch overrides", () => {
    const provider = createAgentGateway(envConfig(), {
      baseURL: "http://127.0.0.1:9999",
      fetch: async () => new Response("{}")
    });
    expect(provider).not.toBeNull();
  });
});
