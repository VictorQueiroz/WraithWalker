import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  readFixtureSnippet,
  resolveFixturePath,
  searchFixtureContent,
  type SearchContentOptions
} from "./fixture-reader.mjs";
import {
  renderErrorMessage,
  renderJson,
  renderUnknownError
} from "./server-responses.mjs";

const CHECKPOINT_SCHEMA_VERSION = 1;
const CHUNK_REF_SCHEMA_VERSION = 1;
const CHECKPOINT_DIR = ".wraithwalker/agent/checkpoints";
const DEFAULT_REF_LINE_COUNT = 8;
const MAX_REF_LINE_COUNT = 80;
const MAX_CHECKPOINT_REFS = 100;
const CHECKPOINT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

const chunkRefSchema = z.object({
  version: z.number().int().positive().optional(),
  type: z.literal("fixture-snippet").optional(),
  path: z.string().trim().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  lineCount: z.number().int().positive().max(MAX_REF_LINE_COUNT).optional(),
  contentHash: z.string().trim().min(1).optional(),
  kind: z.string().trim().min(1).max(80).optional(),
  label: z.string().trim().min(1).max(160).optional(),
  note: z.string().trim().min(1).max(1000).optional(),
  nodeId: z.string().trim().min(1).max(240).optional(),
  origin: z.string().trim().min(1).max(500).optional()
});

const capabilityNodeSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(240),
  status: z
    .enum([
      "unknown",
      "found",
      "verified",
      "target-mapped",
      "blocked",
      "skipped"
    ])
    .optional(),
  refs: z.array(chunkRefSchema).max(MAX_CHECKPOINT_REFS).optional(),
  notes: z.string().trim().max(2000).optional()
});

type ChunkRefInput = z.infer<typeof chunkRefSchema>;
type CapabilityNodeInput = z.infer<typeof capabilityNodeSchema>;

interface NavigationCheckpoint {
  schemaVersion: number;
  id: string;
  title: string;
  goal?: string;
  notes?: string;
  refs: ChunkRefInput[];
  capabilityNodes: CapabilityNodeInput[];
  nextActions: string[];
  createdAt: string;
  updatedAt: string;
}

interface RefVerification {
  status: "verified" | "stale" | "unverified";
  ref: ChunkRefInput;
  expectedHash: string | null;
  currentHash: string;
  snippet: {
    path: string;
    startLine: number;
    endLine: number;
    truncated: boolean;
    text?: string;
  };
}

function normalizeLineCount(ref: ChunkRefInput): number {
  if (ref.endLine && ref.startLine && ref.endLine >= ref.startLine) {
    return Math.min(ref.endLine - ref.startLine + 1, MAX_REF_LINE_COUNT);
  }

  return Math.min(ref.lineCount ?? DEFAULT_REF_LINE_COUNT, MAX_REF_LINE_COUNT);
}

function buildContentHash(input: {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}): string {
  return `sha256:${createHash("sha256")
    .update(
      [
        "wraithwalker-fixture-snippet-v1",
        input.path,
        String(input.startLine),
        String(input.endLine),
        input.text
      ].join("\n")
    )
    .digest("hex")}`;
}

async function createChunkRef(
  rootPath: string,
  input: ChunkRefInput
): Promise<{ ref: ChunkRefInput; verification: RefVerification }> {
  if (!resolveFixturePath(rootPath, input.path)) {
    throw new Error(
      `Invalid fixture path: ${input.path}. Paths must stay within the fixture root.`
    );
  }

  const snippet = await readFixtureSnippet(rootPath, input.path, {
    startLine: input.startLine,
    lineCount: normalizeLineCount(input)
  });
  const ref: ChunkRefInput = {
    version: CHUNK_REF_SCHEMA_VERSION,
    type: "fixture-snippet",
    path: snippet.path,
    startLine: snippet.startLine,
    endLine: snippet.endLine,
    lineCount: snippet.endLine - snippet.startLine + 1,
    contentHash: buildContentHash(snippet),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.label ? { label: input.label } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    ...(input.origin ? { origin: input.origin } : {})
  };

  return {
    ref,
    verification: {
      status: "verified",
      ref,
      expectedHash: ref.contentHash ?? null,
      currentHash: ref.contentHash ?? "",
      snippet: {
        path: snippet.path,
        startLine: snippet.startLine,
        endLine: snippet.endLine,
        truncated: snippet.truncated
      }
    }
  };
}

async function verifyChunkRef(
  rootPath: string,
  ref: ChunkRefInput,
  options: { includeText?: boolean } = {}
): Promise<RefVerification> {
  if (!resolveFixturePath(rootPath, ref.path)) {
    throw new Error(
      `Invalid fixture path: ${ref.path}. Paths must stay within the fixture root.`
    );
  }

  const snippet = await readFixtureSnippet(rootPath, ref.path, {
    startLine: ref.startLine,
    lineCount: normalizeLineCount(ref)
  });
  const currentHash = buildContentHash(snippet);
  const status = ref.contentHash
    ? ref.contentHash === currentHash
      ? "verified"
      : "stale"
    : "unverified";

  return {
    status,
    ref,
    expectedHash: ref.contentHash ?? null,
    currentHash,
    snippet: {
      path: snippet.path,
      startLine: snippet.startLine,
      endLine: snippet.endLine,
      truncated: snippet.truncated,
      ...(options.includeText ? { text: snippet.text } : {})
    }
  };
}

function createCheckpointId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "checkpoint"}-${randomUUID().slice(0, 8)}`;
}

function validateCheckpointId(id: string): string {
  if (!CHECKPOINT_ID_PATTERN.test(id)) {
    throw new Error(
      "Checkpoint id must start with an alphanumeric character and contain only letters, numbers, dots, underscores, or hyphens."
    );
  }
  return id;
}

function checkpointLocation(rootPath: string, id: string) {
  const checkpointId = validateCheckpointId(id);
  const checkpointDir = path.resolve(rootPath, CHECKPOINT_DIR);
  const checkpointPath = path.resolve(checkpointDir, `${checkpointId}.json`);
  if (
    checkpointPath !== path.join(checkpointDir, `${checkpointId}.json`) ||
    !checkpointPath.startsWith(`${checkpointDir}${path.sep}`)
  ) {
    throw new Error("Checkpoint id resolved outside the checkpoint directory.");
  }

  return { checkpointDir, checkpointPath };
}

async function readCheckpoint(
  rootPath: string,
  id: string
): Promise<NavigationCheckpoint | null> {
  const { checkpointPath } = checkpointLocation(rootPath, id);
  try {
    return JSON.parse(
      await fs.readFile(checkpointPath, "utf-8")
    ) as NavigationCheckpoint;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

async function writeCheckpoint(
  rootPath: string,
  checkpoint: NavigationCheckpoint,
  options: { overwrite?: boolean } = {}
) {
  const { checkpointDir, checkpointPath } = checkpointLocation(
    rootPath,
    checkpoint.id
  );
  await fs.mkdir(checkpointDir, { recursive: true });

  if (!options.overwrite) {
    try {
      await fs.writeFile(
        checkpointPath,
        `${JSON.stringify(checkpoint, null, 2)}\n`,
        { flag: "wx" }
      );
      return;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        throw new Error(
          `Navigation checkpoint already exists: ${checkpoint.id}. Pass overwrite: true to replace it.`
        );
      }
      throw error;
    }
  }

  await fs.writeFile(
    checkpointPath,
    `${JSON.stringify(checkpoint, null, 2)}\n`
  );
}

async function listCheckpoints(rootPath: string) {
  const checkpointDir = path.resolve(rootPath, CHECKPOINT_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(checkpointDir);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  const checkpoints: Array<{
    id: string;
    title: string;
    refCount: number;
    capabilityNodeCount: number;
    nextActionCount: number;
    createdAt: string;
    updatedAt: string;
  }> = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }

    const id = entry.slice(0, -".json".length);
    const checkpoint = await readCheckpoint(rootPath, id);
    if (!checkpoint) {
      continue;
    }

    checkpoints.push({
      id: checkpoint.id,
      title: checkpoint.title,
      refCount: checkpoint.refs.length,
      capabilityNodeCount: checkpoint.capabilityNodes.length,
      nextActionCount: checkpoint.nextActions.length,
      createdAt: checkpoint.createdAt,
      updatedAt: checkpoint.updatedAt
    });
  }

  return checkpoints.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function registerNavigationTools(
  server: McpServer,
  rootPath: string
): void {
  server.registerTool(
    "search-chunk-refs",
    {
      description:
        "Search captured fixture content and return durable chunkRef anchors that can be stored in navigation checkpoints, then read with read-chunk-ref.",
      inputSchema: z.object({
        query: z.string().trim().min(1),
        origin: z.string().trim().min(1).optional(),
        pathContains: z.string().trim().min(1).optional(),
        mimeTypes: z.array(z.string().trim().min(1)).optional(),
        resourceTypes: z.array(z.string().trim().min(1)).optional(),
        lineCount: z
          .number()
          .int()
          .positive()
          .max(MAX_REF_LINE_COUNT)
          .optional(),
        limit: z.number().int().positive().max(100).optional(),
        cursor: z.string().optional()
      })
    },
    async ({
      query,
      origin,
      pathContains,
      mimeTypes,
      resourceTypes,
      lineCount,
      limit,
      cursor
    }) => {
      try {
        const searchOptions: SearchContentOptions = {
          query,
          origin,
          pathContains,
          mimeTypes,
          resourceTypes,
          limit,
          cursor
        };
        const results = await searchFixtureContent(rootPath, searchOptions);
        const items = await Promise.all(
          results.items.map(async (item) => {
            const { ref, verification } = await createChunkRef(rootPath, {
              path: item.path,
              startLine: item.matchLine,
              lineCount: lineCount ?? DEFAULT_REF_LINE_COUNT,
              kind: item.sourceKind,
              origin: item.origin,
              label: `${item.sourceKind}:${item.matchKind}:${item.path}`
            });
            return {
              ref,
              verification,
              match: {
                sourceKind: item.sourceKind,
                matchKind: item.matchKind,
                matchCount: item.matchCount,
                matchLine: item.matchLine,
                matchColumn: item.matchColumn,
                origin: item.origin,
                pathname: item.pathname,
                mimeType: item.mimeType,
                resourceType: item.resourceType,
                excerpt: item.excerpt,
                editable: item.editable,
                canonicalPath: item.canonicalPath
              }
            };
          })
        );

        return renderJson({
          items,
          totalMatched: results.totalMatched,
          nextCursor: results.nextCursor,
          matchedOrigins: results.matchedOrigins
        });
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.registerTool(
    "create-chunk-ref",
    {
      description:
        "Create a hash-verified chunkRef for a bounded fixture snippet without storing the snippet body in a checkpoint.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
        startLine: z.number().int().positive().optional(),
        lineCount: z
          .number()
          .int()
          .positive()
          .max(MAX_REF_LINE_COUNT)
          .optional(),
        kind: z.string().trim().min(1).max(80).optional(),
        label: z.string().trim().min(1).max(160).optional(),
        note: z.string().trim().min(1).max(1000).optional(),
        nodeId: z.string().trim().min(1).max(240).optional(),
        origin: z.string().trim().min(1).max(500).optional(),
        includeText: z.boolean().optional()
      })
    },
    async ({ includeText, ...input }) => {
      try {
        const created = await createChunkRef(rootPath, input);
        const verification = includeText
          ? await verifyChunkRef(rootPath, created.ref, { includeText: true })
          : created.verification;
        return renderJson({
          ref: created.ref,
          verification
        });
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.registerTool(
    "read-chunk-ref",
    {
      description:
        "Read and verify the exact fixture snippet named by a chunkRef; reports stale when the current contents no longer match the saved hash.",
      inputSchema: z.object({
        ref: chunkRefSchema,
        includeText: z.boolean().optional()
      })
    },
    async ({ ref, includeText }) => {
      try {
        return renderJson(
          await verifyChunkRef(rootPath, ref, {
            includeText: includeText ?? true
          })
        );
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.registerTool(
    "create-navigation-checkpoint",
    {
      description:
        "Persist a resumable agent navigation checkpoint with chunkRefs, capability nodes, notes, and next actions.",
      inputSchema: z.object({
        id: z.string().trim().min(1).optional(),
        title: z.string().trim().min(1).max(160),
        goal: z.string().trim().min(1).max(2000).optional(),
        notes: z.string().trim().min(1).max(4000).optional(),
        refs: z.array(chunkRefSchema).max(MAX_CHECKPOINT_REFS).optional(),
        capabilityNodes: z.array(capabilityNodeSchema).max(100).optional(),
        nextActions: z
          .array(z.string().trim().min(1).max(500))
          .max(50)
          .optional(),
        overwrite: z.boolean().optional()
      })
    },
    async ({
      id,
      title,
      goal,
      notes,
      refs = [],
      capabilityNodes = [],
      nextActions = [],
      overwrite
    }) => {
      try {
        const checkpointId = id
          ? validateCheckpointId(id)
          : createCheckpointId(title);
        const timestamp = new Date().toISOString();
        const checkpoint: NavigationCheckpoint = {
          schemaVersion: CHECKPOINT_SCHEMA_VERSION,
          id: checkpointId,
          title,
          refs,
          capabilityNodes,
          nextActions,
          createdAt: timestamp,
          updatedAt: timestamp,
          ...(goal ? { goal } : {}),
          ...(notes ? { notes } : {})
        };
        const verifications = await Promise.all(
          refs.map((ref) => verifyChunkRef(rootPath, ref))
        );
        await writeCheckpoint(rootPath, checkpoint, { overwrite });

        return renderJson({
          checkpoint,
          verifications
        });
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.registerTool(
    "read-navigation-checkpoint",
    {
      description:
        "Read a saved navigation checkpoint and verify whether its chunkRefs still point to the same captured contents.",
      inputSchema: z.object({
        id: z.string().trim().min(1),
        includeText: z.boolean().optional()
      })
    },
    async ({ id, includeText }) => {
      try {
        const checkpoint = await readCheckpoint(rootPath, id);
        if (!checkpoint) {
          return renderErrorMessage(`Navigation checkpoint not found: ${id}`);
        }

        const verifications = await Promise.all(
          checkpoint.refs.map((ref) =>
            verifyChunkRef(rootPath, ref, { includeText })
          )
        );

        return renderJson({
          checkpoint,
          verifications
        });
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );

  server.registerTool(
    "list-navigation-checkpoints",
    {
      description:
        "List saved navigation checkpoints so an agent can resume chunk investigation without relying on model context.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        return renderJson({ checkpoints: await listCheckpoints(rootPath) });
      } catch (error) {
        return renderUnknownError(error);
      }
    }
  );
}
