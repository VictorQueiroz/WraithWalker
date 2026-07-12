import { describe, expect, it } from "vitest";

import { openAgentDatabase } from "../src/db.mts";
import { cosineSimilarityF32, searchProjectChunks } from "../src/retrieval.mts";
import { createFakeProvider, fakeEmbedding } from "./test-helpers.mts";

describe("cosineSimilarityF32", () => {
  it("returns 1 for identical vectors", () => {
    const vector = Float32Array.from([1, 2, 3]);
    expect(cosineSimilarityF32(vector, vector)).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(
      cosineSimilarityF32(Float32Array.from([1, 0]), Float32Array.from([0, 1]))
    ).toBe(0);
  });

  it("returns 0 for mismatched lengths or zero vectors", () => {
    expect(
      cosineSimilarityF32(Float32Array.from([1]), Float32Array.from([1, 2]))
    ).toBe(0);
    expect(
      cosineSimilarityF32(Float32Array.from([0, 0]), Float32Array.from([1, 1]))
    ).toBe(0);
  });
});

describe("searchProjectChunks", () => {
  async function createSearchSetup() {
    const db = await openAgentDatabase("/unused", { dbPath: ":memory:" });
    const provider = createFakeProvider();

    const contents = [
      "GET /v1/items returns the catalog items list",
      "POST /v1/login authenticates a user session",
      "static asset stylesheet main.css for the landing page"
    ];
    db.insertChunks(
      "example.com",
      contents.map((content, index) => ({
        origin: "https://app.example.com",
        kind: "api",
        refPath: `chunk-${index}`,
        content,
        contentHash: `hash-${index}`,
        embedding: Float32Array.from(fakeEmbedding(content))
      }))
    );

    return { db, provider };
  }

  it("ranks the most similar chunk first", async () => {
    const { db, provider } = await createSearchSetup();
    const results = await searchProjectChunks(
      { db, provider },
      "example.com",
      "GET /v1/items returns the catalog items list"
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].refPath).toBe("chunk-0");
    expect(results[0].score).toBeGreaterThan(0.99);
    expect(results[0].score).toBeGreaterThanOrEqual(
      results[results.length - 1].score
    );
  });

  it("applies limit and minScore options", async () => {
    const { db, provider } = await createSearchSetup();
    const limited = await searchProjectChunks(
      { db, provider },
      "example.com",
      "items list",
      { limit: 1 }
    );
    expect(limited).toHaveLength(1);

    const strict = await searchProjectChunks(
      { db, provider },
      "example.com",
      "items list",
      { minScore: 1.01 }
    );
    expect(strict).toEqual([]);
  });

  it("returns an empty list when the project has no chunks", async () => {
    const db = await openAgentDatabase("/unused", { dbPath: ":memory:" });
    const provider = createFakeProvider();
    expect(
      await searchProjectChunks({ db, provider }, "missing.com", "anything")
    ).toEqual([]);
  });
});
