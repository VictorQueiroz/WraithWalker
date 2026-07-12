import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AGENT_DB_RELATIVE_PATH,
  openAgentDatabase,
  type AgentDatabase
} from "../src/db.mts";

const openDatabases: AgentDatabase[] = [];

async function openMemoryDb(now?: () => string): Promise<AgentDatabase> {
  const db = await openAgentDatabase("/unused", {
    dbPath: ":memory:",
    ...(now ? { now } : {})
  });
  openDatabases.push(db);
  return db;
}

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close();
  }
});

describe("openAgentDatabase", () => {
  it("creates the database file under the fixture root", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "ww-agent-db-"));
    const db = await openAgentDatabase(rootPath);
    openDatabases.push(db);

    expect(db.dbPath).toBe(path.join(rootPath, AGENT_DB_RELATIVE_PATH));
    await expect(fs.stat(db.dbPath)).resolves.toBeTruthy();
  });
});

describe("conversations", () => {
  it("creates, lists, renames, and deletes conversations", async () => {
    let tick = 0;
    const db = await openMemoryDb(() => `2026-07-11T00:00:0${tick++}.000Z`);

    const first = db.createConversation({ projectId: "example.com" });
    const second = db.createConversation({
      id: "conv-2",
      projectId: "other.com",
      title: "Custom"
    });

    expect(first.id).toMatch(/[0-9a-f-]{36}/);
    expect(second).toMatchObject({ id: "conv-2", title: "Custom" });

    expect(db.listConversations().map((c) => c.id)).toContain(first.id);
    expect(db.listConversations("other.com")).toHaveLength(1);
    expect(db.getConversation("conv-2")?.projectId).toBe("other.com");

    const renamed = db.renameConversation("conv-2", "Renamed");
    expect(renamed?.title).toBe("Renamed");
    expect(db.renameConversation("missing", "x")).toBeNull();

    expect(db.deleteConversation("conv-2")).toBe(true);
    expect(db.deleteConversation("conv-2")).toBe(false);
    expect(db.getConversation("conv-2")).toBeNull();
  });
});

describe("messages", () => {
  it("replaces and lists conversation messages preserving order and metadata", async () => {
    const db = await openMemoryDb();
    const conversation = db.createConversation({ projectId: "example.com" });

    db.replaceConversationMessages(conversation.id, [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
        metadata: { sentAt: "2026-07-11" }
      },
      {
        id: "m2",
        role: "assistant",
        parts: [{ type: "text", text: "hi" }]
      }
    ]);

    const messages = db.listConversationMessages(conversation.id);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "m1",
      role: "user",
      metadata: { sentAt: "2026-07-11" }
    });
    expect(messages[1].metadata).toBeUndefined();

    db.replaceConversationMessages(conversation.id, [
      { id: "m3", role: "user", parts: [] }
    ]);
    expect(db.listConversationMessages(conversation.id)).toHaveLength(1);
  });
});

describe("chunks", () => {
  it("stores embeddings as float32 and round-trips them", async () => {
    const db = await openMemoryDb();
    const embedding = Float32Array.from([0.25, -1, 3.5]);

    db.insertChunks("example.com", [
      {
        origin: "https://app.example.com",
        kind: "api",
        refPath: "captures/http/a",
        content: "chunk content",
        contentHash: "hash-1",
        embedding
      }
    ]);

    const chunks = db.listProjectChunks("example.com");
    expect(chunks).toHaveLength(1);
    expect([...chunks[0].embedding]).toEqual([0.25, -1, 3.5]);
    expect(chunks[0]).toMatchObject({
      projectId: "example.com",
      kind: "api",
      contentHash: "hash-1"
    });
    expect(db.countProjectChunks("example.com")).toBe(1);
    expect(db.countProjectChunks("other.com")).toBe(0);
  });

  it("tracks hashes and deletes chunks by id", async () => {
    const db = await openMemoryDb();
    db.insertChunks("p", [
      {
        origin: "o",
        kind: "api",
        refPath: "r1",
        content: "c1",
        contentHash: "h1",
        embedding: Float32Array.from([1])
      },
      {
        origin: "o",
        kind: "api",
        refPath: "r2",
        content: "c2",
        contentHash: "h2",
        embedding: Float32Array.from([2])
      }
    ]);

    const hashes = db.getProjectChunkHashes("p");
    expect([...hashes.keys()].sort()).toEqual(["h1", "h2"]);

    db.deleteChunksByIds([hashes.get("h1")!]);
    db.deleteChunksByIds([]);
    expect(db.countProjectChunks("p")).toBe(1);
  });
});

describe("index state", () => {
  it("upserts and reads index states", async () => {
    const db = await openMemoryDb();

    db.setIndexState({
      projectId: "example.com",
      status: "indexing",
      chunkCount: 0,
      model: "test/embedding",
      error: null,
      indexedAt: null
    });
    db.setIndexState({
      projectId: "example.com",
      status: "ready",
      chunkCount: 4,
      model: "test/embedding",
      error: null,
      indexedAt: "2026-07-11T00:00:00.000Z"
    });

    expect(db.getIndexState("example.com")).toMatchObject({
      status: "ready",
      chunkCount: 4,
      indexedAt: "2026-07-11T00:00:00.000Z"
    });
    expect(db.getIndexState("missing")).toBeNull();
    expect(db.listIndexStates()).toHaveLength(1);
  });
});
