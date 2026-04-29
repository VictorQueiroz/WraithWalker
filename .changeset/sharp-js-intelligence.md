---
"@wraithwalker/core": minor
"@wraithwalker/mcp-server": minor
---

Add agent-grade bounded fixture reads, streaming search, and JavaScript intelligence MCP tools for captured bundles.

The core fixture layer now supports context-bounded reads, bounded API response pages, and large-file-safe text search so agents can inspect captured assets without loading unbounded bodies into context or memory.

The MCP server now exposes semantic JavaScript discovery and navigation tools, including seed discovery, JS fact search, symbol reads, pipeline tracing, huge-bundle text-scan degradation, API response metadata linking, deterministic dogfood benchmarks, labeled agent eval infrastructure, and migration to `registerTool`.

Compatibility note: `read-file` and `read-api-response` now return bounded JSON page metadata with pagination instead of unbounded raw body text.
