# Proposal: Independent CLI and Extension Versioning

Status: Proposal for maintainer review

## Requirements Summary

WraithWalker should stop treating the CLI and Chrome extension as if they always share the same release cadence. The desired behavior is:

- the CLI version only changes when the CLI or its shipped local dependencies change
- the Chrome extension version only changes when the extension or its shipped local dependencies change
- the extension's `package.json` version and Chrome manifest `version` stay in sync
- users of one surface should not be prompted to update when only the other surface changed
- version bumps should remain semver-correct, reviewable, and easy for the maintainer to reason about

## Current State

The current repository behavior is lockstep for the public npm packages and manual for version selection:

- the root package is private and not the release source of truth (`package.json:3-20`, `docs/npm-releases.md:31`)
- release preparation is manual via `npm run release:prepare -- X.Y.Z` (`package.json:19`, `scripts/release-prepare.mjs:15-32`)
- release preparation bumps all publishable packages to the same version through `withReleaseVersion(...)` (`scripts/release-lib.mjs:16-41`, `scripts/release-lib.mjs:98-119`)
- release validation only checks the publishable packages against the release tag (`scripts/release-check.mjs:11-16`, `scripts/release-lib.mjs:151-170`)
- GitHub Actions publishes only the npm packages (`.github/workflows/release.yml:3-29`)

The Chrome extension already has a separate package version and a separate manifest version:

- extension package version lives in `packages/extension/package.json:1-25`
- Chrome manifest version lives in `packages/extension/static/manifest.json:1-20`
- the build copies the static manifest into `dist/manifest.json` (`packages/extension/scripts/build.ts:114-125`, `packages/extension/scripts/build-lib.ts:5-15`, `packages/extension/scripts/build-lib.ts:70-74`)

That means the extension's actual shipped version comes from `packages/extension/static/manifest.json`, not from `packages/extension/package.json`.

## Decision

Adopt **independent package versioning** with **Changesets** as the release metadata layer, and make `packages/extension/package.json` the single source of truth for the extension version by injecting that value into the built Chrome manifest.

## Decision Drivers

1. The CLI and extension ship to different audiences and should not force each other to bump.
2. Local workspace dependencies still matter, so release logic must understand dependency propagation.
3. The extension must not keep two human-edited version fields that can drift.
4. Semver intent should be explicit and reviewable instead of guessed from file diffs alone.

## Alternatives Considered

### Option A — Keep the current manual lockstep flow
- Pros: lowest short-term implementation effort
- Cons: keeps unnecessary bumps, keeps manual release coordination, and preserves extension manifest drift risk

### Option B — Infer semver directly from changed files or commit history
- Pros: maximally automatic on paper
- Cons: brittle in practice, hard to distinguish patch/minor/major safely, and easy to get wrong for dependency-driven changes

### Option C — Use Release Please with Conventional Commits
- Pros: more automation around release PRs and tags
- Cons: semver intent becomes indirect and commit-message-dependent; the repo still needs custom logic for the private extension artifact

### Option D — Use Changesets with independent versions **(recommended)**
- Pros: package-aware, monorepo-friendly, explicit semver intent, good dependency propagation, easy maintainer review
- Cons: requires adding changeset files to versioned changes instead of relying on one manual `release:prepare` command

## Why Changesets is the best fit here

Changesets matches the repository's real shape better than the current flow:

- the repo is a workspace monorepo (`package.json:7-9`)
- the CLI consumes internal packages (`packages/cli/package.json:43-45`)
- the extension consumes internal packages (`packages/extension/package.json:17-24`)
- the extension is private and should remain independently versioned, even though it is not published to npm (`docs/npm-releases.md:10`)

The important distinction is that Changesets can determine **which packages are affected**, while the maintainer still explicitly records whether the change is patch, minor, or major. That gives automation where it is safe and human review where it is important.

## Proposed Implementation Plan

### Phase 1 — Make the extension package version the source of truth

**Goal:** eliminate drift between `packages/extension/package.json` and the Chrome manifest version.

**Files to change:**
- `packages/extension/scripts/build.ts`
- `packages/extension/scripts/build-lib.ts`
- `packages/extension/tests/build-lib.test.ts`
- `packages/extension/tests/manifest.test.ts`
- optionally add a focused build/version test under `packages/extension/tests/`

**Implementation:**
1. Keep `packages/extension/static/manifest.json` as a template, but stop treating its `version` field as authoritative.
2. Add a small build helper that reads `packages/extension/package.json` and writes `dist/manifest.json` with `manifest.version = packageJson.version`.
3. Preserve the rest of the manifest as-is.
4. Add a regression test that fails if the built manifest version does not match the extension package version.

**Acceptance criteria:**
- `packages/extension/dist/manifest.json.version` always matches `packages/extension/package.json.version`
- changing only `packages/extension/package.json.version` changes the built extension version
- no one needs to manually edit two version fields anymore

### Phase 2 — Replace lockstep release prep with independent package versioning

**Goal:** stop forcing one shared version across core, mcp-server, native-host, and cli.

**Files to change:**
- `package.json`
- add `.changeset/config.json`
- add `.changeset/README.md` and initial changeset entries as needed
- `scripts/release-prepare.mjs`
- `scripts/release-lib.mjs`
- `scripts/release-check.mjs`
- `scripts/release.test.mjs`
- `docs/npm-releases.md`

**Implementation:**
1. Introduce Changesets in independent version mode.
2. Replace the current `release:prepare` behavior with one of these two choices:
   - remove it entirely in favor of `changeset version`, or
   - keep `release:prepare` as a thin wrapper around Changesets so the repo keeps a stable command surface
3. Remove the assumption in `scripts/release-lib.mjs` that all publishable packages share one release version.
4. Replace `release:check` so it validates the packages selected for publication rather than forcing every publishable package to equal a single tag version.
5. Keep the root `package.json` private and informational only.

**Acceptance criteria:**
- a CLI-only change can release a new CLI version without bumping unrelated packages
- a core change can bump core and any required dependents
- the repo no longer requires one shared version tag for all public packages

### Phase 3 — Add PR-time release metadata enforcement

**Goal:** ensure version intent is reviewed before merge.

**Files to change:**
- `.github/workflows/ci.yml`
- potentially add a dedicated release-metadata check workflow

**Implementation:**
1. Add a CI check that requires a changeset file when a PR changes versioned product code.
2. Allow docs-only or test-only PRs to skip release metadata when no shipped package/app changes.
3. Make the changeset file part of code review so the owner sees the intended bump type.

**Acceptance criteria:**
- shipped changes cannot merge without explicit semver intent
- docs-only PRs do not force unnecessary package releases

### Phase 4 — Split npm package publishing from extension artifact releasing

**Goal:** treat npm packages and the Chrome extension as separate release lanes.

**Files to change:**
- `.github/workflows/release.yml`
- add an extension artifact workflow if needed
- `docs/npm-releases.md`
- `docs/extension-workflow.md`
- optionally `README.md`

**Implementation:**
1. Convert the npm release flow from "manual shared tag" to package-aware publication.
2. Publish changed npm packages only.
3. Add an extension release step that builds `packages/extension/dist` and packages it as a zip artifact when the extension version changes.
4. Keep Chrome Web Store upload out of scope for the first cut unless the maintainer explicitly wants it in the same PR; there is no current Web Store automation in the repo.
5. Attach the extension artifact to a GitHub release or a workflow artifact so extension releases are reviewable and reproducible.

**Acceptance criteria:**
- npm package releases remain automated
- the extension can be versioned and packaged independently
- a CLI-only release does not create an extension artifact bump
- an extension-only release does not force npm users to upgrade unrelated packages

### Phase 5 — Update contributor and maintainer docs

**Goal:** make the new workflow understandable without tribal knowledge.

**Files to change:**
- `docs/npm-releases.md`
- `docs/extension-workflow.md`
- `README.md`

**Implementation:**
1. Document how to add a changeset for CLI, extension, and shared-package changes.
2. Document how dependency-driven bumps work.
3. Document how extension versioning now flows from `packages/extension/package.json` into the manifest build output.
4. Document how to cut or review an extension artifact release separately from npm publication.

**Acceptance criteria:**
- a maintainer can follow the docs to ship CLI-only, extension-only, or shared dependency releases
- the docs no longer describe the old single-version lockstep flow as the default

## Branch and Pull Request Plan

### Proposal branch
This proposal should live on:

- `proposal/independent-cli-extension-versioning`

That branch should contain this document only, so the maintainer can review the strategy before code changes begin.

### Follow-up implementation branch
After approval, implementation should happen on a fresh branch, for example:

- `feat/independent-package-versioning`

### Proposal pull request
The proposal PR should be a **draft** and should explain:

1. why the current lockstep/manual flow is not a good fit for the repo anymore
2. why the extension currently has a version drift hazard
3. why Changesets is preferred over file-diff inference or commit-message-only automation
4. how npm releases and extension releases would be separated
5. what is intentionally out of scope for the first implementation pass

**Suggested PR title:**

`docs: propose independent versioning for CLI and Chrome extension`

**Suggested PR body outline:**
- Problem statement
- Current repo behavior with file references
- Proposed target state
- Why this approach was chosen
- Migration phases
- Risks and rollout notes
- Questions for maintainer approval

## Risks and Mitigations

### Risk: dependency propagation becomes confusing
**Mitigation:** document that package release decisions are based on shipped dependency impact, not only changed directories.

### Risk: maintainers forget to add a changeset
**Mitigation:** add PR-time CI enforcement.

### Risk: extension packaging and npm publishing drift into two undocumented systems
**Mitigation:** update both release docs and extension docs in the same implementation series.

### Risk: migrating all release logic in one PR is too broad
**Mitigation:** keep this proposal PR review-only, then implement in one focused branch with clear checkpoints, or split the implementation into two PRs if the maintainer prefers: (1) extension version source-of-truth, (2) release-system migration.

## Verification Plan

The implementation PR should not be considered complete until it proves all of the following:

1. `npm run typecheck` passes
2. `npm test` passes
3. `npm run build` passes
4. extension build tests confirm the built manifest version matches `packages/extension/package.json`
5. release tests cover independent bumps instead of shared lockstep assumptions
6. documentation matches the implemented release flow
7. at least one dry-run release scenario is exercised for:
   - CLI-only change
   - Extension-only change
   - shared dependency change affecting CLI and/or extension

## Maintainer Review Questions

1. Should the first implementation PR keep `release:prepare` as a compatibility wrapper, or remove it and switch fully to Changesets commands?
2. Should extension releases attach a zip to GitHub Releases immediately, or start with workflow artifacts only?
3. Is it preferable to land the extension manifest sync work first in a small PR before the release-system migration?

## ADR

### Decision
Adopt independent versioning with Changesets, and make the extension package version the single source of truth for the built manifest version.

### Drivers
- reduce unnecessary updates for users
- keep semver intent explicit
- respect monorepo dependency relationships
- remove extension version drift risk

### Alternatives considered
- current lockstep manual flow
- inferred versioning from changed files or commit history
- Release Please with Conventional Commits

### Why chosen
It gives the repo package-aware automation without surrendering semver intent to brittle inference rules.

### Consequences
- contributors will need to add release metadata for shipped changes
- the release workflow will become more package-aware and less tag-centric
- extension releases become a first-class artifact lane

### Follow-ups
- implement extension manifest version injection
- introduce Changesets configuration and CI checks
- migrate npm publishing workflow
- add extension artifact release workflow and docs
