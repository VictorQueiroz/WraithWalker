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
3. the current WraithWalker root discovered from `cwd` or its parents
4. platform default content root

Platform default content roots:

- macOS: `~/Library/Application Support/WraithWalker`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/wraithwalker`
- Windows: `%LOCALAPPDATA%/WraithWalker`

If the resolved root does not exist yet, the server bootstraps it with the normal `.wraithwalker/root.json` sentinel before listening.

The same root can also contain an explicit project capture config at:

```text
.wraithwalker/config.json
```

Use the CLI to manage it:

```bash
wraithwalker config add site."https://app.example.com"
wraithwalker config add site."https://app.example.com".dumpAllowlistPatterns "\\.svg$"
```

If you are not inside an existing fixture root, `wraithwalker config` falls back to the same default root that `wraithwalker serve` uses and creates it automatically. That means you can stand up the local server and configure capture domains without touching the extension at all.

The server treats that file as the explicit source of truth for capture origins and dump patterns, then merges it with any origins discovered from captured fixtures under the same root.

Shared defaults remain JavaScript/TypeScript, CSS, and WebAssembly patterns. If the extension UI adds `\.json$` for a domain, that is written into the root config as an extension convenience, not as a server-wide default policy.

Only loopback hosts are allowed in v1 because the tRPC surface is write-capable and intended for local use.

If you install this package directly, it also ships the `wraithwalker-mcp` bin.

Use it for stdio MCP:

```bash
wraithwalker-mcp /path/to/fixture-root
```

Or for the standalone HTTP transport:

```bash
wraithwalker-mcp /path/to/fixture-root --http --host 127.0.0.1 --port 4319
```

`--host` and `--port` only apply in `--http` mode. Without `--http`, the package bin starts the stdio MCP transport.

## Programmatic API

The package exports supported entry points for the combined server, the typed tRPC router, and the lower-level fixture helpers:

- `@wraithwalker/mcp-server/server`
- `@wraithwalker/mcp-server/trpc`
- `@wraithwalker/mcp-server/fixture-reader`
- `@wraithwalker/mcp-server/fixture-diff`

For example:

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
| `browser-status` | — | Report whether the browser extension is connected, capture-ready, and currently using the server root |
| `start-trace` | optional `name` | Start a guided click trace for the connected extension |
| `stop-trace` | `traceId` | Stop a guided click trace and keep it on disk |
| `list-traces` | — | List stored guided traces from `.wraithwalker/scenario-traces` |
| `read-trace` | `traceId` | Read one stored guided trace with its steps and linked fixtures |
| `list-sites` | optional `search` | List all captured origins with endpoint counts, asset counts, and manifest presence |
| `list-files` | `origin`, optional filters | List static assets for a specific origin with filtering, pagination, `matchedOrigins`, body availability (`hasBody`, `bodySize`), plus `editable` and `canonicalPath` for projection-backed files |
| `list-api-routes` | `origin` | List API endpoints for a specific origin with `matchedOrigins`, plus each endpoint’s `fixtureDir`, `metaPath`, and `bodyPath` |
| `search-files` | `query`, optional filters | Search live fixture content across assets, endpoint bodies, and other text-like files, returning `matchedOrigins`, `matchKind`, `editable`, `canonicalPath`, and per-file `matchCount` |
| `read-api-response` | `fixtureDir`, optional `pretty` | Read the response metadata and body for a fixture returned by `list-api-routes` |
| `read-file` | `path`, optional `pretty` | Read a fixture response body by relative path, restricted to the fixture root |
| `read-file-snippet` | `path`, optional `pretty`, optional bounds | Read a bounded text snippet from a fixture file without dumping the full blob |
| `read-site-manifest` | `origin` | Read the full RESOURCE_MANIFEST.json for an origin as the raw escape hatch |
| `write-file` | `path`, `content` | Overwrite an editable human-facing projection file with UTF-8 text |
| `patch-file` | `path`, `startLine`, `endLine`, `expectedText`, `replacement` | Apply a line-range patch to an editable projection file and fail if the expected text no longer matches |
| `restore-file` | `path` | Regenerate the visible projection from its canonical hidden snapshot |
| `list-snapshots` | — | List saved scenario snapshots |
| `diff-snapshots` | `scenarioA`, `scenarioB` | Compare two scenarios and report added, removed, and changed endpoints with validation for missing names |

## tRPC Backend

The same HTTP server also exposes a small typed tRPC backend used by the browser extension when it detects a local WraithWalker server.

Current procedures:

- `system.info`
- `system.revealRoot`
- `extension.heartbeat`
- `config.readConfiguredSiteConfigs`
- `config.readEffectiveSiteConfigs`
- `config.writeConfiguredSiteConfigs`
- `scenarios.list`
- `scenarios.save`
- `scenarios.switch`
- `fixtures.has`
- `fixtures.read`
- `fixtures.writeIfAbsent`
- `fixtures.generateContext`
- `scenarioTraces.recordClick`
- `scenarioTraces.linkFixture`

When the extension detects the default loopback server at `http://127.0.0.1:4319/trpc`, it prefers the server root for capture, fixture reads, context generation, and Cursor open flows. If the server is unavailable, the extension falls back to its remembered local root flow.

While the extension is connected to the local server, the server root's effective site config is authoritative. Chrome-local extension settings become fallback-only until the server disappears again.

The extension Settings page follows that same authority switch: while connected, origin and dump-pattern edits are written through tRPC into the server root's `.wraithwalker/config.json`. Without the server, the extension writes those settings to its selected local root instead.

If older extension-local site config exists, the extension imports it into the selected root once and then continues from the root-backed config.

Guided traces are server-root-only in v1 and live under `.wraithwalker/scenario-traces/`.

These procedures are the extension's local implementation API. The public agent-facing surface remains the MCP tool set documented above.

## Recommended Workflow

WraithWalker now exposes a progressive-disclosure MCP surface for agents:

1. `list-sites` to discover what has been captured, optionally narrowed with `search`
2. `list-files` or `list-api-routes` to narrow to the relevant files or API fixtures, using `matchedOrigins` plus `hasBody` / `bodySize` to see what is actually readable
3. `search-files` to find the exact chunk, stylesheet, response body, or text file that mentions the behavior you care about, using `matchCount` for body hits and `matchKind: "path"` when only the name/path matched
4. `read-file-snippet` to inspect only the relevant section of a large file, optionally with `pretty: true` for minified chunks
5. `read-file`, `read-api-response`, or `read-site-manifest` only when you need the full raw payload

When `list-files` or `search-files` marks a result as `editable: true`, agents can change the human-facing projection with:

1. `write-file(path, content)` to replace it outright
2. `patch-file(path, startLine, endLine, expectedText, replacement)` for conflict-aware line edits
3. `restore-file(path)` to regenerate it from the canonical hidden snapshot

`list-files`, `list-api-routes`, and `search-files` treat HTTP and HTTPS origins with the same host and port as one discovery group, and report the concrete origins they matched in `matchedOrigins`.

`read-file` and `read-api-response` reject oversized full reads above 64 KB and direct agents to `read-file-snippet` with `startLine` and `lineCount`.

`read-site-manifest` intentionally stays available for full-fidelity debugging, but it should not be the main discovery path for agents.

### UI Imitation Example

When an agent wants to imitate a dropdown, modal, or other UI behavior from captured files:

1. `list-sites`
2. `list-files(origin, { resourceTypes: ["Script", "Stylesheet"] })`
3. `search-files("dropdown")`
4. `read-file-snippet(...)`

### State And Debugging Example

When an agent wants to understand a state transition or compare captured API behavior:

1. `list-snapshots`
2. `diff-snapshots(...)`
3. `list-api-routes(origin)`
4. `read-api-response(...)`

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
