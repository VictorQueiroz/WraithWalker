# TypeScript Migration Plan

## Goals

- Keep the extension behavior unchanged during the migration.
- Preserve the current MV3 structure: background service worker, popup, options page, offscreen document, and native host.
- Avoid a bundler in the first pass unless TypeScript reveals a real packaging problem.
- Keep the current Vitest suite as the safety net while modules are converted.

## Current Surface Area

### Extension entrypoints

- `background.js`
- `popup.js`
- `options.js`
- `offscreen.js`

### Shared modules

- `lib/background-helpers.js`
- `lib/chrome-storage.js`
- `lib/constants.js`
- `lib/encoding.js`
- `lib/fixture-mapper.js`
- `lib/hash.js`
- `lib/idb.js`
- `lib/path-utils.js`
- `lib/request-lifecycle.js`
- `lib/root-handle.js`
- `lib/session-controller.js`

### Native host

- `native-host/host.mjs`
- `native-host/lib.mjs`

### Tests

- `tests/background-helpers.test.js`
- `tests/fixture-mapper.test.js`
- `tests/native-host.test.js`
- `tests/request-lifecycle.test.js`
- `tests/session-controller.test.js`

## Recommended End State

Use TypeScript as a compile step, not as a bundling step.

- Mirror the current source tree under `src/`.
- Emit browser files to `dist/` as plain `.js`.
- Emit native-host files as `.mjs`.
- Copy `manifest.json`, `.html`, `.css`, and native-host manifest templates into `dist/`.
- Keep import specifiers written as `.js` in TypeScript source so the emitted ESM stays browser-valid.

Example target layout:

```text
src/
  background.ts
  popup.ts
  options.ts
  offscreen.ts
  lib/*.ts
  native-host/host.mts
  native-host/lib.mts
dist/
  background.js
  popup.js
  options.js
  offscreen.js
  lib/*.js
  native-host/host.mjs
  native-host/lib.mjs
  manifest.json
  popup.html
  options.html
  offscreen.html
  app.css
```

## Tooling Direction

Add TypeScript without changing runtime architecture first.

- Add `typescript`.
- Add Chrome extension typings.
- Add Node typings for the native host and test environment.
- Add a root `typecheck` script.
- Add a `build` script that runs `tsc` and copies static assets into `dist/`.

Recommended config split:

- `tsconfig.base.json`
- `tsconfig.extension.json`
- `tsconfig.node.json`

Reason for the split:

- Extension code needs DOM, File System Access, IndexedDB, and Chrome API types.
- Native-host code needs Node types and should emit `.mjs`.
- Keeping those environments separate will reduce false positives and awkward global type collisions.

## Type Boundaries To Introduce Early

Create shared domain types before converting the larger modules.

- `SiteConfig`
- `NativeHostConfig`
- `SessionSnapshot`
- `AttachedTabState`
- `RequestRecord`
- `FixtureDescriptor`
- `StoredFixtureMeta`
- `OffscreenMessage`
- `NativeHostRequest`
- `NativeHostResponse`

Likely home:

- `src/lib/types.ts`
- `src/lib/chrome-debugger-types.ts`

The `chrome.debugger.sendCommand()` call sites are the main place where local wrapper types will pay off.

## Migration Phases

### Phase 1: Add Type Checking Without Moving Files

- Add TypeScript config files.
- Run `tsc --noEmit` first.
- Enable `allowJs` and `checkJs` so the existing JavaScript can be checked before file renames.
- Fix obvious type holes revealed by the compiler, especially nullability around DOM lookups and message payloads.

Exit criteria:

- `npm run typecheck` passes on the current JavaScript codebase.

### Phase 2: Convert Pure Utility Modules First

Convert the modules that already have strong unit coverage and low Chrome coupling.

- `lib/hash.js`
- `lib/encoding.js`
- `lib/path-utils.js`
- `lib/constants.js`
- `lib/fixture-mapper.js`
- `lib/background-helpers.js`

Why first:

- These files are the least risky.
- They establish the shared types used by the rest of the code.
- The current tests already cover them heavily.

Exit criteria:

- Utility modules compile as `.ts`.
- Existing Vitest tests still pass unchanged.

### Phase 3: Convert Storage And Filesystem Modules

Next convert the modules that define persistent data and File System Access behavior.

- `lib/chrome-storage.js`
- `lib/idb.js`
- `lib/root-handle.js`

Key focus:

- Typed storage keys and stored payloads.
- File System Access handle types.
- IndexedDB return types.

Exit criteria:

- All storage and root-handle operations have explicit return types.
- No `any` usage is introduced in these modules.

### Phase 4: Convert Request/Session Orchestration

Then convert the high-value business logic.

- `lib/session-controller.js`
- `lib/request-lifecycle.js`

Key focus:

- State shape for `attachedTabs` and `requests`.
- Typed debugger command wrappers.
- Typed request lifecycle events and replay/capture payloads.

This is the point where extracting a small debugger adapter may be worth doing if direct `chrome.debugger` typing becomes noisy.

Exit criteria:

- Controller and lifecycle modules compile with explicit interfaces.
- Unit tests continue to cover the converted paths.

### Phase 5: Convert Browser Entrypoints

Convert the runtime entrypoints after the shared types are stable.

- `background.js`
- `popup.js`
- `options.js`
- `offscreen.js`

Key focus:

- DOM query null-safety.
- typed `chrome.runtime.sendMessage()` payloads and responses.
- strict handling of user input and message dispatch.

Exit criteria:

- Manifest and HTML files point to emitted `dist/*.js` files.
- No runtime path regressions in the extension package.

### Phase 6: Convert The Native Host

Convert Node-side files last.

- `native-host/lib.mjs` -> `native-host/lib.mts`
- `native-host/host.mjs` -> `native-host/host.mts`

Key focus:

- message framing types
- path validation types
- process I/O types

Use the separate Node tsconfig so browser globals do not leak into the host.

Exit criteria:

- Native host emits `.mjs`.
- Existing native-host tests pass against the compiled output or source under Vitest.

### Phase 7: Tighten Strictness

After the migration is complete:

- turn on `strict`
- turn on `noUncheckedIndexedAccess`
- turn on `exactOptionalPropertyTypes`
- add `noImplicitOverride` if classes appear later

Do this after conversion, not during the first file renames.

## Testing Strategy During Migration

- Keep Vitest as the main regression harness.
- Leave tests in JavaScript for the first migration pass if that reduces churn.
- Convert tests to TypeScript only after source conversion is stable.
- Continue running:
  - `npm test`
  - syntax or type checks for entrypoints
  - the new `npm run typecheck`

## Risks And Design Constraints

- `chrome.debugger` payloads are the least ergonomic surface to type directly.
- `chrome.runtime.onMessage` currently uses stringly-typed messages and should move toward discriminated unions.
- File System Access APIs and IndexedDB handles will need careful typing around persistence boundaries.
- The background service worker, popup, options page, and offscreen document currently run as direct modules. That makes output path stability important.
- The native host is already isolated, which makes it a good TypeScript boundary but a separate config target.

## Recommended First Implementation Slice

1. Add TypeScript configs and a `typecheck` script with `allowJs` + `checkJs`.
2. Introduce shared domain types.
3. Convert `lib/constants.js`, `lib/path-utils.js`, `lib/hash.js`, and `lib/fixture-mapper.js`.
4. Run Vitest and keep the emitted JavaScript layout unchanged.

## Notes

- DeepWiki lookup against `GoogleChrome/chrome-extensions-samples` was attempted during planning, but that repository was not indexed in the available DeepWiki context for this session.
