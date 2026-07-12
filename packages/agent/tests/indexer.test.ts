import { describe, expect, it } from "vitest";

import { createCanonicalFixtureRoot } from "../../../test-support/canonical-fixture-root.mts";
import { openAgentDatabase } from "../src/db.mts";
import {
  MAX_CHUNK_CHARS,
  boundChunkText,
  buildProjectChunks,
  chunkContentHash,
  ensureProjectIndexed,
  indexProject
} from "../src/indexer.mts";
import { getAgentProject } from "../src/projects.mts";
import { createFakeProvider } from "./test-helpers.mts";

async function createIndexingSetup() {
  const canonical = await createCanonicalFixtureRoot();
  const rootPath = canonical.root.rootPath;
  const db = await openAgentDatabase(rootPath, { dbPath: ":memory:" });
  const provider = createFakeProvider();
  const project = (await getAgentProject(rootPath, "example.com"))!;
  return { rootPath, db, provider, project };
}

describe("boundChunkText", () => {
  it("returns short text unchanged", () => {
    expect(boundChunkText("short")).toBe("short");
  });

  it("truncates long text with a marker", () => {
    const bounded = boundChunkText("x".repeat(MAX_CHUNK_CHARS + 50));
    expect(bounded).toContain("[truncated 50 chars]");
    expect(bounded.length).toBeLessThan(MAX_CHUNK_CHARS + 40);
  });
});

describe("chunkContentHash", () => {
  it("is stable for identical chunks and distinct otherwise", () => {
    const chunk = {
      origin: "o",
      kind: "api" as const,
      refPath: "r",
      content: "c"
    };
    expect(chunkContentHash(chunk)).toBe(chunkContentHash({ ...chunk }));
    expect(chunkContentHash(chunk)).not.toBe(
      chunkContentHash({ ...chunk, content: "different" })
    );
  });
});

describe("buildProjectChunks", () => {
  it("builds api and asset chunks from captured fixtures", async () => {
    const { rootPath, project } = await createIndexingSetup();
    const chunks = await buildProjectChunks(rootPath, project);

    const apiChunk = chunks.find((chunk) => chunk.kind === "api");
    expect(apiChunk).toBeTruthy();
    expect(apiChunk!.content).toContain("GET https://api.example.com/v1/items");
    expect(apiChunk!.content).toContain("canonical-item");

    const assetChunk = chunks.find((chunk) => chunk.kind === "assets");
    expect(assetChunk).toBeTruthy();
    expect(assetChunk!.content).toContain("/assets/app.js");
  });

  it("includes trace tab-link chunks", async () => {
    const { rootPath, project } = await createIndexingSetup();
    project.tabLinks.push({
      origin: "https://cdn.thirdparty.net",
      pageUrl: "https://app.example.com/dashboard",
      tabId: 4
    });

    const chunks = await buildProjectChunks(rootPath, project);
    const traceChunk = chunks.find((chunk) => chunk.kind === "trace");
    expect(traceChunk?.content).toContain("https://cdn.thirdparty.net");
    expect(traceChunk?.content).toContain("browser tab 4");
  });
});

describe("indexProject", () => {
  it("embeds chunks, stores them, and marks the index ready", async () => {
    const setup = await createIndexingSetup();
    const result = await indexProject(setup, setup.project);

    expect(result.embeddedCount).toBeGreaterThan(0);
    expect(result.chunkCount).toBe(result.embeddedCount);
    expect(result.removedCount).toBe(0);
    expect(setup.db.getIndexState("example.com")).toMatchObject({
      status: "ready",
      chunkCount: result.chunkCount
    });
    expect(
      setup.db.listProjectChunks("example.com")[0].embedding.length
    ).toBeGreaterThan(0);
  });

  it("is incremental: unchanged chunks are not re-embedded", async () => {
    const setup = await createIndexingSetup();
    await indexProject(setup, setup.project);
    const second = await indexProject(setup, setup.project);

    expect(second.embeddedCount).toBe(0);
    expect(second.removedCount).toBe(0);
  });

  it("removes stale chunks when content changes", async () => {
    const setup = await createIndexingSetup();
    await indexProject(setup, setup.project);

    setup.db.insertChunks("example.com", [
      {
        origin: "https://app.example.com",
        kind: "api",
        refPath: "stale",
        content: "stale content",
        contentHash: "stale-hash",
        embedding: Float32Array.from([1, 2])
      }
    ]);

    const result = await indexProject(setup, setup.project);
    expect(result.removedCount).toBe(1);
    expect(
      setup.db
        .listProjectChunks("example.com")
        .find((chunk) => chunk.contentHash === "stale-hash")
    ).toBeUndefined();
  });

  it("records an error state when embedding fails", async () => {
    const setup = await createIndexingSetup();
    const failingProvider = {
      ...setup.provider,
      embeddingModel: () => {
        throw new Error("embedding exploded");
      }
    };

    await expect(
      indexProject({ ...setup, provider: failingProvider }, setup.project)
    ).rejects.toThrow("embedding exploded");
    expect(setup.db.getIndexState("example.com")?.status).toBe("error");
    expect(setup.db.getIndexState("example.com")?.error).toContain(
      "embedding exploded"
    );
  });
});

describe("ensureProjectIndexed", () => {
  it("indexes once and then reuses the ready state", async () => {
    const setup = await createIndexingSetup();
    const first = await ensureProjectIndexed(setup, setup.project);
    expect(first.status).toBe("ready");

    const countingProvider = {
      ...setup.provider,
      embeddingModel: () => {
        throw new Error("should not re-embed");
      }
    };
    const second = await ensureProjectIndexed(
      { ...setup, provider: countingProvider },
      setup.project
    );
    expect(second.status).toBe("ready");
  });

  it("re-indexes when forced", async () => {
    const setup = await createIndexingSetup();
    await ensureProjectIndexed(setup, setup.project);
    const forced = await ensureProjectIndexed(setup, setup.project, {
      force: true
    });
    expect(forced.status).toBe("ready");
  });
});
