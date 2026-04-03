# `idb` Reference

## Repository

- GitHub: `jakearchibald/idb`
- URL: `https://github.com/jakearchibald/idb`

## Why We Use It

- The extension only needs a small key/value store for the persisted root directory handle.
- `idb` keeps the IndexedDB API promise-based without introducing a bundler-specific abstraction.
- We use the `openDB` API plus the `db.get`, `db.put`, and `db.delete` store shortcuts.

## Runtime Integration

- Browser-facing source uses [`src/lib/idb.ts`](../src/lib/idb.ts).
- Source-side test and typecheck imports resolve through [`src/vendor/idb.ts`](../src/vendor/idb.ts).
- Build-time vendoring copies the npm package ESM runtime into `dist/vendor/idb.js` for the packaged extension.
- This keeps the packaged runtime import relative and Chrome-extension-compatible while still sourcing the implementation from the installed npm package.

## DeepWiki Note

- A DeepWiki MCP lookup for `jakearchibald/idb` was attempted on April 3, 2026.
- The repository was not indexed in the available DeepWiki context for this session, so implementation details were taken from the installed npm package README and runtime source.
