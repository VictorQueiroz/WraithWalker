<p align="center">
  <img src="extension/assets/logo.svg" alt="WraithWalker logo" width="120" />
</p>

# WraithWalker

WraithWalker is a Chrome extension for capturing, storing, and replaying network fixtures directly from your local filesystem. It uses `chrome.debugger` to intercept application requests, lets the browser fetch live responses when no fixture exists yet, persists those responses as editable files, and serves local files back on later requests for debugging and stateful UI testing.

An optional native-messaging host can open the selected capture root in your editor without changing the extension's core capture and replay flow.

## Features

- No active domains on install.
- Exact-origin enablement from the options page using runtime host-permission requests.
- Global session toggle from the toolbar popup.
- Capture of HTTP(S) requests from all matching tabs while the session is active.
- Replay from local fixtures when a matching file already exists.
- Local fixture storage via File System Access and an offscreen document.
- Per-domain `RESOURCE_MANIFEST.json` files for mirrored static assets, mapping original pathnames to saved file paths.
- Reference native-messaging host with sentinel verification before opening the capture directory.

## Load The Extension

Build the packaged extension first:

```bash
npm run build
```

`dist/` is the canonical packaged extension output. It is assembled directly from the TypeScript emit output plus the static extension assets in [`extension/`](extension/).

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select the [`dist/`](dist/) directory.

The repository root is no longer treated as an unpacked extension target. Static packaging assets live in [`extension/`](extension/), and browser runtime validation targets `dist/`.

## Initial Setup

1. Open the extension options page.
2. Add one or more exact origins such as `https://app.example.com`.
3. Choose a root capture directory.
4. Optionally configure:
   - absolute root path for the native host
   - native host name
   - editor command template such as `code "$DIR"`

## Native Host

Reference files live in [`native-host/README.md`](native-host/README.md) and [`native-host/host.mjs`](native-host/host.mjs). The source of truth for the host now lives in [`src/native-host/host.mts`](src/native-host/host.mts) and [`src/native-host/lib.mts`](src/native-host/lib.mts).

The host is not packaged automatically. Setup is manual so you can adjust the final path, extension ID, and editor command for your environment.

## Verification

Run the local checks that do not require dependencies:

```bash
npm run build
npm test
npm run check:background
npm run check:popup
npm run check:options
npm run check:offscreen
npm run check:native-host
```

## Dependency Notes

IndexedDB access now uses the `idb` package. Repository reference and migration notes are in [`docs/idb-reference.md`](docs/idb-reference.md).

Chromium repository reference and DeepWiki query notes for Local Overrides research are in [`docs/chromium-reference.md`](docs/chromium-reference.md).
