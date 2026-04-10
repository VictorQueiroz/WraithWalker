# MCP Client Setup

## Start The Local Server

From your WraithWalker root, or by passing a root explicitly, run:

```bash
wraithwalker serve
```

By default, WraithWalker starts a local Streamable HTTP MCP server at:

```text
http://127.0.0.1:4319/mcp
```

If you pass `--host` or `--port`, use the URL printed by the CLI instead.

## Generic HTTP MCP Config

Many MCP clients accept a JSON config shaped like this:

```json
{
  "mcpServers": {
    "wraithwalker": {
      "url": "http://127.0.0.1:4319/mcp"
    }
  }
}
```

WraithWalker's MCP tools are projection-first:

- agents inspect and edit the human-facing files at the root
- canonical replay snapshots stay under `.wraithwalker/`

When the browser extension is connected to the local server, MCP can also inspect extension readiness and guided scenario traces through:

- `browser-status`
- `read-console`
- `trace-status`
- `start-trace`
- `stop-trace`
- `list-traces`
- `read-trace`

For guided traces, agents should prefer `trace-status` as the main readiness and progress surface, then use `read-trace` only when they need the full stored record.

Projection-backed assets exposed by `list-files` and `search-files` also support:

- `write-file`
- `patch-file`
- `restore-file`

More: [Guided scenario traces](./guided-scenario-traces.md)

## Codex

Codex supports HTTP MCP servers directly.

```bash
codex mcp add wraithwalker --url http://127.0.0.1:4319/mcp
```

Or add it to `~/.codex/config.toml`:

```toml
[mcp_servers.wraithwalker]
url = "http://127.0.0.1:4319/mcp"
```

## Cursor

Add the generic config entry to Cursor's MCP configuration file, such as `~/.cursor/mcp.json` on macOS and Linux.

```json
{
  "mcpServers": {
    "wraithwalker": {
      "url": "http://127.0.0.1:4319/mcp"
    }
  }
}
```

## Windsurf

Windsurf supports Streamable HTTP MCP servers from the MCP settings UI or from `~/.codeium/windsurf/mcp_config.json`.

Use the WraithWalker MCP URL:

```text
http://127.0.0.1:4319/mcp
```

If you are editing `mcp_config.json` directly, use the generic HTTP config shape shown above.

## Claude Code

Claude Code can connect to MCP servers over HTTP or `stdio`.

- For HTTP mode, point Claude Code at the WraithWalker MCP URL printed by `wraithwalker serve`.
- For `stdio` mode, keep using the command-based config shown in [packages/mcp-server/README.md](../packages/mcp-server/README.md).

If your Claude Code setup uses an MCP JSON file, add the generic HTTP config entry shown earlier for `wraithwalker`.

## Troubleshooting

- If the MCP client connects but the browser tools stay unavailable, make sure the extension is running and connected to the same local server.
- If the MCP URL is different, use the value printed by `wraithwalker serve`.
- If you want a single shared workflow for the browser, CLI, and MCP client, prefer running `wraithwalker serve` from the fixture root you actually want to use.
