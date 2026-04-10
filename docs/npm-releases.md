# Package and Extension Releases

WraithWalker uses workspace-scoped versioning. The npm packages and the Chrome extension no longer share one lockstep release number.

## Published npm Packages

These workspace packages publish to npm:

- `@wraithwalker/core`
- `@wraithwalker/mcp-server`
- `@wraithwalker/native-host`
- `@wraithwalker/cli`

The Chrome extension package stays private and is not published to npm, but it is still versioned through the same Changesets workflow so its manifest and package metadata stay aligned.

## Sources of Truth

- The root [`package.json`](../package.json) is private workspace metadata and is **not** the release source of truth.
- Each workspace package owns its own version in its own `package.json`.
- The extension version is sourced from `packages/extension/package.json`.
- `npm run sync:extension-manifest-version` copies that version into `packages/extension/static/manifest.json`.
- `npm run build` then writes the built Chrome manifest in `packages/extension/dist/manifest.json` from the extension package version.

## Release Metadata Workflow

WraithWalker uses [Changesets](https://github.com/changesets/changesets) for release metadata and package-aware version bumps.

For product changes:

1. make the code change
2. add a changeset with `npm run changeset`
3. choose the affected package or app
4. choose the semver bump type
5. commit both the code and the `.changeset/*.md` file

If a PR changes shipped package or extension code and does not include release metadata, CI fails with the repo's `scripts/check-changeset.mjs` gate.

## Choosing Which Package to Bump

Use the package or app your users actually need to update.

Examples:

- CLI-only behavior change → bump `@wraithwalker/cli`
- extension-only behavior change → bump `@wraithwalker/extension`
- core-only API/runtime change that only npm consumers need → bump `@wraithwalker/core`
- core change that also changes the shipped extension behavior → include both `@wraithwalker/core` and `@wraithwalker/extension`
- MCP server change that changes the CLI's shipped behavior or required pinned dependency → include both `@wraithwalker/mcp-server` and `@wraithwalker/cli`

The goal is to avoid telling CLI users or extension users to update when their surface did not actually change.

## Daily Contributor Flow

1. Install dependencies:

   ```bash
   npm ci
   ```

2. Make your code changes.

3. Add release metadata when the shipped product changed:

   ```bash
   npm run changeset
   ```

4. Validate locally:

   ```bash
   npm run typecheck
   npm test
   npm run build
   ```

5. Open your PR with the changeset included.

## How Version Bumps Happen

Version bumps are generated from the accumulated changesets, not typed manually into one shared root command anymore.

The repo keeps a compatibility wrapper:

```bash
npm run release:prepare
```

That command runs:

1. `changeset version`
2. `npm run sync:extension-manifest-version`

It updates the affected workspace package versions, updates changelogs, and keeps the extension static manifest version aligned with the extension package version.

## Automated Release Flow

The `Release` GitHub Actions workflow runs on pushes to `main`.

It does the following:

1. installs dependencies
2. runs `typecheck`
3. runs `test`
4. runs `build`
5. runs the Changesets action
6. either:
   - opens/updates a version-packages PR when unreleased changesets exist, or
   - publishes changed npm packages when a version PR has been merged
7. uploads a zipped extension artifact when `packages/extension/package.json` changed version on `main`

That means:

- npm packages release only when their changesets say they should
- the extension artifact only refreshes when the extension version changes

## Trusted Publishing

This repo still expects npm trusted publishing for the public packages. The one-time setup remains:

```bash
npm trust github @wraithwalker/core --repo VictorQueiroz/WraithWalker --file release.yml -y
npm trust github @wraithwalker/mcp-server --repo VictorQueiroz/WraithWalker --file release.yml -y
npm trust github @wraithwalker/native-host --repo VictorQueiroz/WraithWalker --file release.yml -y
npm trust github @wraithwalker/cli --repo VictorQueiroz/WraithWalker --file release.yml -y
```

After that, GitHub Actions can publish public packages without an `NPM_TOKEN`.

## Extension Artifacts

The extension release lane is artifact-based in GitHub Actions:

- it is versioned with Changesets like the rest of the repo
- it is not published to npm
- when the extension version changes on `main`, the workflow uploads a zip of `packages/extension/dist`

Chrome Web Store upload automation is intentionally out of scope for the current setup.

## Local Release Dry Run

Before merging a release-sensitive PR, run:

```bash
npm run typecheck
npm test
npm run build
```

If you need to preview the versioning step locally:

```bash
npm run release:prepare
```

Review the resulting package version changes, changelog updates, and the synced extension manifest version before committing.
