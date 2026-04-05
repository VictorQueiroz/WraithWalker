# MCP Server

An [MCP](https://modelcontextprotocol.io/) server that exposes WraithWalker fixture directories to AI agents.

## Usage

The easiest way to start the server is via the CLI from any fixture root:

```bash
wraithwalker serve
```

Or run it directly:

```bash
node packages/mcp-server/out/bin.mjs /path/to/fixture-root
```

The server reads the root path from the first argument, the `WRAITHWALKER_ROOT` environment variable, or falls back to the current directory.

## Programmatic API

The package also exports a supported server entrypoint:

```ts
import { startServer } from "@wraithwalker/mcp-server/server";

await startServer("/path/to/fixture-root");
```

Shared fixture, scenario, and context logic lives in `@wraithwalker/core`.

## Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `list-origins` | — | List all captured origins with endpoint and asset counts |
| `list-endpoints` | `origin` | List API endpoints for a specific origin |
| `read-fixture` | `path` | Read a fixture response body by relative path |
| `read-manifest` | `origin` | Read the RESOURCE_MANIFEST.json for an origin |
| `list-scenarios` | — | List saved scenario snapshots |
| `diff-scenarios` | `scenarioA`, `scenarioB` | Compare two scenarios and report added, removed, and changed endpoints |

## Claude Code Configuration

Add to your `.claude/settings.json`:

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

## Development

```bash
npm run build      # compile TypeScript to out/
npm test           # run tests with coverage
npm run typecheck  # type-check source and tests
```
