<p align="center">
  <img src="wraithwalker-banner.png" alt="WraithWalker banner" width="100%" />
</p>

# WraithWalker

WraithWalker is a Chrome extension for capturing, storing, and replaying network fixtures directly from your local filesystem. It uses `chrome.debugger` to intercept application requests, lets the browser fetch live responses when no fixture exists yet, persists those responses as editable files, and serves local files back on later requests for debugging and stateful UI testing.

An optional native-messaging host can open the selected capture root in your editor without changing the extension's core capture and replay flow.

## Monorepo Structure

This project is a [Turborepo](https://turbo.build/) monorepo with two packages:

| Package | Description |
|---------|-------------|
| [`packages/extension`](packages/extension/) | Chrome extension (service worker, popup, options, offscreen document, and shared library) |
| [`packages/native-host`](packages/native-host/) | Optional Node.js native-messaging host for editor integration |

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

`packages/extension/dist/` is the canonical packaged extension output. It is assembled directly from the TypeScript emit output plus the static extension assets in [`packages/extension/static/`](packages/extension/static/).

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select the [`packages/extension/dist/`](packages/extension/dist/) directory.

## Initial Setup

1. Open the extension options page.
2. Add one or more exact origins such as `https://app.example.com`.
3. Choose a root capture directory.
4. Optionally configure:
   - absolute root path for the native host
   - native host name
   - editor command template such as `code "$DIR"`

## Native Host

Reference files live in [`packages/native-host/README.md`](packages/native-host/README.md). The source of truth for the host lives in [`packages/native-host/src/host.mts`](packages/native-host/src/host.mts) and [`packages/native-host/src/lib.mts`](packages/native-host/src/lib.mts).

The host is not packaged automatically. Setup is manual so you can adjust the final path, extension ID, and editor command for your environment.

## Verification

Run the local checks:

```bash
npm run build
npm test
npm run typecheck
```

## Dependency Notes

IndexedDB access now uses the `idb` package. Repository reference and migration notes are in [`docs/idb-reference.md`](docs/idb-reference.md).

Chromium repository reference and DeepWiki query notes for Local Overrides research are in [`docs/chromium-reference.md`](docs/chromium-reference.md).
