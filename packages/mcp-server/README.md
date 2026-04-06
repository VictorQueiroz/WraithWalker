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
| `list-origins` | — | List all captured origins with endpoint counts, asset counts, and manifest presence |
| `list-assets` | `origin`, optional filters | List static assets for a specific origin with filtering and pagination |
| `list-endpoints` | `origin` | List API endpoints for a specific origin, including the `fixtureDir`, `metaPath`, and `bodyPath` to inspect |
| `search-content` | `query`, optional filters | Search live fixture content across assets, endpoint bodies, and other text-like files |
| `read-endpoint-fixture` | `fixtureDir`, optional `pretty` | Read the response metadata and body for a fixture returned by `list-endpoints` |
| `read-fixture` | `path`, optional `pretty` | Read a fixture response body by relative path, restricted to the fixture root |
| `read-fixture-snippet` | `path`, optional `pretty`, optional bounds | Read a bounded text snippet from a fixture file without dumping the full blob |
| `read-manifest` | `origin` | Read the full RESOURCE_MANIFEST.json for an origin as the raw escape hatch |
| `list-scenarios` | — | List saved scenario snapshots |
| `diff-scenarios` | `scenarioA`, `scenarioB` | Compare two scenarios and report added, removed, and changed endpoints with validation for missing names |

## Recommended Workflow

WraithWalker now exposes a progressive-disclosure MCP surface for agents:

1. `list-origins` to discover what has been captured
2. `list-assets` or `list-endpoints` to narrow to the relevant files or API fixtures
3. `search-content` to find the exact chunk, stylesheet, response body, or text file that mentions the behavior you care about
4. `read-fixture-snippet` to inspect only the relevant section of a large file, optionally with `pretty: true` for minified chunks
5. `read-fixture`, `read-endpoint-fixture`, or `read-manifest` only when you need the full raw payload

`read-manifest` intentionally stays available for full-fidelity debugging, but it should not be the main discovery path for agents.

### UI Imitation Example

When an agent wants to imitate a dropdown, modal, or other UI behavior from captured files:

1. `list-origins`
2. `list-assets(origin, { resourceTypes: ["Script", "Stylesheet"] })`
3. `search-content("dropdown")`
4. `read-fixture-snippet(...)`

### State And Debugging Example

When an agent wants to understand a state transition or compare captured API behavior:

1. `list-scenarios`
2. `diff-scenarios(...)`
3. `list-endpoints(origin)`
4. `read-endpoint-fixture(...)`

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
