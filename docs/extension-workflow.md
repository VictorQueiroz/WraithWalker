# Extension And Cursor Workflow

## What The Extension Does

The Chrome extension captures matching network responses from selected origins and writes them into a local fixture root.

In simple mode, readable asset files stay visible in the root, while replay metadata lives under `.wraithwalker/`.

Typical captured content includes:

- HTML documents
- JavaScript bundles and chunks
- CSS
- fonts and images
- API fixtures and response metadata

## Capture Flow

1. Add one or more exact origins in Settings.
2. Choose a capture root with the directory picker.
3. Start the session from the popup.
4. Browse the target site normally.
5. WraithWalker writes matching responses into the fixture root.

Nothing is captured unless the session is running.

The extension remembers the previously granted directory handle. Chrome does not expose the absolute local path for that picked directory back to the extension, so the remembered root is permission-based, not path-based.

## Local Server Preference

The extension can also capture through a local WraithWalker server started with:

```bash
wraithwalker serve
```

That server exposes MCP and the WraithWalker capture backend on the same local port.

When the extension detects the local server at `http://127.0.0.1:4319/trpc`, it prefers the server root instead of the remembered local directory handle. In that mode:

- capture writes go through the local WraithWalker server
- context generation goes through the local WraithWalker server
- **Open in Cursor** uses the server root path

If the server is not running, the extension falls back to the remembered local root exactly as before.

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

When the local WraithWalker server is active, the “root folder” is the server’s content root. By default that is:

- macOS: `~/Library/Application Support/WraithWalker`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/wraithwalker`
- Windows: `%LOCALAPPDATA%/WraithWalker`

## Open In Cursor

The popup is intentionally minimal:

- `Start Session` / `Stop Session`
- `Open in Cursor`
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

The goal is simple: let the agent make sense of the dumped CSS, JS, and other accessed files that were captured during the session.

## Launch Path Vs Remembered Root

These are different things:

- **Remembered root handle**  
  Lets the extension read and write the chosen directory.
- **Shared launch path**  
  Lets WraithWalker ask Cursor or the native host to open that exact folder by OS path.

If no shared launch path is configured, **Open in Cursor** still launches Cursor and sends the chat prompt, but Cursor may not open directly into the remembered folder.

When the local WraithWalker server is active, WraithWalker uses the server-reported root path instead of the local shared launch path.

## Native Host

The native host is optional.

Use it when you want:

- OS-level folder reveal
- scenario management commands
- command-based editor or shell integrations

The default Cursor flow is URL-first. Native messaging is not required just to launch Cursor and send the workspace brief.

## Related Commands

```bash
wraithwalker import-har ./capture.har /path/to/root
wraithwalker sync /path/to/chrome-overrides
wraithwalker context --editor cursor
wraithwalker serve
```
