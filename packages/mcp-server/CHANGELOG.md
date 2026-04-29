# @wraithwalker/mcp-server

## 2.4.0

### Minor Changes

- dc26225: Add agent-grade bounded fixture reads, streaming search, and JavaScript intelligence MCP tools for captured bundles.

  The core fixture layer now supports context-bounded reads, bounded API response pages, and large-file-safe text search so agents can inspect captured assets without loading unbounded bodies into context or memory.

  The MCP server now exposes semantic JavaScript discovery and navigation tools, including seed discovery, JS fact search, symbol reads, pipeline tracing, huge-bundle text-scan degradation, API response metadata linking, deterministic dogfood benchmarks, labeled agent eval infrastructure, and migration to `registerTool`.

  Compatibility note: `read-file` and `read-api-response` now return bounded JSON page metadata with pagination instead of unbounded raw body text.

### Patch Changes

- Updated dependencies [dc26225]
  - @wraithwalker/core@2.3.0

## 2.3.1

### Patch Changes

- 1cb5eb8: Enforce a shared site-config uniqueness invariant across config reads and writes.

  Normalized duplicate origins now collapse to one canonical site config while preserving the earliest `createdAt`, merging `dumpAllowlistPatterns` with stable deduping, and keeping config-facing CLI and MCP flows on the same deduped shape.

- Updated dependencies [1cb5eb8]
  - @wraithwalker/core@2.2.1

## 2.3.0

### Minor Changes

- 95a8088: Upgrade scenario management across the stack with root-backed active snapshot state, metadata-rich summaries, structured diffs, and trace-to-snapshot save flows.
  - `@wraithwalker/core` now stores snapshot metadata and an active snapshot marker under `.wraithwalker/scenarios`, exposes enriched snapshot summaries and panel state, and supports trace provenance plus structured scenario diffs while keeping legacy snapshots readable.
  - `@wraithwalker/extension` replaces the old names-only scenario section in Settings with a full snapshot manager that shows active and stale state, metadata cards, trace-save controls, and diff-backed switch confirmation.
  - `@wraithwalker/mcp-server` adds richer snapshot listing, `save-trace-as-snapshot`, structured scenario diffs, and active-trace-aware scenario state while keeping the legacy `scenarios` name list in the tRPC scenario response for compatibility.
  - `@wraithwalker/native-host` now returns the same structured snapshot panel data for local roots, accepts snapshot descriptions on save, and adds structured scenario diff support while preserving the legacy `scenarios` name list in `listScenarios`.

### Patch Changes

- Updated dependencies [95a8088]
  - @wraithwalker/core@2.2.0

## 2.2.0

### Minor Changes

- 8eed8bd: Add projection workspace MCP tools for same-machine agents so they can check out selected human-facing files, edit them locally, and push tracked changes back safely.

## 2.1.0

### Minor Changes

- 2f7bd97: Add site-whitelisting controls across the extension and MCP server, including the browser context menu flow and capture-preparation helpers.

### Patch Changes

- Updated dependencies [2f7bd97]
  - @wraithwalker/core@2.1.0
