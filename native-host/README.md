# Native Host Setup

This repository includes a reference native-messaging host so the extension can open the configured root capture directory in an external editor.

## Files

- [`host.mjs`](host.mjs)
- [`lib.mjs`](lib.mjs)
- [`host-manifest.template.json`](host-manifest.template.json)

Source of truth:

- [`src/native-host/host.mts`](../src/native-host/host.mts)
- [`src/native-host/lib.mts`](../src/native-host/lib.mts)

## What It Does

- `verifyRoot`
  - reads `<root>/.wraithwalker/root.json`
  - verifies that the sentinel `rootId` matches the extension-side expectation
- `openDirectory`
  - verifies the root sentinel first
  - substitutes `$DIR` inside the configured command template
  - spawns the command via `/bin/sh -lc`

## Manual Setup

1. Load the unpacked extension.
2. Copy the extension ID from `chrome://extensions`.
3. Copy [`host-manifest.template.json`](host-manifest.template.json) to a real manifest file.
4. Replace:
   - `__EXTENSION_ID__` with the unpacked extension ID
   - `path` with the absolute path to [`host.mjs`](host.mjs)
5. Make the host executable:

```bash
chmod +x /absolute/path/to/wraithwalker/native-host/host.mjs
```

6. Place the manifest where Chrome looks for native-messaging manifests on macOS. For a user install:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.wraithwalker.host.json
```

7. In the extension options page, set:
   - host name: `com.wraithwalker.host`
   - absolute root path: the same folder you selected with the directory picker
   - command template: for example `code "$DIR"` or `open -a "Visual Studio Code" "$DIR"`

## Notes

- The extension cannot derive the OS file path from the directory handle, so the absolute root path must be entered manually.
- The sentinel verification is there to ensure the configured filesystem path really points at the same directory the extension is using.
