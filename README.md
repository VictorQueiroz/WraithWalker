# WraithWalker

Turn a running website into local files, open that fixture root in Cursor, and optionally expose it over MCP.

WraithWalker has three parts:

1. **Chrome extension**  
   Capture responses from a real site and save them as editable local files.
2. **Cursor-first workspace flow**  
   Generate workspace context, inferred types, and a ready-to-use Cursor prompt for the captured root.
3. **Optional MCP server**  
   Let AI tools inspect the fixture root through MCP instead of raw files only.

## Quick Start

```bash
npm install
npm run build
```

Then:

1. Load [`/Users/victorqueiroz/Projects/WraithWalker/packages/extension/dist`](/Users/victorqueiroz/Projects/WraithWalker/packages/extension/dist) as an unpacked Chrome extension.
2. Add the origins you want to capture.
3. Choose a capture root.
4. Start a session.
5. Click **Open in Cursor**.

## Useful Commands

```bash
wraithwalker import-har ./capture.har /path/to/root
wraithwalker sync /path/to/chrome-overrides
wraithwalker context --editor cursor
wraithwalker serve --http
```

## Docs

- [Extension and Cursor workflow](/Users/victorqueiroz/Projects/WraithWalker/docs/extension-workflow.md)
- [MCP clients](/Users/victorqueiroz/Projects/WraithWalker/docs/mcp-clients.md)
- [npm releases](/Users/victorqueiroz/Projects/WraithWalker/docs/npm-releases.md)
