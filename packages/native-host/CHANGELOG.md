# @wraithwalker/native-host

## 2.1.1

### Patch Changes

- Updated dependencies [1cb5eb8]
  - @wraithwalker/core@2.2.1

## 2.1.0

### Minor Changes

- 95a8088: Upgrade scenario management across the stack with root-backed active snapshot state, metadata-rich summaries, structured diffs, and trace-to-snapshot save flows.
  - `@wraithwalker/core` now stores snapshot metadata and an active snapshot marker under `.wraithwalker/scenarios`, exposes enriched snapshot summaries and panel state, and supports trace provenance plus structured scenario diffs while keeping legacy snapshots readable.
  - `@wraithwalker/extension` replaces the old names-only scenario section in Settings with a full snapshot manager that shows active and stale state, metadata cards, trace-save controls, and diff-backed switch confirmation.
  - `@wraithwalker/mcp-server` adds richer snapshot listing, `save-trace-as-snapshot`, structured scenario diffs, and active-trace-aware scenario state while keeping the legacy `scenarios` name list in the tRPC scenario response for compatibility.
  - `@wraithwalker/native-host` now returns the same structured snapshot panel data for local roots, accepts snapshot descriptions on save, and adds structured scenario diff support while preserving the legacy `scenarios` name list in `listScenarios`.

### Patch Changes

- Updated dependencies [95a8088]
  - @wraithwalker/core@2.2.0

## 2.0.3

### Patch Changes

- 2c49ad0: Fix direct-execution detection so the installed host entrypoint runs correctly through symlinked paths.

## 2.0.2

### Patch Changes

- Updated dependencies [2f7bd97]
  - @wraithwalker/core@2.1.0
