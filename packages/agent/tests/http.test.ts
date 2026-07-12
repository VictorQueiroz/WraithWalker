import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import express from "express";

import { createCanonicalFixtureRoot } from "../../../test-support/canonical-fixture-root.mts";
import { openAgentDatabase, type AgentDatabase } from "../src/db.mts";
import type { AgentEnvConfig } from "../src/env-config.mts";
import {
  createAgentCorsMiddleware,
  isAllowedAgentOrigin,
  readJsonBody,
  registerAgentRoutes,
  type AgentHttpDependencies,
  type ChatStreamArguments
} from "../src/http.mts";
import { createFakeProvider } from "./test-helpers.mts";

type JsonRecord = Record<string, any>;

const servers: Server[] = [];
const databases: AgentDatabase[] = [];

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.close();
  }
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

function envConfig(): AgentEnvConfig {
  return {
    apiKey: "vck_test",
    model: "deepseek/deepseek-v4-pro",
    embeddingModel: "openai/text-embedding-3-small",
    reasoningEffort: "xhigh",
    envFilePath: "/tmp/wraithwalker/.env",
    loadedFromFile: true
  };
}

async function startAgentServer(
  overrides: Partial<AgentHttpDependencies> = {}
) {
  const canonical = await createCanonicalFixtureRoot();
  const rootPath = canonical.root.rootPath;
  const db = await openAgentDatabase(rootPath, { dbPath: ":memory:" });
  databases.push(db);
  const provider = createFakeProvider();

  const app = express();
  registerAgentRoutes(app, {
    rootPath,
    env: envConfig(),
    provider,
    db,
    ...overrides
  });

  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  servers.push(server);
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return { baseUrl, db, provider, rootPath };
}

describe("isAllowedAgentOrigin", () => {
  it("accepts extension and loopback origins", () => {
    expect(isAllowedAgentOrigin(`chrome-extension://${"a".repeat(32)}`)).toBe(
      true
    );
    expect(isAllowedAgentOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedAgentOrigin("http://127.0.0.1")).toBe(true);
  });

  it("rejects web origins and garbage", () => {
    expect(isAllowedAgentOrigin("https://evil.example.com")).toBe(false);
    expect(isAllowedAgentOrigin("chrome-extension://short")).toBe(false);
    expect(isAllowedAgentOrigin("not-a-url")).toBe(false);
  });
});

describe("agent HTTP routes", () => {
  it("reports status and projects", async () => {
    const { baseUrl } = await startAgentServer();

    const status = (await (
      await fetch(`${baseUrl}/agent/status`)
    ).json()) as JsonRecord;
    expect(status).toMatchObject({
      enabled: true,
      model: "deepseek/deepseek-v4-pro",
      reasoningEffort: "xhigh"
    });

    const projects = (await (
      await fetch(`${baseUrl}/agent/projects`)
    ).json()) as JsonRecord;
    expect(projects.projects[0]).toMatchObject({
      id: "example.com",
      displayName: "*.example.com"
    });
  });

  it("returns 503 for agent routes when disabled", async () => {
    const { baseUrl } = await startAgentServer({ provider: null, db: null });

    const status = (await (
      await fetch(`${baseUrl}/agent/status`)
    ).json()) as JsonRecord;
    expect(status.enabled).toBe(false);

    const response = await fetch(`${baseUrl}/agent/conversations`);
    expect(response.status).toBe(503);
    const body = (await response.json()) as JsonRecord;
    expect(body.error).toContain("AI_GATEWAY_API_KEY");
  });

  it("answers CORS preflights for allowed origins", async () => {
    const { baseUrl } = await startAgentServer();
    const origin = `chrome-extension://${"b".repeat(32)}`;

    const preflight = await fetch(`${baseUrl}/agent/status`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
        "Access-Control-Request-Private-Network": "true"
      }
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    expect(preflight.headers.get("access-control-allow-private-network")).toBe(
      "true"
    );

    const denied = await fetch(`${baseUrl}/agent/status`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example.com" }
    });
    expect(denied.status).toBe(403);
  });

  it("manages the conversation lifecycle", async () => {
    const { baseUrl } = await startAgentServer();

    const missingProject = await fetch(`${baseUrl}/agent/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    expect(missingProject.status).toBe(400);

    const created = await fetch(`${baseUrl}/agent/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "example.com", title: "First chat" })
    });
    expect(created.status).toBe(201);
    const { conversation } = (await created.json()) as JsonRecord;
    expect(conversation.title).toBe("First chat");

    const list = (await (
      await fetch(`${baseUrl}/agent/conversations?projectId=example.com`)
    ).json()) as JsonRecord;
    expect(list.conversations).toHaveLength(1);

    const detail = (await (
      await fetch(`${baseUrl}/agent/conversations/${conversation.id}`)
    ).json()) as JsonRecord;
    expect(detail.conversation.id).toBe(conversation.id);
    expect(detail.messages).toEqual([]);

    const missing = await fetch(`${baseUrl}/agent/conversations/nope`);
    expect(missing.status).toBe(404);

    const deleted = await fetch(
      `${baseUrl}/agent/conversations/${conversation.id}`,
      { method: "DELETE" }
    );
    expect(((await deleted.json()) as JsonRecord).deleted).toBe(true);

    const deleteMissing = await fetch(`${baseUrl}/agent/conversations/nope`, {
      method: "DELETE"
    });
    expect(deleteMissing.status).toBe(404);
  });

  it("indexes a project on demand", async () => {
    const { baseUrl } = await startAgentServer();

    const response = await fetch(`${baseUrl}/agent/index`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "example.com" })
    });
    expect(response.status).toBe(200);
    const { result } = (await response.json()) as JsonRecord;
    expect(result.state.status).toBe("ready");
    expect(result.chunkCount).toBeGreaterThan(0);

    const missing = await fetch(`${baseUrl}/agent/index`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "nope.com" })
    });
    expect(missing.status).toBe(404);
  });

  it("validates chat requests", async () => {
    const { baseUrl } = await startAgentServer();

    const noConversation = await fetch(`${baseUrl}/agent/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ id: "m", role: "user", parts: [] }] })
    });
    expect(noConversation.status).toBe(400);

    const noMessages = await fetch(`${baseUrl}/agent/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: "c1", messages: [] })
    });
    expect(noMessages.status).toBe(400);

    const unknownConversation = await fetch(`${baseUrl}/agent/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: "c-missing",
        messages: [
          { id: "m", role: "user", parts: [{ type: "text", text: "hi" }] }
        ]
      })
    });
    expect(unknownConversation.status).toBe(404);
  });

  it("streams a chat turn and persists the transcript", async () => {
    let streamed: ChatStreamArguments | null = null;
    const { baseUrl, db } = await startAgentServer({
      streamChat: async (args) => {
        streamed = args;
        args.response.writeHead(200, { "content-type": "text/event-stream" });
        args.response.end("data: ok\n\n");
        args.onFinish({
          messages: [
            ...args.originalMessages,
            {
              id: "assistant-1",
              role: "assistant",
              parts: [{ type: "text", text: "answer" }]
            }
          ]
        });
      }
    });

    const response = await fetch(`${baseUrl}/agent/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: "chat-1",
        projectId: "example.com",
        messages: [
          {
            id: "u1",
            role: "user",
            parts: [{ type: "text", text: "what endpoints exist?" }]
          }
        ]
      })
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("data: ok");
    expect(streamed).not.toBeNull();
    expect(streamed!.project.id).toBe("example.com");

    const conversation = db.getConversation("chat-1");
    expect(conversation?.title).toContain("what endpoints exist?");
    const messages = db.listConversationMessages("chat-1");
    expect(messages.map((message) => message.id)).toEqual([
      "u1",
      "assistant-1"
    ]);
  });

  it("streams a real agent turn end-to-end with a mock model", async () => {
    const { baseUrl, db } = await startAgentServer();

    const response = await fetch(`${baseUrl}/agent/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: "chat-real",
        projectId: "example.com",
        messages: [
          {
            id: "u1",
            role: "user",
            parts: [{ type: "text", text: "hello agent" }]
          }
        ]
      })
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("fake response");

    const messages = db.listConversationMessages("chat-real");
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[messages.length - 1].role).toBe("assistant");
  });

  it("returns safe JSON 500s for handler errors", async () => {
    const { baseUrl } = await startAgentServer({
      listProjects: async () => {
        throw new Error("boom");
      }
    });

    const response = await fetch(`${baseUrl}/agent/projects`);
    expect(response.status).toBe(500);
    expect(((await response.json()) as JsonRecord).error).toBe(
      "Internal agent error"
    );
  });
});

describe("readJsonBody", () => {
  it("prefers a pre-parsed express body", async () => {
    const fakeRequest = { body: { a: 1 } } as never;
    expect(await readJsonBody(fakeRequest)).toEqual({ a: 1 });
  });
});

describe("createAgentCorsMiddleware", () => {
  it("passes non-preflight requests through", () => {
    const middleware = createAgentCorsMiddleware();
    const headers: Record<string, string> = {};
    let nextCalled = false;
    middleware(
      { method: "GET", headers: {} } as never,
      {
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        }
      } as never,
      () => {
        nextCalled = true;
      }
    );
    expect(nextCalled).toBe(true);
  });
});
