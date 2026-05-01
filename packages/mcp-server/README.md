# @wraithwalker/mcp-server

[![npm version](https://img.shields.io/npm/v/@wraithwalker/mcp-server)](https://www.npmjs.com/package/@wraithwalker/mcp-server)
[![License: MIT](https://img.shields.io/npm/l/@wraithwalker/mcp-server)](https://github.com/VictorQueiroz/WraithWalker/blob/main/LICENSE)

[MCP](https://modelcontextprotocol.io/) server that exposes [WraithWalker](https://github.com/VictorQueiroz/WraithWalker) fixture roots and browser-backed trace state to AI agents. Also serves a small typed tRPC backend used by the WraithWalker browser extension when it detects a local server.

## Install

Most users should reach for the main CLI, which bundles this server:

```bash
npm install -g @wraithwalker/cli
wraithwalker serve
```

Install this package directly only when you want the standalone `wraithwalker-mcp` binary or the programmatic server API:

```bash
npm install -g @wraithwalker/mcp-server
```

Requires Node.js `22+`.

## Run as a standalone binary

Stdio MCP transport (suitable for clients like Claude Desktop, Claude Code, Codex):

```bash
wraithwalker-mcp /path/to/fixture-root
```

HTTP transport:

```bash
wraithwalker-mcp /path/to/fixture-root --http --host 127.0.0.1 --port 4319
```

If you do not specifically need the standalone transport split, prefer `wraithwalker serve` — it starts both `/mcp` and `/trpc` together and matches the extension workflow directly.

## Example MCP client config

For a stdio client pointed at a repo checkout:

```json
{
  "mcpServers": {
    "wraithwalker": {
      "command": "node",
      "args": ["packages/mcp-server/out/bin.mjs", "/path/to/fixture-root"]
    }
  }
}
```

For HTTP-capable clients, point them at the URL printed by `wraithwalker serve` (default `http://127.0.0.1:4319/mcp`).

## Programmatic API

```ts
import { startHttpServer, startServer } from "@wraithwalker/mcp-server/server";

await startServer("/path/to/fixture-root");

const handle = await startHttpServer("/path/to/fixture-root", {
  host: "127.0.0.1",
  port: 4319
});

handle.url; // http://127.0.0.1:4319/mcp
handle.trpcUrl; // http://127.0.0.1:4319/trpc
```

Other supported entry points: `@wraithwalker/mcp-server/trpc`, `@wraithwalker/mcp-server/fixture-reader`, `@wraithwalker/mcp-server/fixture-diff`.

## Documentation

- Full tool catalog (`list-sites`, `start-trace`, `read-api-response`, JS intelligence tools, etc.), tRPC procedures, and recommended agent workflow: **[docs/packages/mcp-server.mdx](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/packages/mcp-server.mdx)**
- Per-client setup (Claude Code, Cursor, Windsurf, Codex, generic HTTP): [docs/workflows/mcp-clients.mdx](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/workflows/mcp-clients.mdx)
- Guided traces: [docs/workflows/guided-scenario-traces.mdx](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/workflows/guided-scenario-traces.mdx)

Edit `docs/packages/mcp-server.mdx` when updating MCP server documentation.

## License

MIT
