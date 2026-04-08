# MCP Client Setup

Start from your WraithWalker fixture root:

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

WraithWalker's MCP tools are storage-mode agnostic. Simple mode is usually the easiest to browse alongside MCP because the dumped file paths mirror the original site structure.

When the browser extension is connected to the local server, MCP can also inspect extension readiness and guided scenario traces through:

- `extension-status`
- `start-scenario-trace`
- `stop-scenario-trace`
- `list-scenario-traces`
- `read-scenario-trace`

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

Add the generic config entry to `~/.cursor/mcp.json` on macOS/Linux, or the equivalent Cursor MCP config location on your platform.

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

If you are editing `mcp_config.json` directly, use the generic HTTP config shape above.

## Claude Code

Claude Code can connect to MCP servers over HTTP or `stdio`.

- For HTTP mode, point Claude Code at the WraithWalker MCP URL printed by `wraithwalker serve`.
- For `stdio` mode, keep using the command-based config shown in [`packages/mcp-server/README.md`](../packages/mcp-server/README.md).

If your Claude Code setup uses an MCP JSON file, add the generic HTTP config entry above for `wraithwalker`.
