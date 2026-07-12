# @wraithwalker/agent

Headless AI agent for WraithWalker. It powers the "Assistant" surface of the
Chrome extension: a Vercel AI Gateway backed chat agent that answers questions
about captured network fixtures using retrieval-augmented generation over a
local SQLite vector store.

## What it does

- Loads gateway credentials from `~/.config/wraithwalker/.env`
  (`AI_GATEWAY_API_KEY`, plus optional `WRAITHWALKER_AI_MODEL`,
  `WRAITHWALKER_AI_EMBEDDING_MODEL`, `WRAITHWALKER_AI_REASONING`).
- Groups captured origins into projects by registrable domain
  (`*.google.com`-style) and connects third-party origins that were captured
  under the same browser tabs.
- Indexes captured API fixtures, static asset manifests, and trace tab links
  into embedding chunks stored in SQLite (`.wraithwalker/agent/agent.db`
  inside the fixture root). Embeddings default to
  `openai/text-embedding-3-small`; retrieval is cosine similarity.
- Runs a tool-loop agent (AI SDK 7 `ToolLoopAgent`, default model
  `deepseek/deepseek-v4-pro` with `xhigh` reasoning) with bounded fixture
  tools: `search_captures`, `list_api_endpoints`, `read_api_fixture`,
  `search_fixture_text`, and `get_project_overview`.
- Persists conversations and UIMessages in SQLite and streams turns as
  UIMessage SSE compatible with `@ai-sdk/react` `useChat`.

## HTTP surface

`registerAgentRoutes(app, deps)` mounts under `/agent` on the
`wraithwalker serve` express app:

- `GET /agent/status` — enabled flag, model config, index states
- `GET /agent/projects` — captured projects grouped by domain
- `GET|POST /agent/conversations`, `GET|DELETE /agent/conversations/:id`
- `POST /agent/index` — (re)build the RAG index for a project
- `POST /agent/chat` — streaming chat turn (UIMessage SSE)

## Usage

```ts
import { createAgentRuntime } from "@wraithwalker/agent/runtime";

const runtime = await createAgentRuntime({ rootPath });
runtime.registerRoutes(expressApp);
```

The agent is disabled (routes answer 503, status reports `enabled: false`)
when no `AI_GATEWAY_API_KEY` is available.
