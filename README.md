<p align="center">
  <img src="wraithwalker-banner.png" alt="WraithWalker banner" width="100%" />
</p>

# WraithWalker

**Turn any web application into a locally editable, replayable environment.**

WraithWalker is a Chrome extension that captures network responses as plain files on your filesystem and serves them back on subsequent requests. Edit a JSON API response, patch a JS bundle, swap out a stylesheet — then reload the page and see the result. No proxy, no build step, no source access required.

## How It Works

1. **Enable an origin** in the options page (e.g. `https://app.example.com`).
2. **Start a session** from the toolbar popup.
3. **Browse normally.** WraithWalker intercepts requests via `chrome.debugger`, lets the browser fetch live responses, and saves them as local files.
4. **On the next request**, if a matching fixture file exists on disk, WraithWalker serves it instead of hitting the network.
5. **Edit any fixture** in your editor. The browser picks up your changes on the next load.

### Storage Modes

| Mode | Best for | How it stores files |
|------|----------|-------------------|
| **Simple** (default) | Readable file trees, quick edits | Mirrors the original URL structure: `cdn.example.com/assets/app.js`. Metadata lives in a hidden `.wraithwalker/` directory. |
| **Advanced** | Full request/response archival | Groups everything under origin-keyed directories with request and response metadata alongside each fixture. |

### Dump Allowlist Patterns

Each site can have one or more regex patterns controlling which requests get persisted. For example, `\.css$` and `\.js$` will capture only stylesheets and scripts while letting everything else pass through to the live server.

## AI Agent Integration

WraithWalker is designed to bridge captured network fixtures with AI agentic coding workflows.

### Context Generation

When you click **"Open in {Editor}"** from the popup — or run `wraithwalker context` from the CLI — WraithWalker auto-generates context files in the fixture root:

- **`CLAUDE.md`** — API endpoint inventory, inferred response shapes, static asset summary, and suggested agent tasks
- **`.cursorrules`** — generated for Cursor, `.windsurfrules` for Windsurf
- **`.wraithwalker/types/*.d.ts`** — TypeScript interfaces inferred from captured JSON responses

This gives the AI agent instant situational awareness about the captured application.

### Editor Picker

A split button in the popup lets you choose between **Cursor**, **Antigravity**, **VS Code**, and **Windsurf**. Your last-used editor is remembered as the default.

### Scenario Snapshots

Save the current fixture state as a named scenario (e.g. "logged-in-admin", "empty-cart", "error-state") and switch between them from the popup or CLI. Scenarios are stored in `.wraithwalker/scenarios/`.

### MCP Server

The `@wraithwalker/mcp-server` package exposes captured fixtures programmatically via the [Model Context Protocol](https://modelcontextprotocol.io/):

| Tool | Description |
|------|-------------|
| `list-origins` | Summarize all captured origins |
| `list-assets` | List captured static assets for an origin with filtering and pagination |
| `list-endpoints` | API endpoints for a given origin, including a fixture directory identifier |
| `search-content` | Search live fixture content across assets, endpoint bodies, and text-like files |
| `read-endpoint-fixture` | Read response metadata and body for a listed API endpoint fixture |
| `read-fixture` | Read a fixture response body by root-bounded relative path |
| `read-fixture-snippet` | Read a bounded text snippet from a large fixture file |
| `read-manifest` | Read RESOURCE_MANIFEST.json for an origin as the raw escape hatch |
| `list-scenarios` | Enumerate saved scenario snapshots |
| `diff-scenarios` | Compare two scenarios — added, removed, and changed endpoints, with missing-scenario validation |

WraithWalker supports two MCP transport modes from the same fixture root:

```bash
wraithwalker serve          # stdio for existing local process-spawned clients
wraithwalker serve --http   # Streamable HTTP at http://127.0.0.1:4319/mcp
```

When you use `--http`, WraithWalker prints the final MCP URL, available tools, and a reminder to copy that URL into your AI client.

The intended agent workflow is progressive:

1. `list-origins`
2. `list-assets` and/or `list-endpoints`
3. `search-content`
4. `read-fixture-snippet`
5. raw reads like `read-fixture`, `read-endpoint-fixture`, or `read-manifest` only when needed

You can also run the package bin directly:

```bash
node packages/mcp-server/out/bin.mjs /path/to/fixture-root
node packages/mcp-server/out/bin.mjs --http /path/to/fixture-root
```

See [`docs/mcp-clients.md`](docs/mcp-clients.md) for Claude Code, Cursor, Windsurf, Codex, and generic HTTP setup examples.

## Features

- **Per-origin control** — enable exactly the origins you need, each with its own storage mode and allowlist patterns.
- **Capture and replay** — live responses are saved as files; existing files are served back without hitting the network.
- **Editable fixtures** — files are plain text on your filesystem. Edit them with any tool.
- **Two storage modes** — Simple mode for human-readable paths, Advanced mode for full archival.
- **Static asset manifests** — `RESOURCE_MANIFEST.json` maps original URLs to saved file paths for each domain.
- **Git-friendly** — fixture directories are plain files and folders. Branch, diff, and share them like code.
- **Context generation** — auto-generated CLAUDE.md and TypeScript types from captured responses.
- **Scenario snapshots** — save and switch between named fixture states from the popup or CLI.
- **MCP server** — expose fixtures to any MCP-compatible AI agent.
- **Fixture diffing** — compare scenarios to detect regressions, new endpoints, and contract changes.
- **CLI tool** — manage fixture roots, generate context, and handle scenarios from the terminal.
- **Editor integration** — split button for Cursor, Antigravity, VS Code, and Windsurf with an optional native-messaging host.

## Getting Started

Build all packages:

```bash
npm install
npm run build
```

### Load the Chrome Extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select the [`packages/extension/dist/`](packages/extension/dist/) directory.

Then open the extension options page to add origins and choose a root capture directory.

### Use the CLI

Initialize a fixture root and generate context:

```bash
wraithwalker init /path/to/fixtures
wraithwalker status
wraithwalker context --editor cursor
```

## Project Structure

This is a [Turborepo](https://turbo.build/) monorepo with 5 packages:

| Package | Description |
|---------|-------------|
| [`packages/core`](packages/core/) | Shared Node-side domain logic for fixture roots, fixture readers, scenarios, and context generation |
| [`packages/extension`](packages/extension/) | Chrome extension — service worker, popup, options page, offscreen document, and shared library |
| [`packages/native-host`](packages/native-host/) | Optional Node.js native-messaging host for editor integration and scenario management |
| [`packages/mcp-server`](packages/mcp-server/) | MCP server for programmatic fixture access, endpoint listing, and scenario diffing |
| [`packages/cli`](packages/cli/) | CLI tool — `wraithwalker init`, `status`, `context`, `scenarios`, `serve` |

## CLI

The `wraithwalker` CLI manages fixture roots, generates context files, and handles scenarios from the terminal.

```bash
wraithwalker init [dir]              # Create a fixture root
wraithwalker status                  # Show origins, endpoints, scenarios
wraithwalker context [--editor <id>] # Regenerate CLAUDE.md and .d.ts types
wraithwalker scenarios list          # List saved scenarios
wraithwalker scenarios save <name>   # Save current fixtures as scenario
wraithwalker scenarios switch <name> # Switch to a saved scenario
wraithwalker scenarios diff <a> <b>  # Compare two scenarios
wraithwalker serve [--http] [--host <host>] [--port <port>] # Start the MCP server
```

The CLI discovers the nearest fixture root by walking up from the current directory looking for `.wraithwalker/root.json`. Use `wraithwalker init` to create one.

### CLI Theming

The CLI theme is data-driven and configurable through layered JSON config:

- Global config:
  - Linux: `${XDG_CONFIG_HOME:-~/.config}/wraithwalker/config.json`
  - macOS: `~/Library/Application Support/WraithWalker/config.json`
  - Windows: `%APPDATA%/WraithWalker/config.json`
- Project config: `<fixture-root>/.wraithwalker/cli.json`

Project config overrides global config. Themes can customize semantic styles, icons, banner art or phrases, indent, and label width without changing the command layout.

```json
{
  "theme": {
    "name": "wraithwalker",
    "overrides": {
      "styles": {
        "heading": ["bold", "cyan"]
      },
      "icons": {
        "bullet": "•"
      },
      "banner": {
        "phrases": ["Custom phrase"]
      },
      "indent": "    ",
      "labelWidth": 16
    }
  }
}
```

## Native Host

The native host opens your capture root in an editor and manages scenario snapshots (save, switch, list). It is optional and not packaged automatically — setup is manual so you can adjust the path, extension ID, and editor command for your environment.

See [`packages/native-host/README.md`](packages/native-host/README.md) for setup instructions.

## Development

```bash
npm run build      # build all packages
npm test           # run release checks and package test suites
npm run typecheck  # type-check all packages
```

CI runs typecheck, test, and build on every pull request and push to `main` via GitHub Actions.

npm release bootstrap and GitHub Release publishing steps live in [`docs/npm-releases.md`](docs/npm-releases.md).

IndexedDB access uses the [`idb`](https://www.npmjs.com/package/idb) package. Additional reference notes live in [`docs/`](docs/).
