import { DEFAULT_WRAITHWALKER_SERVER_TRPC_URL } from "./wraithwalker-server.shared.js";

export const DEFAULT_WRAITHWALKER_SERVER_BASE_URL =
  DEFAULT_WRAITHWALKER_SERVER_TRPC_URL.replace(/\/trpc$/, "");

export interface AssistantStatus {
  enabled: boolean;
  model: string;
  embeddingModel: string;
  reasoningEffort: string;
  envFilePath: string;
  index: {
    projectId: string;
    status: string;
    chunkCount: number;
  }[];
}

export interface AssistantProjectOrigin {
  origin: string;
  apiFixtureCount: number;
  assetCount: number;
}

export interface AssistantProject {
  id: string;
  displayName: string;
  origins: AssistantProjectOrigin[];
  connectedOrigins: string[];
  apiFixtureCount: number;
  assetCount: number;
  traceStepCount: number;
}

export interface AssistantConversation {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantUiMessage {
  id: string;
  role: string;
  parts: unknown[];
  metadata?: unknown;
}

export interface AssistantClient {
  baseUrl: string;
  chatUrl: string;
  getStatus(): Promise<AssistantStatus>;
  listProjects(): Promise<AssistantProject[]>;
  listConversations(projectId: string): Promise<AssistantConversation[]>;
  getConversationMessages(id: string): Promise<AssistantUiMessage[]>;
  deleteConversation(id: string): Promise<void>;
}

export interface CreateAssistantClientOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export function createAssistantClient(
  options: CreateAssistantClientOptions = {}
): AssistantClient {
  const baseUrl = (
    options.baseUrl ?? DEFAULT_WRAITHWALKER_SERVER_BASE_URL
  ).replace(/\/$/, "");
  const fetchFn = options.fetchFn ?? fetch;

  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchFn(`${baseUrl}${path}`, init);
    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) {
          message = body.error;
        }
      } catch {
        // keep the status message
      }
      throw new Error(message);
    }

    return (await response.json()) as T;
  }

  return {
    baseUrl,
    chatUrl: `${baseUrl}/agent/chat`,
    async getStatus() {
      return requestJson<AssistantStatus>("/agent/status");
    },
    async listProjects() {
      const payload = await requestJson<{ projects: AssistantProject[] }>(
        "/agent/projects"
      );
      return payload.projects;
    },
    async listConversations(projectId) {
      const payload = await requestJson<{
        conversations: AssistantConversation[];
      }>(`/agent/conversations?projectId=${encodeURIComponent(projectId)}`);
      return payload.conversations;
    },
    async getConversationMessages(id) {
      const payload = await requestJson<{ messages: AssistantUiMessage[] }>(
        `/agent/conversations/${encodeURIComponent(id)}`
      );
      return payload.messages;
    },
    async deleteConversation(id) {
      await requestJson<{ deleted: boolean }>(
        `/agent/conversations/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
    }
  };
}
