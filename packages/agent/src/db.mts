import { promises as fs } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

export const AGENT_DB_RELATIVE_PATH = ".wraithwalker/agent/agent.db";

export interface ConversationRecord {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredUiMessage {
  id: string;
  role: string;
  parts: unknown[];
  metadata?: unknown;
}

export interface StoredChunk {
  id: number;
  projectId: string;
  origin: string;
  kind: string;
  refPath: string;
  content: string;
  contentHash: string;
  embedding: Float32Array;
}

export interface ChunkInput {
  origin: string;
  kind: string;
  refPath: string;
  content: string;
  contentHash: string;
  embedding: Float32Array;
}

export interface IndexStateRecord {
  projectId: string;
  status: "idle" | "indexing" | "ready" | "error";
  chunkCount: number;
  model: string;
  error: string | null;
  indexedAt: string | null;
}

export interface AgentDatabase {
  dbPath: string;
  createConversation(input: {
    id?: string;
    projectId: string;
    title?: string;
  }): ConversationRecord;
  getConversation(id: string): ConversationRecord | null;
  listConversations(projectId?: string): ConversationRecord[];
  renameConversation(id: string, title: string): ConversationRecord | null;
  deleteConversation(id: string): boolean;
  replaceConversationMessages(
    conversationId: string,
    messages: StoredUiMessage[]
  ): void;
  listConversationMessages(conversationId: string): StoredUiMessage[];
  getProjectChunkHashes(projectId: string): Map<string, number>;
  insertChunks(projectId: string, chunks: ChunkInput[]): void;
  deleteChunksByIds(ids: number[]): void;
  listProjectChunks(projectId: string): StoredChunk[];
  countProjectChunks(projectId: string): number;
  setIndexState(state: IndexStateRecord): void;
  getIndexState(projectId: string): IndexStateRecord | null;
  listIndexStates(): IndexStateRecord[];
  close(): void;
}

export interface OpenAgentDatabaseOptions {
  dbPath?: string;
  now?: () => string;
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    parts TEXT NOT NULL,
    metadata TEXT,
    PRIMARY KEY (conversation_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    origin TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref_path TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    embedding BLOB NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_project ON chunks (project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_project
    ON conversations (project_id, updated_at)`,
  `CREATE TABLE IF NOT EXISTS index_state (
    project_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    chunk_count INTEGER NOT NULL,
    model TEXT NOT NULL,
    error TEXT,
    indexed_at TEXT
  )`
];

function embeddingToBuffer(embedding: Float32Array): Uint8Array {
  return new Uint8Array(
    embedding.buffer.slice(
      embedding.byteOffset,
      embedding.byteOffset + embedding.byteLength
    )
  );
}

function bufferToEmbedding(blob: Uint8Array): Float32Array {
  const copy = new Uint8Array(blob.byteLength);
  copy.set(blob);
  return new Float32Array(copy.buffer);
}

function toConversationRecord(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  } satisfies ConversationRecord;
}

function toIndexStateRecord(row: Record<string, unknown>) {
  return {
    projectId: String(row.project_id),
    status: String(row.status) as IndexStateRecord["status"],
    chunkCount: Number(row.chunk_count),
    model: String(row.model),
    error:
      row.error === null || row.error === undefined ? null : String(row.error),
    indexedAt:
      row.indexed_at === null || row.indexed_at === undefined
        ? null
        : String(row.indexed_at)
  } satisfies IndexStateRecord;
}

async function loadDatabaseSync(): Promise<typeof DatabaseSync> {
  try {
    const sqlite = await import("node:sqlite");
    return sqlite.DatabaseSync;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The WraithWalker agent requires the node:sqlite module (Node.js 22.13+). ${message}`
    );
  }
}

export async function openAgentDatabase(
  rootPath: string,
  options: OpenAgentDatabaseOptions = {}
): Promise<AgentDatabase> {
  const DatabaseSyncCtor = await loadDatabaseSync();
  const dbPath = options.dbPath ?? path.join(rootPath, AGENT_DB_RELATIVE_PATH);
  const now = options.now ?? (() => new Date().toISOString());

  if (dbPath !== ":memory:") {
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSyncCtor(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  for (const statement of SCHEMA_STATEMENTS) {
    db.exec(statement);
  }

  function getConversation(id: string): ConversationRecord | null {
    const row = db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? toConversationRecord(row) : null;
  }

  function transaction<T>(run: () => T): T {
    db.exec("BEGIN");
    try {
      const result = run();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    dbPath,
    createConversation(input) {
      const timestamp = now();
      const record: ConversationRecord = {
        id: input.id ?? crypto.randomUUID(),
        projectId: input.projectId,
        title: input.title ?? "New conversation",
        createdAt: timestamp,
        updatedAt: timestamp
      };
      db.prepare(
        `INSERT INTO conversations (id, project_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        record.id,
        record.projectId,
        record.title,
        record.createdAt,
        record.updatedAt
      );
      return record;
    },
    getConversation,
    listConversations(projectId) {
      const rows = (
        projectId
          ? db
              .prepare(
                `SELECT * FROM conversations WHERE project_id = ?
                 ORDER BY updated_at DESC, id`
              )
              .all(projectId)
          : db
              .prepare(
                "SELECT * FROM conversations ORDER BY updated_at DESC, id"
              )
              .all()
      ) as Record<string, unknown>[];
      return rows.map(toConversationRecord);
    },
    renameConversation(id, title) {
      const existing = getConversation(id);
      if (!existing) {
        return null;
      }

      db.prepare(
        "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?"
      ).run(title, now(), id);
      return getConversation(id);
    },
    deleteConversation(id) {
      if (!getConversation(id)) {
        return false;
      }

      transaction(() => {
        db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
        db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
      });
      return true;
    },
    replaceConversationMessages(conversationId, messages) {
      transaction(() => {
        db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(
          conversationId
        );
        const insert = db.prepare(
          `INSERT INTO messages (id, conversation_id, seq, role, parts, metadata)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        messages.forEach((message, index) => {
          insert.run(
            message.id,
            conversationId,
            index,
            message.role,
            JSON.stringify(message.parts ?? []),
            message.metadata === undefined
              ? null
              : JSON.stringify(message.metadata)
          );
        });
        db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
          now(),
          conversationId
        );
      });
    },
    listConversationMessages(conversationId) {
      const rows = db
        .prepare(
          "SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq"
        )
        .all(conversationId) as Record<string, unknown>[];
      return rows.map((row) => {
        const message: StoredUiMessage = {
          id: String(row.id),
          role: String(row.role),
          parts: JSON.parse(String(row.parts)) as unknown[]
        };
        if (row.metadata !== null && row.metadata !== undefined) {
          message.metadata = JSON.parse(String(row.metadata));
        }
        return message;
      });
    },
    getProjectChunkHashes(projectId) {
      const rows = db
        .prepare("SELECT id, content_hash FROM chunks WHERE project_id = ?")
        .all(projectId) as Record<string, unknown>[];
      return new Map(
        rows.map((row) => [String(row.content_hash), Number(row.id)])
      );
    },
    insertChunks(projectId, chunks) {
      transaction(() => {
        const insert = db.prepare(
          `INSERT INTO chunks
             (project_id, origin, kind, ref_path, content, content_hash, embedding)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        for (const chunk of chunks) {
          insert.run(
            projectId,
            chunk.origin,
            chunk.kind,
            chunk.refPath,
            chunk.content,
            chunk.contentHash,
            embeddingToBuffer(chunk.embedding)
          );
        }
      });
    },
    deleteChunksByIds(ids) {
      if (ids.length === 0) {
        return;
      }

      transaction(() => {
        const remove = db.prepare("DELETE FROM chunks WHERE id = ?");
        for (const id of ids) {
          remove.run(id);
        }
      });
    },
    listProjectChunks(projectId) {
      const rows = db
        .prepare("SELECT * FROM chunks WHERE project_id = ? ORDER BY id")
        .all(projectId) as Record<string, unknown>[];
      return rows.map((row) => ({
        id: Number(row.id),
        projectId: String(row.project_id),
        origin: String(row.origin),
        kind: String(row.kind),
        refPath: String(row.ref_path),
        content: String(row.content),
        contentHash: String(row.content_hash),
        embedding: bufferToEmbedding(row.embedding as Uint8Array)
      }));
    },
    countProjectChunks(projectId) {
      const row = db
        .prepare("SELECT COUNT(*) AS total FROM chunks WHERE project_id = ?")
        .get(projectId) as Record<string, unknown>;
      return Number(row.total);
    },
    setIndexState(state) {
      db.prepare(
        `INSERT INTO index_state
           (project_id, status, chunk_count, model, error, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (project_id) DO UPDATE SET
           status = excluded.status,
           chunk_count = excluded.chunk_count,
           model = excluded.model,
           error = excluded.error,
           indexed_at = excluded.indexed_at`
      ).run(
        state.projectId,
        state.status,
        state.chunkCount,
        state.model,
        state.error,
        state.indexedAt
      );
    },
    getIndexState(projectId) {
      const row = db
        .prepare("SELECT * FROM index_state WHERE project_id = ?")
        .get(projectId) as Record<string, unknown> | undefined;
      return row ? toIndexStateRecord(row) : null;
    },
    listIndexStates() {
      const rows = db
        .prepare("SELECT * FROM index_state ORDER BY project_id")
        .all() as Record<string, unknown>[];
      return rows.map(toIndexStateRecord);
    },
    close() {
      db.close();
    }
  };
}
