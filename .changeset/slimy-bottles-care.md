---
"@wraithwalker/core": patch
"@wraithwalker/mcp-server": patch
"@wraithwalker/cli": patch
---

Enforce a shared site-config uniqueness invariant across config reads and writes.

Normalized duplicate origins now collapse to one canonical site config while preserving the earliest `createdAt`, merging `dumpAllowlistPatterns` with stable deduping, and keeping config-facing CLI and MCP flows on the same deduped shape.
