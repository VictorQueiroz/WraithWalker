// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AssistantClient } from "../src/lib/assistant-client.js";

declare global {
  var __WRAITHWALKER_TEST__: boolean | undefined;
}

function createStubClient(): AssistantClient {
  return {
    baseUrl: "http://127.0.0.1:4319",
    chatUrl: "http://127.0.0.1:4319/agent/chat",
    async getStatus() {
      return {
        enabled: false,
        model: "m",
        embeddingModel: "e",
        reasoningEffort: "xhigh",
        envFilePath: "/tmp/.env",
        index: []
      };
    },
    async listProjects() {
      return [];
    },
    async listConversations() {
      return [];
    },
    async getConversationMessages() {
      return [];
    },
    async deleteConversation() {}
  };
}

beforeEach(() => {
  globalThis.__WRAITHWALKER_TEST__ = true;
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  delete globalThis.__WRAITHWALKER_TEST__;
  document.body.innerHTML = "";
});

describe("assistant entrypoint", () => {
  it("mounts the assistant app into the root container", async () => {
    const { initAssistant } = await import("../src/assistant.ts");
    let handle: ReturnType<typeof initAssistant> | undefined;
    await act(async () => {
      handle = initAssistant({ client: createStubClient() });
    });

    expect(document.getElementById("root")?.childNodes.length).toBeGreaterThan(
      0
    );
    await act(async () => {
      handle?.unmount();
    });
  });

  it("throws when the root container is missing", async () => {
    document.body.innerHTML = "";
    const { initAssistant } = await import("../src/assistant.ts");
    expect(() => initAssistant({ client: createStubClient() })).toThrow(
      "Assistant root container not found."
    );
  });
});
