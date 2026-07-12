import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WRAITHWALKER_SERVER_BASE_URL,
  createAssistantClient
} from "../src/lib/assistant-client.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("createAssistantClient", () => {
  it("derives the default base URL from the shared tRPC URL", () => {
    expect(DEFAULT_WRAITHWALKER_SERVER_BASE_URL).toBe("http://127.0.0.1:4319");
    const client = createAssistantClient();
    expect(client.baseUrl).toBe("http://127.0.0.1:4319");
    expect(client.chatUrl).toBe("http://127.0.0.1:4319/agent/chat");
  });

  it("normalizes trailing slashes in the base URL", () => {
    const client = createAssistantClient({ baseUrl: "http://localhost:9/" });
    expect(client.chatUrl).toBe("http://localhost:9/agent/chat");
  });

  it("fetches status, projects, conversations, and messages", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ enabled: true, model: "m" }))
      .mockResolvedValueOnce(
        jsonResponse({ projects: [{ id: "example.com" }] })
      )
      .mockResolvedValueOnce(
        jsonResponse({ conversations: [{ id: "c1", title: "T" }] })
      )
      .mockResolvedValueOnce(
        jsonResponse({ messages: [{ id: "m1", role: "user", parts: [] }] })
      )
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));

    const client = createAssistantClient({
      baseUrl: "http://127.0.0.1:4319",
      fetchFn
    });

    expect(await client.getStatus()).toMatchObject({ enabled: true });
    expect(await client.listProjects()).toEqual([{ id: "example.com" }]);
    expect(await client.listConversations("example.com")).toEqual([
      { id: "c1", title: "T" }
    ]);
    expect(await client.getConversationMessages("c1")).toEqual([
      { id: "m1", role: "user", parts: [] }
    ]);
    await client.deleteConversation("c1");

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:4319/agent/status",
      undefined
    );
    expect(fetchFn).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:4319/agent/conversations?projectId=example.com",
      undefined
    );
    expect(fetchFn).toHaveBeenNthCalledWith(
      5,
      "http://127.0.0.1:4319/agent/conversations/c1",
      { method: "DELETE" }
    );
  });

  it("throws the server-provided error message on failures", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: "agent disabled" }, 503));
    const client = createAssistantClient({ fetchFn });

    await expect(client.getStatus()).rejects.toThrow("agent disabled");
  });

  it("falls back to the HTTP status when the error body is not JSON", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("boom", { status: 500 }));
    const client = createAssistantClient({ fetchFn });

    await expect(client.listProjects()).rejects.toThrow(
      "Request failed with status 500"
    );
  });
});
