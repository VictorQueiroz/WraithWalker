import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";

import type { AgentModelProvider } from "../src/gateway.mts";

export const FAKE_EMBEDDING_DIMS = 16;

export function fakeEmbedding(value: string): number[] {
  const vector = new Array<number>(FAKE_EMBEDDING_DIMS).fill(0);
  const normalized = value.toLowerCase();
  for (let index = 0; index < normalized.length; index++) {
    vector[normalized.charCodeAt(index) % FAKE_EMBEDDING_DIMS] += 1;
  }

  const magnitude = Math.sqrt(
    vector.reduce((total, component) => total + component * component, 0)
  );
  return magnitude === 0
    ? vector
    : vector.map((component) => component / magnitude);
}

export function createFakeEmbeddingModel() {
  return new MockEmbeddingModelV4({
    provider: "test",
    modelId: "test/embedding",
    maxEmbeddingsPerCall: 64,
    doEmbed: async ({ values }) => ({
      embeddings: values.map((value) => fakeEmbedding(String(value))),
      warnings: []
    })
  });
}

export function createTextStreamLanguageModel(text: string) {
  return new MockLanguageModelV4({
    provider: "test",
    modelId: "test/model",
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: text },
          { type: "text-end", id: "text-1" },
          {
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
          }
        ] as never[]
      })
    }),
    doGenerate: async () =>
      ({
        content: [{ type: "text", text }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: []
      }) as never
  });
}

export function createFakeProvider(
  options: { responseText?: string } = {}
): AgentModelProvider {
  const responseText = options.responseText ?? "fake response";
  return {
    modelId: "test/model",
    embeddingModelId: "test/embedding",
    reasoningEffort: "xhigh",
    languageModel: () => createTextStreamLanguageModel(responseText) as never,
    embeddingModel: () => createFakeEmbeddingModel() as never
  };
}
