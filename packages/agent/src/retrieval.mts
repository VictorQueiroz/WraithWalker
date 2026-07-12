import { embed } from "ai";

import type { AgentDatabase } from "./db.mjs";
import type { AgentModelProvider } from "./gateway.mjs";

export interface RetrievedChunk {
  origin: string;
  kind: string;
  refPath: string;
  content: string;
  score: number;
}

export interface SearchProjectChunksOptions {
  limit?: number;
  minScore?: number;
}

export const DEFAULT_RETRIEVAL_LIMIT = 6;
export const DEFAULT_RETRIEVAL_MIN_SCORE = 0.2;

export function cosineSimilarityF32(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function searchProjectChunks(
  deps: { db: AgentDatabase; provider: AgentModelProvider },
  projectId: string,
  query: string,
  options: SearchProjectChunksOptions = {}
): Promise<RetrievedChunk[]> {
  const limit = options.limit ?? DEFAULT_RETRIEVAL_LIMIT;
  const minScore = options.minScore ?? DEFAULT_RETRIEVAL_MIN_SCORE;

  const chunks = deps.db.listProjectChunks(projectId);
  if (chunks.length === 0) {
    return [];
  }

  const { embedding } = await embed({
    model: deps.provider.embeddingModel(),
    value: query
  });
  const queryVector = Float32Array.from(embedding);

  return chunks
    .map((chunk) => ({
      origin: chunk.origin,
      kind: chunk.kind,
      refPath: chunk.refPath,
      content: chunk.content,
      score: cosineSimilarityF32(queryVector, chunk.embedding)
    }))
    .filter((chunk) => chunk.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
