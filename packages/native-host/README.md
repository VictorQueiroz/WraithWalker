# Native Host

This package provides a native-messaging host so the extension can open the active capture root, reveal it in the OS file manager, and manage scenario snapshots when the local server is not handling those actions.

Root verification and scenario operations are backed by `@wraithwalker/core`, so the native host stays aligned with the CLI and MCP server.

## Do You Need This?

Usually, no.

You normally do **not** need the native host when:

- `wraithwalker serve` is running and handling root reveal or scenario actions
- the default URL-based Cursor flow is enough for your editor-open workflow

You **do** want the native host when you need:

- OS-level folder reveal without the local server
- scenario save or switch actions without the local server
- command-based editor or shell integrations that should run outside the browser

## What It Does

| Message           | Description                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `verifyRoot`      | Reads `.wraithwalker/root.json` and verifies the sentinel `rootId` matches the extension's expectation  |
| `openDirectory`   | Verifies the root, substitutes `$DIR` in the command template, and spawns the command via `/bin/sh -lc` |
| `revealDirectory` | Verifies the root and opens that directory in Finder, Explorer, or the platform file manager            |
| `saveScenario`    | Copies current fixture directories into `.wraithwalker/scenarios/{name}/`                               |
| `switchScenario`  | Restores a saved scenario by replacing current fixtures with the snapshot                               |
| `listScenarios`   | Returns the names of all saved scenarios                                                                |

## Setup

1. Load the unpacked extension and copy the extension ID from `chrome://extensions`.
2. Build the native host:

```bash
npm run build
```

3. Copy [`host-manifest.template.json`](host-manifest.template.json) to a real manifest file and replace:
   - `__EXTENSION_ID__` with the unpacked extension ID
   - `path` with the absolute path to `out/host.mjs`

4. Make the host executable:

```bash
chmod +x /absolute/path/to/out/host.mjs
```

5. Place the manifest where Chrome looks for native-messaging hosts:

**macOS (user install):**

```
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.wraithwalker.host.json
```

**Linux:**

```
~/.config/google-chrome/NativeMessagingHosts/com.wraithwalker.host.json
```

If you use another Chromium-based browser, the host manifest location may differ slightly from the Chrome paths above.

6. In the extension options page, set:
   - **Host name:** `com.wraithwalker.host`
   - **Shared Editor Launch Path:** the same folder you selected with the directory picker
   - Optional **Custom URL Override For Cursor** if you need a non-default Cursor deeplink
   - Optional **Custom Command Override For Cursor** if you want native-host fallback to run a custom shell command

## Notes

- The extension cannot derive the OS file path from the directory handle, so the absolute root path must be entered manually.
- The sentinel verification ensures the configured filesystem path points at the same directory the extension is using.
- Scenario snapshots copy fixture files (not symlinks) to ensure portability.
- When the local WraithWalker server is connected, reveal-root and scenario actions can be handled by the server instead of the native host.
