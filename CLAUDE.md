# WraithWalker

Chrome extension for capturing, storing, and replaying network fixtures from the local filesystem. Monorepo with 4 packages: extension, native-host, mcp-server, cli.

## Build & Test

```bash
npm run build      # build all packages
npm test           # 279 tests across 4 packages
npm run typecheck  # type-check all packages
```

Coverage thresholds: 90/90/95/80 (statements/lines/functions/branches) for extension and native-host. CLI and MCP server have relaxed branch thresholds.

## Architecture

- `packages/extension` — Chrome MV3 extension (TypeScript, `.ts`, browser target)
- `packages/native-host` — Node.js native messaging host (TypeScript, `.mts`, Node target)
- `packages/mcp-server` — MCP server (TypeScript, `.mts`, Node target)
- `packages/cli` — CLI tool (TypeScript, `.mts`, Node target, imports from mcp-server and native-host via `exports` maps)

The extension uses dependency injection throughout — every module exports a `createXxx()` factory that accepts an interface of dependencies. Tests use in-memory mocks (`MemoryDirectoryHandle`, `MemoryFileHandle`) for the File System Access API.

## Research Rules

### DeepWiki MCP — Always check before modifying Chrome API integration

When working on any of the following areas, **use the DeepWiki MCP to research the relevant repository before making changes**:

#### Chrome Extension APIs

Trigger: modifying `chrome.debugger`, `chrome.runtime`, `chrome.tabs`, `chrome.storage`, `chrome.offscreen`, `chrome.permissions`, `chrome.nativeMessaging`, or `manifest.json`.

```
Repository: chromium/chromium
Ask: implementation details for the specific API being modified
Fallback: ChromeDevTools/devtools-frontend
```

#### Chrome Debugger Protocol

Trigger: modifying `Fetch.requestPaused`, `Network.enable`, `Network.getResponseBody`, `Network.requestWillBeSent`, `Network.responseReceived`, `Network.loadingFinished`, or any `chrome.debugger.sendCommand` call.

```
Repository: chromium/chromium
Ask: protocol behavior, event ordering, edge cases
Fallback: ChromeDevTools/devtools-protocol
```

#### Chrome DevTools Local Overrides

Trigger: modifying simple-mode file layout, path conventions, or fixture storage structure.

```
Repository: chromium/chromium
Ask: Local Overrides directory conventions, on-disk behavior
Fallback: ChromeDevTools/devtools-frontend
Reference: https://developer.chrome.com/docs/devtools/overrides
```

#### IndexedDB / idb package

Trigger: modifying `packages/extension/src/lib/idb.ts` or root handle persistence.

```
Repository: jakearchibald/idb
Ask: openDB API, store shortcuts, migration patterns
```

#### Chrome Extension Samples

Trigger: adding new extension capabilities, permissions, or manifest fields.

```
Repository: GoogleChrome/chrome-extensions-samples
Ask: reference implementations for the specific API
```

### General DeepWiki Usage

For any unfamiliar library, API, or open-source project encountered during development, **use the DeepWiki MCP `ask_question` tool** before guessing at APIs or behavior. This applies to:

- New npm dependencies being added
- Third-party APIs being integrated
- Protocol specifications (MCP, native messaging, etc.)
- Build tools and their configuration (Turborepo, Vitest, etc.)

### How to query DeepWiki

```
1. read_wiki_structure for {owner}/{repo} to see available topics
2. ask_question with a specific question about the behavior you need
3. If the repo is not indexed, note it and fall back to official docs
```
