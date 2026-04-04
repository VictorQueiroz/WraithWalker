# CLI

The `wraithwalker` command-line tool for managing fixture roots, generating AI context files, and handling scenario snapshots.

## Commands

```bash
wraithwalker init [dir]              # Create a fixture root (.wraithwalker/root.json)
wraithwalker status                  # Show root path, origins, endpoints, scenarios
wraithwalker context [--editor <id>] # Regenerate CLAUDE.md and .d.ts types
wraithwalker scenarios list          # List saved scenarios
wraithwalker scenarios save <name>   # Save current fixtures as a named scenario
wraithwalker scenarios switch <name> # Switch to a saved scenario
wraithwalker scenarios diff <a> <b>  # Compare two scenarios
wraithwalker serve                   # Start the MCP server
```

## Root Discovery

All commands except `init` discover the fixture root automatically by walking up from the current directory looking for `.wraithwalker/root.json`. Use `wraithwalker init` to create one.

## Context Generation

`wraithwalker context` reads all captured fixtures and generates:

- **`CLAUDE.md`** — API endpoint inventory, inferred response shapes, static asset summary, and suggested agent tasks
- **`.cursorrules`** / **`.windsurfrules`** — editor-specific context files (use `--editor cursor` or `--editor windsurf`)
- **`.wraithwalker/types/*.d.ts`** — TypeScript interfaces inferred from captured JSON responses

Supported editor IDs: `cursor`, `antigravity`, `vscode`, `windsurf`.

## Scenario Management

Scenarios save the current fixture state as a named snapshot. You can switch between scenarios to test different application states:

```bash
wraithwalker scenarios save logged-in-admin
wraithwalker scenarios save empty-cart
wraithwalker scenarios list
wraithwalker scenarios switch empty-cart
wraithwalker scenarios diff logged-in-admin empty-cart
```

Scenarios are stored in `.wraithwalker/scenarios/` and copy fixture files (not symlinks) to ensure portability.

## MCP Server

`wraithwalker serve` starts the MCP server pointed at the nearest fixture root. This is a convenience wrapper around `@wraithwalker/mcp-server`.

## Development

```bash
npm run build      # compile TypeScript to out/
npm test           # run tests with coverage
npm run typecheck  # type-check source and tests
```
