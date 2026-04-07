<p align="center">
  <img src="wraithwalker-banner.png" alt="WraithWalker banner" width="100%" />
</p>

# WraithWalker

Turn a running website into local files, open that fixture root in Cursor, and optionally expose it over MCP.

## Quick Start

```bash
npm install
npm run build
```

## How It Works

1. Load `packages/extension/dist` as an unpacked Chrome extension.
2. Add the origins you want to capture.
3. Choose a root folder where the dumped assets will be written.
4. Start a session.
5. Browse the website while the session is running.
6. Click **Open in Cursor** to open that same folder and send the workspace prompt.

## What Cursor Does Here

Cursor works from the dumped CSS, JS, HTML, and other accessed assets captured into that root folder. The prompt and generated workspace files help the agent prettify what was dumped and understand how the selected website is structured.

## Important

No files are captured unless a Session is running.

## More Docs

- [Extension and Cursor workflow](docs/extension-workflow.md)
- [MCP clients](docs/mcp-clients.md)
- [npm releases](docs/npm-releases.md)
