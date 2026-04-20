<p align="center">
  <img src="wraithwalker-banner.png" alt="WraithWalker banner" width="100%" />
</p>

# WraithWalker

Turn a running website into a local fixture workspace, open it in your editor, and optionally expose it over MCP for agent workflows.

WraithWalker has two main ways to work:

- **Extension-first** for quick local capture into a folder you choose
- **Server-backed** for MCP, guided traces, and a shared local root that the extension and CLI use together

## Before You Start

You will usually want:

- Node `22+`
- npm `11.11.1+`
- Google Chrome or another Chromium browser for the extension workflow

Install and validate the repo:

```bash
npm ci
npm run build
npm test
```

## Fastest First Capture

Use this path if you want to capture a site into local files as quickly as possible.

1. Load `packages/extension/dist` as an unpacked Chrome extension.
2. Open **Settings** and add the exact origins you want to capture.
3. Choose a WraithWalker root folder where captured files will be written.
4. Start the session from the popup.
5. Browse the target site while the session is running.
6. Click **Open in Cursor** to open that same folder and send the workspace prompt.

Nothing is captured unless a session is running.

More: [Extension workflow](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/workflows/extension-workflow.mdx)

The CLI and Chrome extension version independently. When the extension version changes, the build keeps `packages/extension/package.json`, `packages/extension/static/manifest.json`, and the built `packages/extension/dist/manifest.json` aligned.

## Server-Backed Workflow

Use this path when you want MCP access, guided traces, or one shared local root for the CLI and extension.

Start the local server:

```bash
wraithwalker serve
```

By default this exposes:

- MCP at `http://127.0.0.1:4319/mcp`
- the extension capture backend at `http://127.0.0.1:4319/trpc`

When that server is running, the extension automatically prefers the server root for capture, context generation, and editor-open flows. Without it, the extension keeps using the locally selected root folder.

More: [Serve command and local server flow](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/packages/cli.mdx)

## Guided Tracing Through MCP

When `wraithwalker serve` is running, MCP tools can see whether the extension is connected and ready to capture.

1. Start the local server with `wraithwalker serve`.
2. Check `trace-status` from your MCP client.
3. Start a guided trace with `start-trace`.
4. Ask the user to click through the app while the session is running and poll `trace-status` while it progresses.
5. Stop the trace and read it back from `.wraithwalker/scenario-traces` only when the compact summaries are not enough.

This lets an agent connect user clicks to captured fixtures and explain how a specific part of the app works without guessing from filenames alone.

More: [Guided scenario traces](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/workflows/guided-scenario-traces.mdx)

## What WraithWalker Writes

Each WraithWalker root is a working fixture workspace:

- readable, editable files stay visible at the root
- canonical replay data and metadata live under `.wraithwalker/`
- generated editor context files such as `CLAUDE.md` and `.cursorrules` also live in that same workspace

That means you can inspect, edit, diff, snapshot, and replay the same captured workspace without needing the original source repository.

More: [Extension workflow](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/workflows/extension-workflow.mdx)

## More Docs

- [Extension workflow](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/workflows/extension-workflow.mdx)
- [Guided scenario traces](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/workflows/guided-scenario-traces.mdx)
- [CLI commands and local server flow](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/packages/cli.mdx)
- [MCP server tools and tRPC backend](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/packages/mcp-server.mdx)
- [MCP client setup](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/workflows/mcp-clients.mdx)
- [Native host setup](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/packages/native-host.mdx)
- [npm release process](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/reference/npm-releases.mdx)

For development and release steps, use the MDX files in `docs/` as the source of truth for both the repo docs and the manual app.
