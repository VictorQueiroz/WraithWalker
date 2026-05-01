# @wraithwalker/cli

[![npm version](https://img.shields.io/npm/v/@wraithwalker/cli)](https://www.npmjs.com/package/@wraithwalker/cli)
[![License: MIT](https://img.shields.io/npm/l/@wraithwalker/cli)](https://github.com/VictorQueiroz/WraithWalker/blob/main/LICENSE)

Command-line tooling for [WraithWalker](https://github.com/VictorQueiroz/WraithWalker) — manages fixture roots, project capture config, HAR/Chrome Overrides imports, editor context generation, scenario snapshots, and the local combined MCP+tRPC server.

## Install

```bash
npm install -g @wraithwalker/cli
```

Requires Node.js `22+`.

## Quick start

Start the local server, which exposes both the MCP endpoint for agents and the tRPC backend the browser extension talks to:

```bash
wraithwalker serve
# MCP   at http://127.0.0.1:4319/mcp
# tRPC  at http://127.0.0.1:4319/trpc
```

Or work without the server: create a fixture root, configure capture, then capture from the extension and inspect the result:

```bash
wraithwalker init                                  # create .wraithwalker/root.json here
wraithwalker config add site."https://app.example.com"
# (capture from the browser extension into this root)
wraithwalker status                                # show origins, endpoints, scenarios
wraithwalker context --editor cursor               # regenerate CLAUDE.md + .cursorrules
```

## Common commands

| Command                                                                 | What it does                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `wraithwalker init [dir]`                                               | Create a fixture root (`.wraithwalker/root.json`).                   |
| `wraithwalker serve [dir]`                                              | Start the combined MCP+tRPC HTTP server.                             |
| `wraithwalker status`                                                   | Report root path, origins, endpoint counts, scenarios.               |
| `wraithwalker doctor [dir] [--json]`                                    | Inspect root health and produce a support-friendly report.           |
| `wraithwalker config add\|set\|get\|unset\|list`                        | Manage explicit capture origins and dump-allowlist patterns.         |
| `wraithwalker import-har <har-file> [dir]`                              | Populate a fixture root from a HAR archive.                          |
| `wraithwalker sync [dir]`                                               | Populate or refresh a root from a Chrome Overrides directory or HAR. |
| `wraithwalker context [--editor cursor\|windsurf\|vscode\|antigravity]` | Regenerate `CLAUDE.md`, editor rules, and TypeScript types.          |
| `wraithwalker scenarios save\|switch\|list\|diff`                       | Manage saved fixture scenarios.                                      |

## Documentation

- Full command reference, root discovery rules, theming, and server behavior: **[docs/packages/cli.mdx](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/packages/cli.mdx)**
- Capture workflows: [docs/workflows/extension-workflow.mdx](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/workflows/extension-workflow.mdx)
- MCP client setup: [docs/workflows/mcp-clients.mdx](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/workflows/mcp-clients.mdx)

Edit `docs/packages/cli.mdx` when updating CLI documentation.

## License

MIT
