# Extension Workflow

## Start Here

There are two valid ways to use the extension:

- **Local-root mode**: you pick a folder in the browser, and the extension writes captures there directly
- **Server-backed mode**: you run `wraithwalker serve`, and the extension uses the server's root and config automatically

If you are new to WraithWalker, start with local-root mode first. Add the server later when you want MCP, guided traces, or one shared root for the CLI and browser.

## What The Extension Captures

The Chrome extension captures matching network responses from selected origins and writes them into a local WraithWalker root directory.

Readable asset files stay visible in the root as a projection, while canonical replay data and metadata live under `.wraithwalker/`.

Typical captured content includes:

- HTML documents
- JavaScript bundles and chunks
- CSS
- WebAssembly binaries
- API fixtures and response metadata

Shared defaults match JavaScript/TypeScript, CSS, and WebAssembly files. When you add an origin in the extension UI, WraithWalker also appends `\.json$` as a convenience so API-shaped static JSON is captured without extra setup.

Fonts, images, SVGs, and other asset types are available too, but only when your allowlist patterns include them or they arrive through an import flow such as HAR sync.

## First-Time Local Setup

1. Build the repo with `npm run build`.
2. Load `packages/extension/dist` as an unpacked extension in Chrome.
3. Open **Settings**.
4. Add one or more exact origins.
5. Choose a WraithWalker root directory with the directory picker.
6. Start the session from the popup.
7. Browse the target site normally.

Nothing is captured unless the session is running.

The extension remembers the previously granted directory handle. Chrome does not expose the absolute local path for that picked directory back to the extension, so the remembered WraithWalker root is permission-based, not path-based.

## Project Config

Every WraithWalker root can also carry an explicit capture config at:

```text
.wraithwalker/config.json
```

You manage that file through the CLI:

```bash
wraithwalker config add site."https://app.example.com"
wraithwalker config add site."https://app.example.com".dumpAllowlistPatterns "\\.svg$"
```

That explicit root config is merged with origins discovered from captured fixtures:

- configured origins appear before anything has been captured
- discovered origins still show up automatically
- explicit config wins when both describe the same origin

If you already had domains saved in the extension before this root-backed config flow, WraithWalker imports that legacy browser-local config into the selected root once the first usable root is available. After that, the root-backed config is authoritative.

If there is no local `.wraithwalker` root in the current project, `wraithwalker config` falls back to the same default root that `wraithwalker serve` would use and creates it automatically. That makes the server-backed workflow usable even before the extension has ever been configured.

## Server-Backed Mode

Start the local server with:

```bash
wraithwalker serve
```

That server exposes MCP and the WraithWalker capture backend on the same local port.

When the extension detects the local server at `http://127.0.0.1:4319/trpc`, it prefers the server root instead of the remembered local directory handle. In that mode:

- capture writes go through the local WraithWalker server
- context generation goes through the local WraithWalker server
- capture origins and dump patterns come from the server root's effective config
- the Settings page reads and writes explicit site config through the server root, even if no browser-local root is configured
- **Open in Cursor** uses the server root path
- **Open in folder** reveals the server root through the OS file manager
- guided scenario traces are stored in the server root under `.wraithwalker/scenario-traces`

If the server is not running, the extension falls back to the remembered local root exactly as before.

That also means the options page stays useful as the local fallback editor, but it does not override the server root config while the local server is connected. The server root config is the authority in that mode.

## Choose The Right Mode

Use local-root mode when:

- you only need local capture into one folder
- you do not need MCP
- you want the fewest moving parts

Use server-backed mode when:

- you want MCP tools at `/mcp`
- you want guided scenario traces
- you want the CLI and extension to share the same root and config automatically
- you want **Open in folder** to reveal the active server root

## How To Think About The Root Folder

The root folder is the working fixture workspace.

It is not the original website source repository. It is the place where WraithWalker dumps the assets and fixtures that were actually accessed while your session was running.

That means the folder can contain:

- captured JavaScript bundles and chunks
- captured CSS and HTML
- images, fonts, and other static assets
- API fixtures and replay metadata
- generated agent context files

This is the folder Cursor opens, and it is the folder the agent reasons about.

When the local WraithWalker server is active, the “root folder” is the server’s content root. With no explicit root configured, WraithWalker first reuses the current fixture root if one is already present in the working tree. Otherwise it falls back to:

- macOS: `~/Library/Application Support/WraithWalker`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/wraithwalker`
- Windows: `%LOCALAPPDATA%/WraithWalker`

## Open In Cursor

The popup stays intentionally small:

- `Start Session` / `Stop Session`
- `Open in Cursor`
- `Open in folder` when the local server is connected
- `Settings`

When you click **Open in Cursor**, WraithWalker:

1. Regenerates the workspace context files.
2. Opens the active fixture root in Cursor.
3. Prefers the local WraithWalker server root when the server is running.
4. Otherwise opens the remembered fixture root when a shared absolute launch path is configured.
5. Sends a Cursor Chat prompt through Cursor's deeplink handler.

The prompt is there to help Cursor connect the dots quickly. It tells the agent that this folder is a WraithWalker fixture workspace, asks it to prettify dumped or minified contents, and asks it to understand the structure of the selected origins before making changes.

The generated brief tells Cursor that:

- this is a WraithWalker fixture workspace
- it should prettify dumped or minified contents first
- it should understand the selected origins and website structure before making changes

WraithWalker writes the supporting workspace context into:

- `CLAUDE.md`
- `.cursorrules`
- `.wraithwalker/types/*.d.ts`

The same root is also where `wraithwalker config` writes `.wraithwalker/config.json`, so the capture rules and the captured files live together.

## Open In Cursor Requirements

`Open in Cursor` works best when WraithWalker can resolve an absolute filesystem path for the root:

- in server-backed mode, the server reports that root path directly
- in local-root mode, the extension still needs a shared launch path because the browser directory handle does not reveal the OS path

If no shared launch path is configured, WraithWalker can still launch Cursor and send the prompt, but Cursor may not open directly into the remembered root folder.

## Guided Scenario Traces

When the local server is running, MCP can ask whether the extension is connected and ready to capture.

That makes it possible to run guided scenario traces without changing the extension UI:

1. Start `wraithwalker serve`
2. Start an extension session
3. Ask `trace-status` from MCP
4. Start a scenario trace from MCP
5. Ask the user to click the relevant parts of the app while polling `trace-status`
6. Stop the trace and inspect `.wraithwalker/scenario-traces/<traceId>/trace.json` only when you need the full stored record

The extension uses the Chrome Debugger API for this flow, not a general content-script messaging layer. It installs a page-side click collector through DevTools Protocol `Runtime` and `Page`, then links captured fixtures back to those click steps.

More: [Guided scenario traces](./guided-scenario-traces.md)

## Launch Path Vs Remembered Root

These are different things:

- **Remembered root handle**  
  Lets the extension read and write the chosen directory.
- **Shared launch path**  
  Lets WraithWalker ask Cursor or the native host to open that exact folder by OS path.

## Native Host

The native host is optional.

Use it when you want:

- OS-level folder reveal
- scenario management commands
- command-based editor or shell integrations

The default Cursor flow is URL-first. Native messaging is not required just to launch Cursor and send the workspace brief.

When the local server is connected, reveal-root and scenario actions can also go through the server instead of the native host.

## Diagnostics And Support

The Settings page includes **Copy Diagnostics**, which asks the background runtime for a structured support report and copies it to the clipboard as JSON.

That report includes:

- current session snapshot and enabled origins
- local-root readiness and remembered permission state
- server connection details such as the active root path, tRPC URL, and active trace
- explicit and effective site config
- native-host config
- attached tabs, pending requests, and the last runtime error
- a short list of detected issues

For CLI-side support, run:

```bash
wraithwalker doctor
wraithwalker doctor --json
```

That gives you a root-level health report that pairs well with the extension diagnostics bundle when you need to debug local setup issues.

## Common CLI Commands

```bash
wraithwalker init /path/to/root
wraithwalker config list
wraithwalker import-har ./capture.har /path/to/root
wraithwalker sync ./overrides
wraithwalker context --editor cursor
wraithwalker serve
```
