# MCP Server

An [MCP](https://modelcontextprotocol.io/) server that exposes WraithWalker fixture directories to AI agents.

## Usage

The easiest way to start the server is via the CLI from any fixture root.

For existing process-spawned integrations, keep using `stdio`:

```bash
wraithwalker serve
```

For local HTTP-capable MCP clients, start Streamable HTTP and copy the printed URL:

```bash
wraithwalker serve --http
```

By default, HTTP mode binds to `127.0.0.1:4319` and exposes the MCP endpoint at `/mcp`, so the default URL is:

```text
http://127.0.0.1:4319/mcp
```

Override the binding when needed:

```bash
wraithwalker serve --http --host 127.0.0.1 --port 4319
```

Or run the package bin directly:

```bash
node packages/mcp-server/out/bin.mjs /path/to/fixture-root
node packages/mcp-server/out/bin.mjs --http /path/to/fixture-root
```

The server reads the root path from the first argument, the `WRAITHWALKER_ROOT` environment variable, or falls back to the current directory.

## Programmatic API

The package also exports a supported server entrypoint:

```ts
import { startHttpServer, startServer } from "@wraithwalker/mcp-server/server";

await startServer("/path/to/fixture-root");

const handle = await startHttpServer("/path/to/fixture-root", {
  host: "127.0.0.1",
  port: 4319
});

console.log(handle.url); // http://127.0.0.1:4319/mcp
```

Shared fixture, scenario, and context logic lives in `@wraithwalker/core`.

## Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `list-origins` | — | List all captured origins with endpoint and asset counts |
| `list-endpoints` | `origin` | List API endpoints for a specific origin, including the `fixtureDir` to inspect |
| `read-endpoint-fixture` | `fixtureDir` | Read the response metadata and body for a fixture returned by `list-endpoints` |
| `read-fixture` | `path` | Read a fixture response body by relative path, restricted to the fixture root |
| `read-manifest` | `origin` | Read the RESOURCE_MANIFEST.json for an origin |
| `list-scenarios` | — | List saved scenario snapshots |
| `diff-scenarios` | `scenarioA`, `scenarioB` | Compare two scenarios and report added, removed, and changed endpoints with validation for missing names |

## Client Setup

For `stdio` clients, configure the server command directly:

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

For HTTP-capable clients, point the client at the URL printed by `wraithwalker serve --http`.

See [`../../docs/mcp-clients.md`](../../docs/mcp-clients.md) for Claude Code, Cursor, Windsurf, Codex, and generic HTTP setup examples.

## Development

```bash
npm run build      # compile TypeScript to out/
npm test           # run tests with coverage
npm run typecheck  # type-check source and tests
```
