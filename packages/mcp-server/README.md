# MCP Server

An [MCP](https://modelcontextprotocol.io/) server that exposes WraithWalker fixture directories to AI agents.

## Usage

```bash
npx @wraithwalker/mcp-server /path/to/fixture-root
```

Or set the `WRAITHWALKER_ROOT` environment variable:

```bash
WRAITHWALKER_ROOT=/path/to/fixtures npx @wraithwalker/mcp-server
```

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
      "args": ["packages/mcp-server/out/server.mjs", "/path/to/fixture-root"]
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
