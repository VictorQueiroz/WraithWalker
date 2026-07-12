import { describe, expect, it } from "vitest";

import {
  HISTORY_CHAR_BUDGET,
  buildAgentInstructions,
  createFixtureAgent,
  estimateUiMessageChars,
  windowConversationHistory
} from "../src/agent.mts";
import type { StoredUiMessage } from "../src/db.mts";
import type { AgentProject } from "../src/projects.mts";
import { createFakeProvider } from "./test-helpers.mts";

function sampleProject(): AgentProject {
  return {
    id: "example.com",
    displayName: "*.example.com",
    origins: [
      { origin: "https://app.example.com", apiFixtureCount: 1, assetCount: 1 }
    ],
    connectedOrigins: ["https://api.example.com"],
    tabLinks: [],
    apiFixtureCount: 1,
    assetCount: 1,
    traceStepCount: 0
  };
}

function textMessage(id: string, text: string): StoredUiMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

describe("buildAgentInstructions", () => {
  it("mentions the project and grounding rules", () => {
    const instructions = buildAgentInstructions(sampleProject());
    expect(instructions).toContain("*.example.com");
    expect(instructions).toContain("search_captures");
    expect(instructions).toContain("Never invent");
  });

  it("is byte-stable for the same project", () => {
    expect(buildAgentInstructions(sampleProject())).toBe(
      buildAgentInstructions(sampleProject())
    );
  });
});

describe("estimateUiMessageChars", () => {
  it("estimates by serialized parts size", () => {
    const message = textMessage("m1", "hello");
    expect(estimateUiMessageChars(message)).toBeGreaterThan(5);
  });

  it("returns 0 for unserializable parts", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(
      estimateUiMessageChars({
        id: "m",
        role: "user",
        parts: [cyclic]
      })
    ).toBe(0);
  });
});

describe("windowConversationHistory", () => {
  it("returns empty input unchanged", () => {
    expect(windowConversationHistory([])).toEqual([]);
  });

  it("keeps everything under the budget", () => {
    const messages = [textMessage("m1", "one"), textMessage("m2", "two")];
    expect(windowConversationHistory(messages)).toEqual(messages);
  });

  it("drops old messages and injects an elision marker", () => {
    const big = "x".repeat(HISTORY_CHAR_BUDGET);
    const messages = [
      textMessage("old-1", big),
      textMessage("old-2", big),
      textMessage("recent", "latest question")
    ];

    const windowed = windowConversationHistory(messages, 2000);
    expect(windowed[0].id).toMatch(/history-elision/);
    expect((windowed[0].parts[0] as { text: string }).text).toContain(
      "earlier messages omitted"
    );
    expect(windowed[windowed.length - 1].id).toBe("recent");
  });

  it("always keeps the most recent message even when oversized", () => {
    const messages = [textMessage("only", "y".repeat(10_000))];
    const windowed = windowConversationHistory(messages, 100);
    expect(windowed.map((message) => message.id)).toContain("only");
  });
});

describe("createFixtureAgent", () => {
  it("creates a tool-loop agent that can generate a response", async () => {
    const provider = createFakeProvider({ responseText: "hello from agent" });
    const agent = createFixtureAgent({
      provider,
      tools: {},
      project: sampleProject()
    });

    const result = await agent.generate({ prompt: "hi" });
    expect(result.text).toBe("hello from agent");
  });
});
