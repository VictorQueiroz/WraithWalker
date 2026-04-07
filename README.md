<p align="center">
  <img src="wraithwalker-banner.png" alt="WraithWalker banner" width="100%" />
</p>

# WraithWalker

**Turn a web app into local files you can edit, inspect, and feed to AI tooling.**

WraithWalker has three parts:

1. **Extraction of files (Extension)**  
   Capture responses from a running web app and save them as plain files on disk.
2. **AI agentic coding**  
   Generate context, inferred types, and editor-friendly workspace metadata from the captured app.
3. **MCP server (optional)**  
   Expose the captured fixture root to AI agents over MCP when you want tool-based inspection.

## Extraction of Files (Extension)

The Chrome extension is the core workflow.

1. Add an exact origin in the options page, like `https://app.example.com`.
2. Choose a capture root directory.
3. Start a session from the popup.
4. Browse normally.
5. WraithWalker saves matching responses as local files and replays them on future requests.

You can then edit:

- JSON API responses
- JS bundles and chunks
- CSS files
- HTML documents
- other captured asset responses

Simple mode is the default. It mirrors readable file paths like:

```text
cdn.example.com/assets/app.js
.wraithwalker/simple/...
```

That means the visible files stay easy to inspect, while metadata lives under `.wraithwalker/`.

## AI Agentic Coding

Once a fixture root exists, WraithWalker helps agents understand the captured app.

It can generate:

- `CLAUDE.md`
- editor rule files like `.cursorrules`
- inferred TypeScript types in `.wraithwalker/types/*.d.ts`

The goal is simple: give an AI coding agent a usable local workspace even when you do not have the original source code.

Typical flow:

```bash
wraithwalker context --editor cursor
```

You can also save and switch scenarios so agents can work against different captured states like:

- `logged-in`
- `empty-state`
- `error-state`

## MCP Server (Optional)

If you want an agent to inspect the fixture root through tools instead of only raw files, run the MCP server.

```bash
wraithwalker serve
wraithwalker serve --http
```

The MCP server can:

- list origins
- list assets
- list endpoints
- search content
- read fixture bodies and snippets
- read endpoint fixtures
- diff scenarios

Use it when your AI client supports MCP. Skip it if file-based workflows are enough.

## Quick Start

Install and build everything:

```bash
npm install
npm run build
```

Load the extension:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click **Load unpacked**
4. Select [`packages/extension/dist`](packages/extension/dist)

Useful commands:

```bash
wraithwalker init /path/to/fixtures
wraithwalker import-har ./capture.har /path/to/fixtures
wraithwalker sync /path/to/chrome-overrides
wraithwalker context --editor cursor
wraithwalker serve --http
```

## Packages

This repo is a Turborepo with five packages:

- [`packages/core`](packages/core): shared fixture and scenario logic
- [`packages/extension`](packages/extension): Chrome extension
- [`packages/cli`](packages/cli): command-line interface
- [`packages/mcp-server`](packages/mcp-server): MCP server
- [`packages/native-host`](packages/native-host): optional native host for editor/scenario helpers

## Development

```bash
npm run build
npm test
npm run typecheck
```

More detailed setup notes live in:

- [`packages/native-host/README.md`](packages/native-host/README.md)
- [`docs/mcp-clients.md`](docs/mcp-clients.md)
- [`docs/npm-releases.md`](docs/npm-releases.md)
