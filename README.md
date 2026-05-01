<p align="center">
  <img src="wraithwalker-banner.png" alt="WraithWalker banner" width="100%" />
</p>

# WraithWalker

[![npm: @wraithwalker/cli](https://img.shields.io/npm/v/@wraithwalker/cli?label=%40wraithwalker%2Fcli)](https://www.npmjs.com/package/@wraithwalker/cli)
[![License: MIT](https://img.shields.io/npm/l/@wraithwalker/cli)](LICENSE)

**Record any website's network traffic to plain files on your filesystem, then replay those files on subsequent requests.** Edit the captured responses in your editor, snapshot them as scenarios, and optionally let an AI agent drive captures over [MCP](https://modelcontextprotocol.io/).

A WraithWalker root is a working fixture workspace: readable, editable files at the root, canonical replay data and metadata under `.wraithwalker/`, and generated editor-context files (`CLAUDE.md`, `.cursorrules`) alongside them.

## Who is this for?

- Frontend engineers who want to develop offline against a deterministic snapshot of a real backend.
- Support engineers reproducing customer bugs by pinning the exact response sequence to disk.
- Agent builders who need a captured app surface they can drive and reason about over MCP.
- Anyone debugging flaky third-party APIs by pinning real responses to disk.

## Two ways to use it

| Mode                | When to choose it                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Extension-first** | Fastest first capture into a folder you choose. No CLI required.                                                   |
| **Server-backed**   | One shared local root for the extension, the CLI, and MCP clients. Required for guided traces and agent workflows. |

## Requirements

- Node.js `22+`
- npm `11.11.1+`
- Google Chrome or another Chromium browser

## Install

The extension-only flow needs no global install — just load the unpacked extension below.

For the server-backed flow:

```bash
npm install -g @wraithwalker/cli
```

To work from a checkout:

```bash
git clone https://github.com/VictorQueiroz/WraithWalker.git
cd WraithWalker
npm ci
npm run build
```

## Fastest first capture

1. Load `packages/extension/dist` as an unpacked Chrome extension.
2. Open **Settings** and add the exact origins you want to capture.
3. Choose a WraithWalker root folder where captured files will be written.
4. Start the session from the popup.
5. Browse the target site while the session is running.
6. Click **Open in Cursor** to open that same folder and send the workspace prompt.

> Nothing is captured unless a session is running.

→ [Extension workflow](docs/workflows/extension-workflow.mdx)

## Server-backed workflow

```bash
wraithwalker serve
```

This binds to `127.0.0.1:4319` by default and exposes:

- MCP at `http://127.0.0.1:4319/mcp`
- the extension capture backend at `http://127.0.0.1:4319/trpc`

While the server is running, the extension automatically prefers the server root for capture, context generation, and editor-open flows. Without it, the extension keeps using the locally selected root folder.

→ [CLI commands and local server flow](docs/packages/cli.mdx)

## Guided tracing through MCP

When `wraithwalker serve` is running, MCP tools can see whether the extension is connected and ready to capture.

1. Start the local server with `wraithwalker serve`.
2. Check `trace-status` from your MCP client.
3. Start a guided trace with `start-trace`.
4. Ask the user to click through the app while the session is running, polling `trace-status` as it progresses.
5. Stop the trace and read it back from `.wraithwalker/scenario-traces` only when the compact summaries are not enough.

This lets an agent connect user clicks to captured fixtures and explain how a specific part of the app works without guessing from filenames alone.

→ [Guided scenario traces](docs/workflows/guided-scenario-traces.mdx)

## What WraithWalker writes

Each WraithWalker root is a working fixture workspace:

- readable, editable files stay visible at the root
- canonical replay data and metadata live under `.wraithwalker/`
- generated editor context files such as `CLAUDE.md` and `.cursorrules` live alongside the captured workspace

That means you can inspect, edit, diff, snapshot, and replay the same captured workspace without needing the original source repository.

## Documentation

| Topic                                                   | Link                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Workflows**                                           |                                                                                        |
| Extension workflow                                      | [docs/workflows/extension-workflow.mdx](docs/workflows/extension-workflow.mdx)         |
| Guided scenario traces                                  | [docs/workflows/guided-scenario-traces.mdx](docs/workflows/guided-scenario-traces.mdx) |
| MCP client setup (Claude Code, Cursor, Windsurf, Codex) | [docs/workflows/mcp-clients.mdx](docs/workflows/mcp-clients.mdx)                       |
| **Packages**                                            |                                                                                        |
| CLI commands and local server                           | [docs/packages/cli.mdx](docs/packages/cli.mdx)                                         |
| MCP server tools and tRPC backend                       | [docs/packages/mcp-server.mdx](docs/packages/mcp-server.mdx)                           |
| Native host setup                                       | [docs/packages/native-host.mdx](docs/packages/native-host.mdx)                         |
| Shared core package                                     | [docs/packages/core.mdx](docs/packages/core.mdx)                                       |
| **Reference**                                           |                                                                                        |
| npm release process                                     | [docs/reference/npm-releases.mdx](docs/reference/npm-releases.mdx)                     |
| Deployment                                              | [docs/deployment.mdx](docs/deployment.mdx)                                             |

The `.mdx` files use components (`<CardGroup>`, `<Tabs>`, `<Steps>`) that GitHub does not render — they are meant to be read in the manual app under `apps/manual`. Plain GitHub viewing still works but loses the interactive layout.

## Build, test, develop

```bash
npm ci
npm run build      # build all packages
npm test           # tests across all packages
npm run typecheck  # type-check all packages
```

## Versioning

The CLI, MCP server, native host, and core package are published independently as `@wraithwalker/*` on npm. The Chrome extension versions independently as well; when its version changes, the build keeps `packages/extension/package.json`, `packages/extension/static/manifest.json`, and the built `packages/extension/dist/manifest.json` aligned.

## License

MIT — see [LICENSE](LICENSE).
