# @wraithwalker/native-host

[![npm version](https://img.shields.io/npm/v/@wraithwalker/native-host)](https://www.npmjs.com/package/@wraithwalker/native-host)
[![License: MIT](https://img.shields.io/npm/l/@wraithwalker/native-host)](https://github.com/VictorQueiroz/WraithWalker/blob/main/LICENSE)

Native-messaging host for the [WraithWalker](https://github.com/VictorQueiroz/WraithWalker) browser extension. Provides OS-level folder reveal, scenario save/switch operations, and command-based editor integrations when the local server is not handling those actions.

## Do you need this?

Usually, **no**.

You normally do **not** need the native host when:

- `wraithwalker serve` is running and handling root reveal or scenario actions, **or**
- the default URL-based Cursor flow is enough for your editor-open workflow.

You **do** want the native host when you need:

- OS-level folder reveal without the local server
- scenario save or switch actions without the local server
- command-based editor or shell integrations that should run outside the browser

## Install

Install from the source tree (the host is registered with Chrome via a manifest, not via npm):

```bash
git clone https://github.com/VictorQueiroz/WraithWalker.git
cd WraithWalker/packages/native-host
npm ci
npm run build
chmod +x out/host.mjs
```

Then register the manifest with your browser. Copy `host-manifest.template.json` to:

- **macOS:** `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.wraithwalker.host.json`
- **Linux:** `~/.config/google-chrome/NativeMessagingHosts/com.wraithwalker.host.json`

…and replace `__EXTENSION_ID__` with your unpacked extension ID and `path` with the absolute path to `out/host.mjs`.

In the extension options page, set **Host name** to `com.wraithwalker.host` and the **Shared Editor Launch Path** to the same folder you picked with the directory picker.

Requires Node.js `22+`.

## What it does

| Message           | Description                                                                        |
| ----------------- | ---------------------------------------------------------------------------------- |
| `verifyRoot`      | Verify the `.wraithwalker/root.json` sentinel matches the extension's expectation. |
| `openDirectory`   | Substitute `$DIR` in the configured command template and spawn it.                 |
| `revealDirectory` | Open the root in Finder, Explorer, or the platform file manager.                   |
| `saveScenario`    | Copy current fixture directories into `.wraithwalker/scenarios/{name}/`.           |
| `switchScenario`  | Restore a saved scenario by replacing current fixtures with the snapshot.          |
| `listScenarios`   | Return saved scenario names plus structured snapshot state.                        |

## Documentation

Full setup, manifest layout, scenario semantics, and notes on coexistence with `wraithwalker serve`: **[docs/packages/native-host.mdx](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/packages/native-host.mdx)**.

Edit `docs/packages/native-host.mdx` when updating native-host documentation.

## License

MIT
