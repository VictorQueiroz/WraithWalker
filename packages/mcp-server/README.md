# MCP Server

An [MCP](https://modelcontextprotocol.io/) server that exposes WraithWalker fixture directories to AI agents.

## Usage

The CLI command:

```bash
wraithwalker serve
```

now starts one local HTTP server that exposes both:

- MCP at `/mcp`
- the WraithWalker tRPC capture backend at `/trpc`

`wraithwalker serve --http` is still accepted for backward compatibility, but it behaves the same as `wraithwalker serve`.

By default the combined server binds to `127.0.0.1:4319`, so the default endpoints are:

```text
http://127.0.0.1:4319/mcp
http://127.0.0.1:4319/trpc
```

Override the binding when needed:

```bash
wraithwalker serve /path/to/content-root --host 127.0.0.1 --port 4319
```

The server resolves its root path in this order:

1. first CLI argument
2. `WRAITHWALKER_ROOT`
3. platform default content root

Platform default content roots:

- macOS: `~/Library/Application Support/WraithWalker`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/wraithwalker`
- Windows: `%LOCALAPPDATA%/WraithWalker`

If the resolved root does not exist yet, the server bootstraps it with the normal `.wraithwalker/root.json` sentinel before listening.

Only loopback hosts are allowed in v1 because the tRPC surface is write-capable and intended for local use.

For existing process-spawned stdio integrations, keep using the package bin directly:

```bash
node packages/mcp-server/out/bin.mjs /path/to/fixture-root
```

## Programmatic API

The package also exports a supported server entrypoint:

```ts
import { startHttpServer, startServer } from "@wraithwalker/mcp-server/server";

await startServer("/path/to/fixture-root");

const handle = await startHttpServer("/path/to/fixture-root", {
  host: "127.0.0.1",
  port: 4319
});

console.log(handle.baseUrl); // http://127.0.0.1:4319
console.log(handle.trpcUrl); // http://127.0.0.1:4319/trpc
console.log(handle.url); // http://127.0.0.1:4319/mcp
```

Shared fixture, scenario, and context logic lives in `@wraithwalker/core`.

## Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `list-origins` | optional `search` | List all captured origins with endpoint counts, asset counts, and manifest presence |
| `list-assets` | `origin`, optional filters | List static assets for a specific origin with filtering, pagination, `matchedOrigins`, and body availability (`hasBody`, `bodySize`) |
| `list-endpoints` | `origin` | List API endpoints for a specific origin with `matchedOrigins`, plus each endpoint’s `fixtureDir`, `metaPath`, and `bodyPath` |
| `search-content` | `query`, optional filters | Search live fixture content across assets, endpoint bodies, and other text-like files, returning `matchedOrigins`, `matchKind`, and per-file `matchCount` |
| `read-endpoint-fixture` | `fixtureDir`, optional `pretty` | Read the response metadata and body for a fixture returned by `list-endpoints` |
| `read-fixture` | `path`, optional `pretty` | Read a fixture response body by relative path, restricted to the fixture root |
| `read-fixture-snippet` | `path`, optional `pretty`, optional bounds | Read a bounded text snippet from a fixture file without dumping the full blob |
| `read-manifest` | `origin` | Read the full RESOURCE_MANIFEST.json for an origin as the raw escape hatch |
| `list-scenarios` | — | List saved scenario snapshots |
| `diff-scenarios` | `scenarioA`, `scenarioB` | Compare two scenarios and report added, removed, and changed endpoints with validation for missing names |

## tRPC Backend

The same HTTP server also exposes a small typed tRPC backend used by the browser extension when it detects a local WraithWalker server.

Current procedures:

- `system.info`
- `fixtures.has`
- `fixtures.read`
- `fixtures.writeIfAbsent`
- `fixtures.generateContext`

When the extension detects the default loopback server at `http://127.0.0.1:4319/trpc`, it prefers the server root for capture, fixture reads, context generation, and Cursor open flows. If the server is unavailable, the extension falls back to its remembered local root flow.

## Recommended Workflow

WraithWalker now exposes a progressive-disclosure MCP surface for agents:

1. `list-origins` to discover what has been captured, optionally narrowed with `search`
2. `list-assets` or `list-endpoints` to narrow to the relevant files or API fixtures, using `matchedOrigins` plus `hasBody` / `bodySize` to see what is actually readable
3. `search-content` to find the exact chunk, stylesheet, response body, or text file that mentions the behavior you care about, using `matchCount` for body hits and `matchKind: "path"` when only the name/path matched
4. `read-fixture-snippet` to inspect only the relevant section of a large file, optionally with `pretty: true` for minified chunks
5. `read-fixture`, `read-endpoint-fixture`, or `read-manifest` only when you need the full raw payload

`list-assets`, `list-endpoints`, and `search-content` treat HTTP and HTTPS origins with the same host and port as one discovery group, and report the concrete origins they matched in `matchedOrigins`.

`read-fixture` and `read-endpoint-fixture` reject oversized full reads above 64 KB and direct agents to `read-fixture-snippet` with `startLine` and `lineCount`.

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

For HTTP-capable clients, point the client at the MCP URL printed by `wraithwalker serve`.

See [`../../docs/mcp-clients.md`](../../docs/mcp-clients.md) for Claude Code, Cursor, Windsurf, Codex, and generic HTTP setup examples.

## Development

```bash
npm run build      # compile TypeScript to out/
npm test           # run tests with coverage
npm run typecheck  # type-check source and tests
```
