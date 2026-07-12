// @vitest-environment jsdom

import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

import type {
  AssistantClient,
  AssistantConversation,
  AssistantProject,
  AssistantStatus
} from "../src/lib/assistant-client.js";
import { AssistantApp } from "../src/ui/assistant-app.js";

afterEach(() => {
  cleanup();
});

function sampleStatus(
  overrides: Partial<AssistantStatus> = {}
): AssistantStatus {
  return {
    enabled: true,
    model: "deepseek/deepseek-v4-pro",
    embeddingModel: "openai/text-embedding-3-small",
    reasoningEffort: "xhigh",
    envFilePath: "/home/user/.config/wraithwalker/.env",
    index: [],
    ...overrides
  };
}

function sampleProject(): AssistantProject {
  return {
    id: "example.com",
    displayName: "*.example.com",
    origins: [
      { origin: "https://app.example.com", apiFixtureCount: 2, assetCount: 3 }
    ],
    connectedOrigins: ["https://cdn.thirdparty.net"],
    apiFixtureCount: 2,
    assetCount: 3,
    traceStepCount: 1
  };
}

function createFakeClient(options: {
  status?: AssistantStatus;
  projects?: AssistantProject[];
  conversations?: AssistantConversation[];
  failStatus?: string;
}): AssistantClient {
  return {
    baseUrl: "http://127.0.0.1:4319",
    chatUrl: "http://127.0.0.1:4319/agent/chat",
    async getStatus() {
      if (options.failStatus) {
        throw new Error(options.failStatus);
      }
      return options.status ?? sampleStatus();
    },
    async listProjects() {
      return options.projects ?? [sampleProject()];
    },
    async listConversations() {
      return options.conversations ?? [];
    },
    async getConversationMessages(id: string) {
      return [
        {
          id: `${id}-m1`,
          role: "user",
          parts: [{ type: "text", text: "previous question" }]
        },
        {
          id: `${id}-m2`,
          role: "assistant",
          parts: [{ type: "text", text: "previous answer" }]
        }
      ];
    },
    async deleteConversation() {}
  };
}

function chunkStream(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    }
  });
}

function createFakeTransport(responseText: string): ChatTransport<UIMessage> {
  return {
    sendMessages: vi.fn(async () =>
      chunkStream([
        { type: "start", messageId: "assistant-msg" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: responseText },
        { type: "text-end", id: "t1" },
        { type: "finish" }
      ])
    ),
    reconnectToStream: vi.fn(async () => null)
  };
}

describe("AssistantApp", () => {
  it("shows a connection error when the server is unreachable", async () => {
    render(
      <AssistantApp client={createFakeClient({ failStatus: "conn refused" })} />
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Could not reach the WraithWalker server/)
      ).toBeTruthy();
    });
  });

  it("explains how to enable the agent when it is disabled", async () => {
    render(
      <AssistantApp
        client={createFakeClient({
          status: sampleStatus({ enabled: false })
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/AI_GATEWAY_API_KEY/)).toBeTruthy();
    });
    expect(screen.getByText(/\.config\/wraithwalker\/\.env/)).toBeTruthy();
  });

  it("lists projects grouped by domain and shows connected origins", async () => {
    render(<AssistantApp client={createFakeClient({})} />);

    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: /\*\.example\.com/ })
      ).toBeTruthy();
    });
    expect(screen.getByText(/cdn\.thirdparty\.net/)).toBeTruthy();
    expect(screen.getByText(/deepseek\/deepseek-v4-pro/)).toBeTruthy();
  });

  it("starts a new chat, streams the assistant reply, and renders it", async () => {
    const transport = createFakeTransport("Here are your endpoints.");
    const user = userEvent.setup();

    render(
      <AssistantApp
        client={createFakeClient({})}
        transportFactory={() => transport}
        generateConversationId={() => "conv-test"}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: "New chat" }));

    const prompt = screen.getByLabelText("Assistant prompt");
    await user.type(prompt, "what endpoints exist?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("Here are your endpoints.")).toBeTruthy();
    });
    expect(screen.getByText("what endpoints exist?")).toBeTruthy();
    expect(transport.sendMessages).toHaveBeenCalledTimes(1);
  });

  it("opens an existing conversation with its stored messages", async () => {
    const user = userEvent.setup();
    render(
      <AssistantApp
        client={createFakeClient({
          conversations: [
            {
              id: "conv-1",
              projectId: "example.com",
              title: "Earlier chat",
              createdAt: "2026-07-11",
              updatedAt: "2026-07-11"
            }
          ]
        })}
        transportFactory={() => createFakeTransport("noop")}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Earlier chat" })).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: "Earlier chat" }));

    await waitFor(() => {
      expect(screen.getByText("previous question")).toBeTruthy();
    });
    expect(screen.getByText("previous answer")).toBeTruthy();
  });

  it("prompts to pick a project before chatting", async () => {
    render(<AssistantApp client={createFakeClient({})} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Pick a project and start a new chat\./)
      ).toBeTruthy();
    });
  });
});
