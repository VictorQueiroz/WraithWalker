import { ToolLoopAgent, isStepCount, type ToolSet } from "ai";

import type { StoredUiMessage } from "./db.mjs";
import type { AgentModelProvider } from "./gateway.mjs";
import type { AgentProject } from "./projects.mjs";

export const MAX_AGENT_STEPS = 12;
export const HISTORY_CHAR_BUDGET = 48_000;

export interface CreateFixtureAgentOptions {
  provider: AgentModelProvider;
  tools: ToolSet;
  project: AgentProject;
  maxSteps?: number;
}

export function buildAgentInstructions(project: AgentProject): string {
  return [
    "You are the WraithWalker capture analyst. You answer questions about network traffic, API fixtures, and static assets that were captured from real browsing sessions and stored on the local filesystem.",
    `The selected project is ${project.displayName}: every origin whose registrable domain is ${project.id}, plus third-party origins whose requests were captured in the same browser tabs.`,
    "Ground every claim in captured data: call search_captures first, then use list_api_endpoints, read_api_fixture, and search_fixture_text to verify details. Never invent endpoints, fields, or values.",
    "Tool outputs are truncated to stay small; use cursors and refined queries instead of re-reading large bodies.",
    "Be concise. Cite fixture paths or endpoint methods+paths so the user can open the underlying capture. If the captures do not contain the answer, say so plainly."
  ].join("\n");
}

export function estimateUiMessageChars(message: StoredUiMessage): number {
  try {
    return JSON.stringify(message.parts).length;
  } catch {
    return 0;
  }
}

export function windowConversationHistory(
  messages: StoredUiMessage[],
  charBudget = HISTORY_CHAR_BUDGET
): StoredUiMessage[] {
  if (messages.length === 0) {
    return [];
  }

  const kept: StoredUiMessage[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const size = estimateUiMessageChars(message);
    if (kept.length > 0 && used + size > charBudget) {
      break;
    }

    kept.unshift(message);
    used += size;
  }

  if (kept.length < messages.length) {
    kept.unshift({
      id: `history-elision-${messages.length - kept.length}`,
      role: "user",
      parts: [
        {
          type: "text",
          text: `[${messages.length - kept.length} earlier messages omitted to fit the context window]`
        }
      ]
    });
  }

  return kept;
}

export function createFixtureAgent(options: CreateFixtureAgentOptions) {
  const { provider, tools, project } = options;

  return new ToolLoopAgent({
    model: provider.languageModel(),
    instructions: buildAgentInstructions(project),
    tools,
    reasoning: provider.reasoningEffort,
    stopWhen: isStepCount(options.maxSteps ?? MAX_AGENT_STEPS)
  });
}
