# @wraithwalker/core

[![npm version](https://img.shields.io/npm/v/@wraithwalker/core)](https://www.npmjs.com/package/@wraithwalker/core)
[![License: MIT](https://img.shields.io/npm/l/@wraithwalker/core)](https://github.com/VictorQueiroz/WraithWalker/blob/main/LICENSE)

Shared Node-side domain logic that powers the [WraithWalker](https://github.com/VictorQueiroz/WraithWalker) CLI, MCP server, and native host.

## Do you need this?

Most users do **not** install `@wraithwalker/core` directly — pick `@wraithwalker/cli` (or `@wraithwalker/mcp-server` for the standalone server bin) instead.

Reach for `@wraithwalker/core` when you are building tooling or integrations on top of WraithWalker internals: custom HAR import pipelines, custom scenario tooling, alternative servers, batch context generation, etc.

## Install

```bash
npm install @wraithwalker/core
```

Requires Node.js `22+`.

## What's in it

- fixture root creation and discovery
- root filesystem helpers and projection helpers
- explicit and effective site config loading
- fixture reading and write-if-absent storage
- scenario snapshots and guided trace storage
- context generation plus HAR and Chrome Overrides import flows

## Entry points

| Import                                  | Purpose                                                     |
| --------------------------------------- | ----------------------------------------------------------- |
| `@wraithwalker/core/root`               | Create, load, and validate fixture roots.                   |
| `@wraithwalker/core/root-fs`            | Filesystem helpers for projection-backed roots.             |
| `@wraithwalker/core/root-runtime`       | Runtime root resolution shared by CLI and server.           |
| `@wraithwalker/core/site-config`        | Explicit + effective site config loading.                   |
| `@wraithwalker/core/project-config`     | Project-level capture config (`.wraithwalker/config.json`). |
| `@wraithwalker/core/fixture-layout`     | On-disk layout conventions for fixtures.                    |
| `@wraithwalker/core/fixture-repository` | Fixture read/write storage.                                 |
| `@wraithwalker/core/fixtures`           | High-level fixture helpers.                                 |
| `@wraithwalker/core/scenarios`          | Scenario snapshot save / switch / list.                     |
| `@wraithwalker/core/scenario-traces`    | Guided click trace storage.                                 |
| `@wraithwalker/core/context`            | Generate `CLAUDE.md`, editor rules, and `.d.ts` files.      |
| `@wraithwalker/core/har-import`         | Import HAR archives into a root.                            |
| `@wraithwalker/core/overrides-sync`     | Sync from Chrome DevTools Local Overrides.                  |

## Example

```ts
import { createRoot, findRoot } from "@wraithwalker/core/root";
import { listScenarios } from "@wraithwalker/core/scenarios";

const rootPath = "/path/to/fixture-root";
await createRoot(rootPath); // bootstraps .wraithwalker/root.json if missing
const scenarios = await listScenarios(rootPath);
console.log(scenarios);
```

## Documentation

Full entry-point reference and integration notes: **[docs/packages/core.mdx](https://github.com/VictorQueiroz/WraithWalker/blob/main/docs/packages/core.mdx)**.

Edit `docs/packages/core.mdx` when updating core package documentation.

## License

MIT
