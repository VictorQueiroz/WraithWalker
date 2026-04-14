---
"@wraithwalker/core": minor
"@wraithwalker/extension": minor
"@wraithwalker/mcp-server": minor
"@wraithwalker/native-host": minor
---

Upgrade scenario management across the stack with root-backed active snapshot state, metadata-rich summaries, structured diffs, and trace-to-snapshot save flows.

- `@wraithwalker/core` now stores snapshot metadata and an active snapshot marker under `.wraithwalker/scenarios`, exposes enriched snapshot summaries and panel state, and supports trace provenance plus structured scenario diffs while keeping legacy snapshots readable.
- `@wraithwalker/extension` replaces the old names-only scenario section in Settings with a full snapshot manager that shows active and stale state, metadata cards, trace-save controls, and diff-backed switch confirmation.
- `@wraithwalker/mcp-server` adds richer snapshot listing, `save-trace-as-snapshot`, structured scenario diffs, and active-trace-aware scenario state while keeping the legacy `scenarios` name list in the tRPC scenario response for compatibility.
- `@wraithwalker/native-host` now returns the same structured snapshot panel data for local roots, accepts snapshot descriptions on save, and adds structured scenario diff support while preserving the legacy `scenarios` name list in `listScenarios`.
