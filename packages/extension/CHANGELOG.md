# @wraithwalker/extension

## 0.3.2

### Patch Changes

- a4fd7f0: Refresh extension workspace status when the WraithWalker server becomes available while popup or settings are already open.
- c1d0765: Refactor the extension settings UI onto React Query while preserving the existing background-message behavior.

## 0.3.1

### Patch Changes

- 93bbadb: Polish the extension popup with a cleaner dark-mode presentation and keep an already-open popup in sync when the local WraithWalker server comes online.

## 0.3.0

### Minor Changes

- 1cb5eb8: Improve the extension's daily capture flow with clearer readiness guidance in the popup and Settings, canonicalize duplicate origins at extension config boundaries, prevent duplicate whitelist writes, and ship the built extension with React's production runtime.

### Patch Changes

- Updated dependencies [1cb5eb8]
  - @wraithwalker/core@2.2.1

## 0.2.1

### Patch Changes

- e0f49d1: Improve extension workspace UX and align context-menu whitelisting with the Settings lifecycle.

## 0.2.0

### Minor Changes

- 95a8088: Upgrade scenario management across the stack with root-backed active snapshot state, metadata-rich summaries, structured diffs, and trace-to-snapshot save flows.
  - `@wraithwalker/core` now stores snapshot metadata and an active snapshot marker under `.wraithwalker/scenarios`, exposes enriched snapshot summaries and panel state, and supports trace provenance plus structured scenario diffs while keeping legacy snapshots readable.
  - `@wraithwalker/extension` replaces the old names-only scenario section in Settings with a full snapshot manager that shows active and stale state, metadata cards, trace-save controls, and diff-backed switch confirmation.
  - `@wraithwalker/mcp-server` adds richer snapshot listing, `save-trace-as-snapshot`, structured scenario diffs, and active-trace-aware scenario state while keeping the legacy `scenarios` name list in the tRPC scenario response for compatibility.
  - `@wraithwalker/native-host` now returns the same structured snapshot panel data for local roots, accepts snapshot descriptions on save, and adds structured scenario diff support while preserving the legacy `scenarios` name list in `listScenarios`.

### Patch Changes

- 406dbed: Add ESLint 9 flat config with `eslint-plugin-react-hooks` and a dedicated GitHub Actions workflow so Rules of Hooks violations in the React UI are caught automatically.
- Updated dependencies [95a8088]
  - @wraithwalker/core@2.2.0

## 0.1.1

### Patch Changes

- 28d2621: Keep the Chrome extension manifest version aligned with the extension package version and prepare the repo for independent package releases.
- 2f7bd97: Add site-whitelisting controls across the extension and MCP server, including the browser context menu flow and capture-preparation helpers.
- Updated dependencies [2f7bd97]
  - @wraithwalker/core@2.1.0
