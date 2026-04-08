# CLI

The `wraithwalker` command-line tool for managing fixture roots, generating AI context files, and handling scenario snapshots.

The CLI is a thin shell over shared domain logic in `@wraithwalker/core`, with `serve` delegating directly to `@wraithwalker/mcp-server/server`.

## Commands

```bash
wraithwalker init [dir]              # Create a fixture root (.wraithwalker/root.json)
wraithwalker sync [dir]              # Populate or refresh .wraithwalker from Chrome Overrides
wraithwalker import-har <har-file> [dir] [--top-origin <origin>] # Populate a fresh simple-mode fixture root from a HAR
wraithwalker status                  # Show root path, origins, endpoints, scenarios
wraithwalker context [--editor <id>] # Regenerate CLAUDE.md and .d.ts types
wraithwalker scenarios list          # List saved scenarios
wraithwalker scenarios save <name>   # Save current fixtures as a named scenario
wraithwalker scenarios switch <name> # Switch to a saved scenario
wraithwalker scenarios diff <a> <b>  # Compare two scenarios
wraithwalker serve [dir] [--http] [--host <host>] [--port <port>] # Start the combined MCP+tRPC HTTP server
```

## Root Discovery

All commands except `init`, `sync`, and `import-har` discover the fixture root automatically by walking up from the current directory looking for `.wraithwalker/root.json`. Use `wraithwalker init` to create one, `wraithwalker sync` to derive metadata from an existing Chrome Overrides directory, or `wraithwalker import-har` / `wraithwalker sync --har` to populate from a HAR file.

## Overrides Sync

`wraithwalker sync` reads a standard Chrome DevTools Local Overrides directory in place, creates `.wraithwalker/root.json` if needed, and generates simple-mode manifests plus request/response sidecars without rewriting the visible override files.

```bash
wraithwalker sync
wraithwalker sync ./overrides
```

- `dir` defaults to the current directory.
- Override files are treated as static GET fixtures.
- Standard `.headers` files are parsed and applied to generated response metadata.
- Because DevTools override paths are scheme-agnostic, sync materializes both `http://` and `https://` origin metadata for each discovered host.

## HAR Import

`wraithwalker import-har` reads a HAR from disk, creates `.wraithwalker/root.json` via the same root bootstrap used by `init`, and writes fixtures into the target directory in default simple mode. `wraithwalker sync --har` is the equivalent umbrella form.

```bash
wraithwalker import-har ./captures/app.har ./fixtures
wraithwalker import-har ./captures/app.har ./fixtures --top-origin https://app.example.com
wraithwalker sync ./fixtures --har ./captures/app.har --top-origin https://app.example.com
```

- `dir` defaults to the current directory.
- HAR syncs are additive and fail only on real content collisions.
- HAR imports can materialize multiple top origins from one archive.
- If a HAR does not contain enough information to resolve a top origin, pass `--top-origin`.
- Plain output prints imported and skipped files line by line. Interactive TTY output renders live progress bars while each fixture body is written.

## Configuration And Theming

Theme customization is config-only in v1. The CLI keeps its command layout and message structure, but you can customize semantic styles, icons, banner content, indent, and label width.

Config files are loaded in this order:

1. Built-in defaults
2. Global config
3. Project config

Project config overrides global config for commands that operate on a fixture root.

### Config locations

- Linux: `${XDG_CONFIG_HOME:-~/.config}/wraithwalker/config.json`
- macOS: `~/Library/Application Support/WraithWalker/config.json`
- Windows: `%APPDATA%/WraithWalker/config.json`
- Project: `<fixture-root>/.wraithwalker/cli.json`

### Example

```json
{
  "theme": {
    "name": "wraithwalker",
    "overrides": {
      "styles": {
        "heading": ["bold", "cyan"]
      },
      "icons": {
        "bullet": "•"
      },
      "banner": {
        "phrases": ["Custom phrase"]
      },
      "indent": "    ",
      "labelWidth": 16
    }
  }
}
```

### Validation

- Missing config files are ignored.
- Invalid JSON, unsupported keys, invalid token values, and unknown theme names are fatal errors.
- Error messages include the config file path.
- `init`, `--help`, and unknown-command handling use only the global config.

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

## Local Server

`wraithwalker serve` now starts one local HTTP server that exposes both:

- MCP at `/mcp`
- the WraithWalker extension capture backend at `/trpc`

`--http` is still accepted for backward compatibility, but it is now a no-op alias because `serve` is already HTTP-first.

By default the server binds to `127.0.0.1:4319` and chooses its content root in this order:

1. explicit `dir`
2. `WRAITHWALKER_ROOT`
3. the current WraithWalker root discovered from `cwd` or its parents
4. platform default content root

Platform default content roots:

- macOS: `~/Library/Application Support/WraithWalker`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/wraithwalker`
- Windows: `%LOCALAPPDATA%/WraithWalker`

The server auto-creates the root with the normal `.wraithwalker/root.json` bootstrap if it does not exist yet.

When the local server is running, the browser extension automatically prefers it for capture, fixture reads, context generation, and Cursor open flows. The local root picker remains the fallback when the server is unavailable.

Only loopback hosts are allowed in v1 because the tRPC surface is write-capable and local-only by design.

## Development

```bash
npm run build      # compile TypeScript to out/
npm test           # run tests with coverage
npm run typecheck  # type-check source and tests
```
