# @wraithwalker/extension

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
