<p align="center">
  <img src="wraithwalker-banner.png" alt="WraithWalker banner" width="100%" />
</p>

# WraithWalker

Turn a running website into local files, open that fixture root in Cursor, and optionally expose it over MCP.

## Quick Start

```bash
npm install
npm run build
npm test
```

## Basic Capture

1. Load `packages/extension/dist` as an unpacked Chrome extension.
2. Add the origins you want to capture.
3. Choose a WraithWalker root folder where dumped assets will be written.
4. Start a session.
5. Browse the website while the session is running.
6. Click **Open in Cursor** to open that same folder and send the workspace prompt.

No files are captured unless a Session is running.

More: [Extension and Cursor workflow](docs/extension-workflow.md)

## Local Server

Run `wraithwalker serve` if you want one local HTTP server that exposes both MCP and the WraithWalker capture backend.

When that server is running, the extension automatically prefers the server root for capture and Cursor open flows. Without it, the extension keeps using the locally selected root folder.

More: [Serve command and local server flow](packages/cli/README.md)

## Guided Tracing Through MCP

When `wraithwalker serve` is running, MCP tools can see whether the extension is connected and ready to capture.

1. Start the local server with `wraithwalker serve`.
2. Check `trace-status` from your MCP client.
3. Start a guided trace with `start-trace`.
4. Ask the user to click through the app while the session is running and poll `trace-status` while it progresses.
5. Stop the trace and read it back from `.wraithwalker/scenario-traces` only when the compact summaries are not enough.

This lets an agent connect user clicks to captured fixtures and explain how a specific part of the app works.

More: [Guided scenario traces](docs/guided-scenario-traces.md)

## Open In Cursor

Cursor works from the dumped CSS, JS, HTML, and other accessed assets captured into that root folder. The prompt and generated workspace files help the agent prettify what was dumped and understand how the selected website is structured.

More: [Extension and Cursor workflow](docs/extension-workflow.md)

## More Docs

- [Extension and Cursor workflow](docs/extension-workflow.md)
- [Guided scenario traces](docs/guided-scenario-traces.md)
- [Serve command and local server flow](packages/cli/README.md)
- [MCP server tools and tRPC backend](packages/mcp-server/README.md)
- [MCP clients](docs/mcp-clients.md)
- [npm releases](docs/npm-releases.md)

For development and release steps, use the docs in `docs/` as the source of truth.
