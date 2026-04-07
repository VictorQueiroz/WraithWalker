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

The extension remembers the previously granted directory handle. Chrome does not expose the absolute local path for that picked directory back to the extension, so the remembered root is permission-based, not path-based.

## Open In Cursor

The popup is intentionally minimal:

- `Start Session` / `Stop Session`
- `Open in Cursor`
- `Settings`

When you click **Open in Cursor**, WraithWalker:

1. Regenerates the workspace context files.
2. Opens the remembered fixture root in Cursor when a shared absolute launch path is configured.
3. Sends a Cursor Chat prompt through Cursor's deeplink handler.

The generated brief tells Cursor that:

- this is a WraithWalker fixture workspace
- it should prettify dumped or minified contents first
- it should understand the selected origins and website structure before making changes

WraithWalker writes the supporting workspace context into:

- `CLAUDE.md`
- `.cursorrules`
- `.wraithwalker/types/*.d.ts`

## Launch Path Vs Remembered Root

These are different things:

- **Remembered root handle**  
  Lets the extension read and write the chosen directory.
- **Shared launch path**  
  Lets WraithWalker ask Cursor or the native host to open that exact folder by OS path.

If no shared launch path is configured, **Open in Cursor** still launches Cursor and sends the chat prompt, but Cursor may not open directly into the remembered folder.

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
wraithwalker serve --http
```
