# Native Host

This package provides a native-messaging host so the extension can open the capture root in an editor and manage scenario snapshots.

## What It Does

| Message | Description |
|---------|-------------|
| `verifyRoot` | Reads `.wraithwalker/root.json` and verifies the sentinel `rootId` matches the extension's expectation |
| `openDirectory` | Verifies the root, substitutes `$DIR` in the command template, and spawns the command via `/bin/sh -lc` |
| `saveScenario` | Copies current fixture directories into `.wraithwalker/scenarios/{name}/` |
| `switchScenario` | Restores a saved scenario by replacing current fixtures with the snapshot |
| `listScenarios` | Returns the names of all saved scenarios |

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

6. In the extension options page, set:
   - **Host name:** `com.wraithwalker.host`
   - **Absolute root path:** the same folder you selected with the directory picker
   - **Command template:** e.g. `cursor "$DIR"` or `code "$DIR"`

## Notes

- The extension cannot derive the OS file path from the directory handle, so the absolute root path must be entered manually.
- The sentinel verification ensures the configured filesystem path points at the same directory the extension is using.
- Scenario snapshots copy fixture files (not symlinks) to ensure portability.
