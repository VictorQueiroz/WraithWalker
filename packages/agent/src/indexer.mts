import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { embedMany } from "ai";
import {
  readApiFixture,
  readOriginInfo,
  type StaticResourceManifestEntry
} from "@wraithwalker/core/fixtures";

import type { AgentDatabase, ChunkInput, IndexStateRecord } from "./db.mjs";
import type { AgentModelProvider } from "./gateway.mjs";
import type { AgentProject } from "./projects.mjs";

export const MAX_CHUNK_CHARS = 2000;
export const EMBED_BATCH_SIZE = 64;
const MANIFEST_ENTRIES_PER_CHUNK = 40;
const API_BODY_EXCERPT_BYTES = 1400;

export interface ProjectChunk {
  origin: string;
  kind: "api" | "assets" | "trace";
  refPath: string;
  content: string;
}

export interface IndexProjectDependencies {
  rootPath: string;
  db: AgentDatabase;
  provider: AgentModelProvider;
}

export interface IndexProjectResult {
  projectId: string;
  chunkCount: number;
  embeddedCount: number;
  removedCount: number;
  state: IndexStateRecord;
}

export function boundChunkText(text: string, maxChars = MAX_CHUNK_CHARS) {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n[truncated ${text.length - maxChars} chars]`;
}

export function chunkContentHash(chunk: ProjectChunk): string {
  return createHash("sha256")
    .update(`${chunk.kind}\n${chunk.refPath}\n${chunk.content}`)
    .digest("hex")
    .slice(0, 32);
}

async function readJsonIfPresent<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function describeManifestEntries(
  pathnames: [string, StaticResourceManifestEntry[]][]
): string {
  return pathnames
    .map(([pathname, entries]) => {
      const first = entries[0];
      return `${pathname} (${first?.mimeType || "unknown"}, ${entries.length} capture${entries.length === 1 ? "" : "s"})`;
    })
    .join("\n");
}

async function buildApiChunks(
  rootPath: string,
  origin: string,
  project: AgentProject
): Promise<ProjectChunk[]> {
  const info = await readOriginInfo(rootPath, { origin });
  const chunks: ProjectChunk[] = [];

  for (const endpoint of info.apiEndpoints) {
    const fixture = await readApiFixture(rootPath, endpoint.fixtureDir, {
      maxBytes: API_BODY_EXCERPT_BYTES
    });
    if (!fixture) {
      continue;
    }

    const request = await readJsonIfPresent<{ url?: string; body?: string }>(
      path.join(rootPath, endpoint.fixtureDir, "request.json")
    );
    const lines = [
      `[api capture] ${endpoint.method} ${request?.url ?? endpoint.pathname}`,
      `project ${project.id}; captured under ${origin}`,
      `status ${fixture.meta.status} ${fixture.meta.statusText}; mime ${fixture.meta.mimeType}`
    ];
    if (request?.body) {
      lines.push(`request body: ${request.body.slice(0, 300)}`);
    }
    if (fixture.body && fixture.body.text) {
      lines.push(`response body: ${fixture.body.text}`);
    }

    chunks.push({
      origin,
      kind: "api",
      refPath: endpoint.fixtureDir,
      content: boundChunkText(lines.join("\n"))
    });
  }

  if (info.manifest) {
    const entries = Object.entries(info.manifest.resourcesByPathname);
    for (
      let index = 0;
      index < entries.length;
      index += MANIFEST_ENTRIES_PER_CHUNK
    ) {
      const slice = entries.slice(index, index + MANIFEST_ENTRIES_PER_CHUNK);
      chunks.push({
        origin,
        kind: "assets",
        refPath: `${info.manifestPath ?? origin}#${index}`,
        content: boundChunkText(
          [
            `[static assets] captured for ${origin} (project ${project.id})`,
            describeManifestEntries(slice)
          ].join("\n")
        )
      });
    }
  }

  return chunks;
}

function buildTraceChunks(project: AgentProject): ProjectChunk[] {
  return project.tabLinks.map((link, index) => ({
    origin: link.origin,
    kind: "trace" as const,
    refPath: `trace-link#${index}`,
    content: boundChunkText(
      [
        `[tab capture link] requests to ${link.origin} were captured while browsing ${link.pageUrl}`,
        `browser tab ${link.tabId}; project ${project.id}`
      ].join("\n")
    )
  }));
}

export async function buildProjectChunks(
  rootPath: string,
  project: AgentProject
): Promise<ProjectChunk[]> {
  const chunks: ProjectChunk[] = [];
  for (const origin of project.origins) {
    chunks.push(...(await buildApiChunks(rootPath, origin.origin, project)));
  }

  chunks.push(...buildTraceChunks(project));
  return chunks;
}

export async function indexProject(
  deps: IndexProjectDependencies,
  project: AgentProject
): Promise<IndexProjectResult> {
  const { rootPath, db, provider } = deps;

  db.setIndexState({
    projectId: project.id,
    status: "indexing",
    chunkCount: db.countProjectChunks(project.id),
    model: provider.embeddingModelId,
    error: null,
    indexedAt: null
  });

  try {
    const chunks = await buildProjectChunks(rootPath, project);
    const desired = new Map(
      chunks.map((chunk) => [chunkContentHash(chunk), chunk])
    );
    const existing = db.getProjectChunkHashes(project.id);

    const staleIds = [...existing.entries()]
      .filter(([hash]) => !desired.has(hash))
      .map(([, id]) => id);
    const pending = [...desired.entries()].filter(
      ([hash]) => !existing.has(hash)
    );

    let embeddedCount = 0;
    for (let index = 0; index < pending.length; index += EMBED_BATCH_SIZE) {
      const batch = pending.slice(index, index + EMBED_BATCH_SIZE);
      const { embeddings } = await embedMany({
        model: provider.embeddingModel(),
        values: batch.map(([, chunk]) => chunk.content)
      });

      const inserts: ChunkInput[] = batch.map(([hash, chunk], offset) => ({
        origin: chunk.origin,
        kind: chunk.kind,
        refPath: chunk.refPath,
        content: chunk.content,
        contentHash: hash,
        embedding: Float32Array.from(embeddings[offset])
      }));
      db.insertChunks(project.id, inserts);
      embeddedCount += inserts.length;
    }

    db.deleteChunksByIds(staleIds);

    const state: IndexStateRecord = {
      projectId: project.id,
      status: "ready",
      chunkCount: db.countProjectChunks(project.id),
      model: provider.embeddingModelId,
      error: null,
      indexedAt: new Date().toISOString()
    };
    db.setIndexState(state);

    return {
      projectId: project.id,
      chunkCount: state.chunkCount,
      embeddedCount,
      removedCount: staleIds.length,
      state
    };
  } catch (error) {
    const state: IndexStateRecord = {
      projectId: project.id,
      status: "error",
      chunkCount: db.countProjectChunks(project.id),
      model: provider.embeddingModelId,
      error: error instanceof Error ? error.message : String(error),
      indexedAt: null
    };
    db.setIndexState(state);
    throw error;
  }
}

export async function ensureProjectIndexed(
  deps: IndexProjectDependencies,
  project: AgentProject,
  options: { force?: boolean } = {}
): Promise<IndexStateRecord> {
  const current = deps.db.getIndexState(project.id);
  if (
    !options.force &&
    current &&
    current.status === "ready" &&
    current.chunkCount > 0
  ) {
    return current;
  }

  const result = await indexProject(deps, project);
  return result.state;
}
