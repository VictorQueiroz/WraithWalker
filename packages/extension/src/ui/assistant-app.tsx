import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { ChatTransport, UIMessage } from "ai";

import {
  createAssistantClient,
  type AssistantClient,
  type AssistantConversation,
  type AssistantProject,
  type AssistantStatus,
  type AssistantUiMessage
} from "../lib/assistant-client.js";
import { cn } from "./lib/cn.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  Textarea
} from "./components.js";

export type AssistantTransportFactory = (args: {
  chatUrl: string;
  conversationId: string;
  projectId: string;
}) => ChatTransport<UIMessage>;

export interface AssistantAppProps {
  client?: AssistantClient;
  transportFactory?: AssistantTransportFactory;
  generateConversationId?: () => string;
}

const defaultTransportFactory: AssistantTransportFactory = ({
  chatUrl,
  conversationId,
  projectId
}) =>
  new DefaultChatTransport({
    api: chatUrl,
    body: { conversationId, projectId }
  });

function toUiMessages(messages: AssistantUiMessage[]): UIMessage[] {
  return messages as unknown as UIMessage[];
}

interface MessagePartViewProps {
  part: { type: string } & Record<string, unknown>;
}

function MessagePartView({ part }: MessagePartViewProps) {
  if (part.type === "text") {
    return (
      <p className="whitespace-pre-wrap text-[13px] leading-5">
        {String(part.text ?? "")}
      </p>
    );
  }

  if (part.type === "reasoning") {
    return (
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Reasoning</summary>
        <p className="whitespace-pre-wrap pt-1">{String(part.text ?? "")}</p>
      </details>
    );
  }

  if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
    const toolName =
      part.type === "dynamic-tool"
        ? String(part.toolName ?? "tool")
        : part.type.slice("tool-".length);
    const state = String(part.state ?? "");
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="muted">{toolName}</Badge>
        <span>
          {state === "output-available"
            ? "done"
            : state === "output-error"
              ? "failed"
              : "running..."}
        </span>
      </div>
    );
  }

  return null;
}

interface ChatThreadProps {
  chatUrl: string;
  conversationId: string;
  projectId: string;
  initialMessages: UIMessage[];
  transportFactory: AssistantTransportFactory;
  onTurnFinished: () => void;
}

function ChatThread({
  chatUrl,
  conversationId,
  projectId,
  initialMessages,
  transportFactory,
  onTurnFinished
}: ChatThreadProps) {
  const [input, setInput] = React.useState("");
  const transport = React.useMemo(
    () => transportFactory({ chatUrl, conversationId, projectId }),
    [transportFactory, chatUrl, conversationId, projectId]
  );
  const { messages, sendMessage, status, error, stop } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    onFinish: onTurnFinished
  });

  const busy = status === "submitted" || status === "streaming";

  function submit() {
    const text = input.trim();
    if (!text || busy) {
      return;
    }

    setInput("");
    void sendMessage({ text });
  }

  return (
    <div className="grid gap-2.5">
      <div
        className="grid max-h-[420px] gap-2 overflow-y-auto"
        aria-label="Conversation messages"
      >
        {messages.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Ask about the captured requests, endpoints, and assets of the
            selected project.
          </p>
        ) : null}
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "grid gap-1.5 rounded-lg border border-border/70 px-2.5 py-2",
              message.role === "user" ? "bg-card/70" : "bg-background"
            )}
          >
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {message.role}
            </span>
            {message.parts.map((part, index) => (
              <MessagePartView
                key={`${message.id}-${index}`}
                part={part as MessagePartViewProps["part"]}
              />
            ))}
          </div>
        ))}
      </div>

      {error ? <Alert variant="destructive">{error.message}</Alert> : null}

      <div className="grid gap-1.5">
        <Textarea
          aria-label="Assistant prompt"
          placeholder="What API endpoints were captured for this site?"
          value={input}
          rows={3}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {busy ? "Thinking..." : "Enter to send"}
          </span>
          <div className="flex gap-2">
            {busy ? (
              <Button type="button" variant="ghost" onClick={() => void stop()}>
                Stop
              </Button>
            ) : null}
            <Button type="button" disabled={busy} onClick={submit}>
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AssistantApp({
  client: providedClient,
  transportFactory = defaultTransportFactory,
  generateConversationId = () => crypto.randomUUID()
}: AssistantAppProps) {
  const client = React.useMemo(
    () => providedClient ?? createAssistantClient(),
    [providedClient]
  );
  const [status, setStatus] = React.useState<AssistantStatus | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [projects, setProjects] = React.useState<AssistantProject[]>([]);
  const [projectId, setProjectId] = React.useState<string>("");
  const [conversations, setConversations] = React.useState<
    AssistantConversation[]
  >([]);
  const [conversationId, setConversationId] = React.useState<string | null>(
    null
  );
  const [initialMessages, setInitialMessages] = React.useState<UIMessage[]>([]);

  const refreshConversations = React.useCallback(
    async (targetProjectId: string) => {
      if (!targetProjectId) {
        setConversations([]);
        return;
      }

      try {
        setConversations(await client.listConversations(targetProjectId));
      } catch {
        setConversations([]);
      }
    },
    [client]
  );

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [nextStatus, nextProjects] = await Promise.all([
          client.getStatus(),
          client.listProjects()
        ]);
        if (cancelled) {
          return;
        }

        setStatus(nextStatus);
        setProjects(nextProjects);
        const firstProject = nextProjects[0];
        if (firstProject) {
          setProjectId((current) => current || firstProject.id);
        }
      } catch (error) {
        if (!cancelled) {
          setStatusError(
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client]);

  React.useEffect(() => {
    setConversationId(null);
    setInitialMessages([]);
    void refreshConversations(projectId);
  }, [projectId, refreshConversations]);

  function startNewConversation() {
    setInitialMessages([]);
    setConversationId(generateConversationId());
  }

  async function openConversation(conversation: AssistantConversation) {
    const messages = await client.getConversationMessages(conversation.id);
    setInitialMessages(toUiMessages(messages));
    setConversationId(conversation.id);
  }

  const selectedProject = projects.find((project) => project.id === projectId);

  let content: React.ReactNode;
  if (statusError) {
    content = (
      <Alert variant="destructive">
        {`Could not reach the WraithWalker server at ${client.baseUrl}. Start it with "wraithwalker serve". (${statusError})`}
      </Alert>
    );
  } else if (!status) {
    content = <p className="text-xs text-muted-foreground">Connecting...</p>;
  } else if (!status.enabled) {
    content = (
      <Alert variant="default">
        {`The AI assistant is disabled. Add AI_GATEWAY_API_KEY to ${status.envFilePath} and restart "wraithwalker serve".`}
      </Alert>
    );
  } else {
    content = (
      <div className="grid gap-2.5">
        <Card>
          <CardHeader>
            <CardTitle>Project</CardTitle>
            <CardDescription>
              Captured websites grouped by domain. Connected origins were seen
              in the same browser tabs.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Select
              aria-label="Select project"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.length === 0 ? (
                <option value="">No captured projects yet</option>
              ) : null}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.displayName} ({project.apiFixtureCount} api,{" "}
                  {project.assetCount} assets)
                </option>
              ))}
            </Select>
            {selectedProject ? (
              <p className="text-xs text-muted-foreground">
                {selectedProject.origins
                  .map((origin) => origin.origin)
                  .join(", ")}
                {selectedProject.connectedOrigins.length > 0
                  ? ` + connected: ${selectedProject.connectedOrigins.join(", ")}`
                  : ""}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant="secondary"
                disabled={!projectId}
                onClick={startNewConversation}
              >
                New chat
              </Button>
              {conversations.map((conversation) => (
                <Button
                  key={conversation.id}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "max-w-56 truncate text-xs",
                    conversation.id === conversationId && "border border-border"
                  )}
                  onClick={() => void openConversation(conversation)}
                >
                  {conversation.title}
                </Button>
              ))}
            </div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {status.model} · reasoning {status.reasoningEffort}
            </p>
          </CardContent>
        </Card>

        {conversationId && projectId ? (
          <ChatThread
            key={conversationId}
            chatUrl={client.chatUrl}
            conversationId={conversationId}
            projectId={projectId}
            initialMessages={initialMessages}
            transportFactory={transportFactory}
            onTurnFinished={() => void refreshConversations(projectId)}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Pick a project and start a new chat.
          </p>
        )}
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <div className="extension-shell">
        <div className="extension-panel grid gap-2.5 p-3.5">
          <div className="min-w-0 space-y-1">
            <h1 className="text-base font-semibold tracking-tight">
              WraithWalker Assistant
            </h1>
            <p className="text-xs leading-5 text-muted-foreground">
              Ask questions about the network traffic captured from your
              browsing sessions.
            </p>
          </div>
          {content}
        </div>
      </div>
    </main>
  );
}
