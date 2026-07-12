import type { IncomingMessage, ServerResponse } from "node:http";

import { generateId, pipeAgentUIStreamToResponse } from "ai";

import { createFixtureAgent } from "./agent.mjs";
import { windowConversationHistory } from "./agent.mjs";
import type { AgentDatabase, StoredUiMessage } from "./db.mjs";
import type { AgentEnvConfig } from "./env-config.mjs";
import type { AgentModelProvider } from "./gateway.mjs";
import {
  indexProject,
  type IndexProjectDependencies,
  type IndexProjectResult
} from "./indexer.mjs";
import {
  getAgentProject,
  listAgentProjects,
  type AgentProject
} from "./projects.mjs";
import { createAgentTools } from "./tools.mjs";

export const AGENT_HTTP_BASE_PATH = "/agent";
const MAX_JSON_BODY_BYTES = 4 * 1024 * 1024;

export type AgentHttpRequest = IncomingMessage & {
  params?: Record<string, string>;
  body?: unknown;
};

export type AgentHttpResponse = ServerResponse;

export type AgentRequestHandler = (
  req: AgentHttpRequest,
  res: AgentHttpResponse
) => void | Promise<void>;

export type AgentMiddleware = (
  req: AgentHttpRequest,
  res: AgentHttpResponse,
  next: () => void
) => void;

export interface AgentRouterApp {
  use(path: string, middleware: AgentMiddleware): unknown;
  get(path: string, handler: AgentRequestHandler): unknown;
  post(path: string, handler: AgentRequestHandler): unknown;
  delete(path: string, handler: AgentRequestHandler): unknown;
}

export interface ChatStreamArguments {
  response: AgentHttpResponse;
  provider: AgentModelProvider;
  project: AgentProject;
  deps: IndexProjectDependencies;
  uiMessages: StoredUiMessage[];
  originalMessages: StoredUiMessage[];
  abortSignal: AbortSignal;
  onFinish: (event: { messages: StoredUiMessage[] }) => void;
}

export interface AgentHttpDependencies {
  rootPath: string;
  env: AgentEnvConfig;
  provider: AgentModelProvider | null;
  db: AgentDatabase | null;
  listProjects?: (rootPath: string) => Promise<AgentProject[]>;
  getProject?: (
    rootPath: string,
    projectId: string
  ) => Promise<AgentProject | null>;
  runIndex?: (
    deps: IndexProjectDependencies,
    project: AgentProject
  ) => Promise<IndexProjectResult>;
  streamChat?: (args: ChatStreamArguments) => Promise<void>;
}

export function isAllowedAgentOrigin(origin: string): boolean {
  if (/^chrome-extension:\/\/[a-p]{32}$/i.test(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]" ||
        url.hostname === "::1")
    );
  } catch {
    return false;
  }
}

export function createAgentCorsMiddleware(): AgentMiddleware {
  return (req, res, next) => {
    const origin =
      typeof req.headers.origin === "string" ? req.headers.origin : undefined;

    if (origin && isAllowedAgentOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, DELETE, OPTIONS"
      );
      const requestedHeaders = req.headers["access-control-request-headers"];
      res.setHeader(
        "Access-Control-Allow-Headers",
        typeof requestedHeaders === "string" && requestedHeaders !== ""
          ? requestedHeaders
          : "content-type"
      );
      if (req.headers["access-control-request-private-network"] === "true") {
        res.setHeader("Access-Control-Allow-Private-Network", "true");
      }
    }

    if (req.method === "OPTIONS") {
      res.statusCode = origin && isAllowedAgentOrigin(origin) ? 204 : 403;
      res.end();
      return;
    }

    next();
  };
}

export async function readJsonBody(
  req: AgentHttpRequest
): Promise<Record<string, unknown>> {
  if (req.body !== undefined && req.body !== null) {
    return req.body as Record<string, unknown>;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_JSON_BODY_BYTES) {
      throw new Error("Request body too large");
    }

    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf-8");
  if (!text.trim()) {
    return {};
  }

  return JSON.parse(text) as Record<string, unknown>;
}

function sendJson(
  res: AgentHttpResponse,
  status: number,
  payload: unknown
): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function deriveConversationTitle(messages: StoredUiMessage[]): string | null {
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    for (const part of message.parts) {
      const candidate = part as { type?: string; text?: string };
      if (candidate.type === "text" && candidate.text) {
        const text = candidate.text.trim().replace(/\s+/g, " ");
        if (text) {
          return text.length > 80 ? `${text.slice(0, 77)}...` : text;
        }
      }
    }
  }

  return null;
}

async function defaultStreamChat(args: ChatStreamArguments): Promise<void> {
  const tools = createAgentTools({
    rootPath: args.deps.rootPath,
    db: args.deps.db,
    provider: args.provider,
    project: args.project
  });
  const agent = createFixtureAgent({
    provider: args.provider,
    tools,
    project: args.project
  });

  await pipeAgentUIStreamToResponse({
    response: args.response,
    agent,
    uiMessages: args.uiMessages,
    abortSignal: args.abortSignal,
    originalMessages: args.originalMessages as never[],
    generateMessageId: generateId,
    sendReasoning: true,
    onFinish: ({ messages }) => {
      args.onFinish({ messages: messages as unknown as StoredUiMessage[] });
    }
  });
}

export function registerAgentRoutes(
  app: AgentRouterApp,
  deps: AgentHttpDependencies
): void {
  const listProjects = deps.listProjects ?? listAgentProjects;
  const getProject = deps.getProject ?? getAgentProject;
  const runIndex = deps.runIndex ?? indexProject;
  const streamChat = deps.streamChat ?? defaultStreamChat;

  const requireAgent = (
    res: AgentHttpResponse
  ): { provider: AgentModelProvider; db: AgentDatabase } | null => {
    if (!deps.provider || !deps.db) {
      sendJson(res, 503, {
        error:
          "AI agent is disabled. Set AI_GATEWAY_API_KEY in " +
          `${deps.env.envFilePath} and restart wraithwalker serve.`
      });
      return null;
    }

    return { provider: deps.provider, db: deps.db };
  };

  const guard =
    (handler: AgentRequestHandler): AgentRequestHandler =>
    async (req, res) => {
      try {
        await handler(req, res);
      } catch {
        if (!res.headersSent) {
          sendJson(res, 500, { error: "Internal agent error" });
        } else {
          res.end();
        }
      }
    };

  app.use(AGENT_HTTP_BASE_PATH, createAgentCorsMiddleware());

  app.get(
    `${AGENT_HTTP_BASE_PATH}/status`,
    guard(async (_req, res) => {
      sendJson(res, 200, {
        enabled: Boolean(deps.provider && deps.db),
        model: deps.env.model,
        embeddingModel: deps.env.embeddingModel,
        reasoningEffort: deps.env.reasoningEffort,
        envFilePath: deps.env.envFilePath,
        envFileLoaded: deps.env.loadedFromFile,
        index: deps.db ? deps.db.listIndexStates() : []
      });
    })
  );

  app.get(
    `${AGENT_HTTP_BASE_PATH}/projects`,
    guard(async (_req, res) => {
      sendJson(res, 200, { projects: await listProjects(deps.rootPath) });
    })
  );

  app.get(
    `${AGENT_HTTP_BASE_PATH}/conversations`,
    guard(async (req, res) => {
      const agent = requireAgent(res);
      if (!agent) {
        return;
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      const projectId = url.searchParams.get("projectId") ?? undefined;
      sendJson(res, 200, {
        conversations: agent.db.listConversations(projectId)
      });
    })
  );

  app.post(
    `${AGENT_HTTP_BASE_PATH}/conversations`,
    guard(async (req, res) => {
      const agent = requireAgent(res);
      if (!agent) {
        return;
      }

      const body = await readJsonBody(req);
      const projectId =
        typeof body.projectId === "string" ? body.projectId : "";
      if (!projectId) {
        sendJson(res, 400, { error: "projectId is required" });
        return;
      }

      const conversation = agent.db.createConversation({
        ...(typeof body.id === "string" && body.id ? { id: body.id } : {}),
        projectId,
        ...(typeof body.title === "string" && body.title
          ? { title: body.title }
          : {})
      });
      sendJson(res, 201, { conversation });
    })
  );

  app.get(
    `${AGENT_HTTP_BASE_PATH}/conversations/:id`,
    guard(async (req, res) => {
      const agent = requireAgent(res);
      if (!agent) {
        return;
      }

      const id = req.params?.id ?? "";
      const conversation = agent.db.getConversation(id);
      if (!conversation) {
        sendJson(res, 404, { error: `Conversation "${id}" not found` });
        return;
      }

      sendJson(res, 200, {
        conversation,
        messages: agent.db.listConversationMessages(id)
      });
    })
  );

  app.delete(
    `${AGENT_HTTP_BASE_PATH}/conversations/:id`,
    guard(async (req, res) => {
      const agent = requireAgent(res);
      if (!agent) {
        return;
      }

      const id = req.params?.id ?? "";
      if (!agent.db.deleteConversation(id)) {
        sendJson(res, 404, { error: `Conversation "${id}" not found` });
        return;
      }

      sendJson(res, 200, { deleted: true });
    })
  );

  app.post(
    `${AGENT_HTTP_BASE_PATH}/index`,
    guard(async (req, res) => {
      const agent = requireAgent(res);
      if (!agent) {
        return;
      }

      const body = await readJsonBody(req);
      const projectId =
        typeof body.projectId === "string" ? body.projectId : "";
      const project = projectId
        ? await getProject(deps.rootPath, projectId)
        : null;
      if (!project) {
        sendJson(res, 404, { error: `Project "${projectId}" not found` });
        return;
      }

      const result = await runIndex(
        { rootPath: deps.rootPath, db: agent.db, provider: agent.provider },
        project
      );
      sendJson(res, 200, { result });
    })
  );

  app.post(
    `${AGENT_HTTP_BASE_PATH}/chat`,
    guard(async (req, res) => {
      const agent = requireAgent(res);
      if (!agent) {
        return;
      }

      const body = await readJsonBody(req);
      const conversationId =
        typeof body.conversationId === "string" ? body.conversationId : "";
      const projectId =
        typeof body.projectId === "string" ? body.projectId : "";
      const incomingMessages = Array.isArray(body.messages)
        ? (body.messages as StoredUiMessage[])
        : [];

      if (!conversationId) {
        sendJson(res, 400, { error: "conversationId is required" });
        return;
      }

      if (incomingMessages.length === 0) {
        sendJson(res, 400, { error: "messages must be a non-empty array" });
        return;
      }

      let conversation = agent.db.getConversation(conversationId);
      if (!conversation && projectId) {
        conversation = agent.db.createConversation({
          id: conversationId,
          projectId
        });
      }

      if (!conversation) {
        sendJson(res, 404, {
          error: `Conversation "${conversationId}" not found; pass projectId to create it`
        });
        return;
      }

      const project = await getProject(deps.rootPath, conversation.projectId);
      if (!project) {
        sendJson(res, 404, {
          error: `Project "${conversation.projectId}" has no captured fixtures`
        });
        return;
      }

      const title = deriveConversationTitle(incomingMessages);
      if (title && conversation.title === "New conversation") {
        agent.db.renameConversation(conversation.id, title);
      }

      const abortController = new AbortController();
      req.on("close", () => abortController.abort());

      await streamChat({
        response: res,
        provider: agent.provider,
        project,
        deps: {
          rootPath: deps.rootPath,
          db: agent.db,
          provider: agent.provider
        },
        uiMessages: windowConversationHistory(incomingMessages),
        originalMessages: incomingMessages,
        abortSignal: abortController.signal,
        onFinish: ({ messages }) => {
          agent.db.replaceConversationMessages(conversation.id, messages);
        }
      });
    })
  );
}
