# @wraithwalker/agent

## 0.2.0

### Minor Changes

- d2b0f23: Add the WraithWalker AI assistant: a new `@wraithwalker/agent` package with a
  Vercel AI Gateway chat agent (AI SDK 7, `deepseek/deepseek-v4-pro` at `xhigh`
  reasoning), RAG over captured fixtures backed by a SQLite vector store, and
  SQLite-persisted conversations. `wraithwalker serve` now loads
  `~/.config/wraithwalker/.env` and mounts `/agent/*` HTTP routes (status,
  projects grouped by registrable domain with tab-connected origins,
  conversations, indexing, and UIMessage SSE chat). The extension gains an
  Assistant surface (React 19 + `@ai-sdk/react`) available as a side panel and
  tab, and now requires host access to all websites so newly enabled domains no
  longer prompt.
