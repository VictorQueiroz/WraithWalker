# npm Releases

WraithWalker publishes four workspace packages to the public npm registry:

- `@wraithwalker/core`
- `@wraithwalker/mcp-server`
- `@wraithwalker/native-host`
- `@wraithwalker/cli`

The Chrome extension package stays private and is never published to npm.

## Release Checklist

For a normal release, the flow is:

1. Prepare the next version with `npm run release:prepare -- X.Y.Z`
2. Review and commit the manifest and lockfile changes
3. Validate the repo locally
4. Push to GitHub
5. Create a GitHub Release with tag `vX.Y.Z`
6. Let the `Release` workflow publish the packages
7. Verify npm shows the new version for all four public packages

## Prerequisites

- npm `11.10.0+` is required for `npm trust github`. This repo pins `npm@11.11.1`.
- Your npm account needs write access to the `@wraithwalker` scope.
- Your npm account must have 2FA enabled before configuring trusted publishers.
- GitHub Releases should use `vX.Y.Z` tags that match the publishable package versions exactly.

The root [package.json](../package.json) is private and is not the release source of truth. `release:prepare` updates the publishable workspace packages and internal workspace dependency pins. Keeping the private root version aligned is still good housekeeping, but `release:check` validates the publishable workspace packages only.

## One-Time Bootstrap Publish

Trusted publishing can only be configured after each package already exists on npm, so the very first release is manual.

1. Install dependencies and validate the repo:

   ```bash
   npm ci
   npm run typecheck
   npm test
   npm run build
   npm pack --dry-run --workspace @wraithwalker/core
   npm pack --dry-run --workspace @wraithwalker/mcp-server
   npm pack --dry-run --workspace @wraithwalker/native-host
   npm pack --dry-run --workspace @wraithwalker/cli
   ```

2. Prepare the shared package version:

   ```bash
   npm run release:prepare -- 0.1.0
   npm run release:check -- v0.1.0
   ```

3. Publish the packages in dependency order:

   ```bash
   npm publish --access public --workspace @wraithwalker/core
   npm publish --access public --workspace @wraithwalker/mcp-server
   npm publish --access public --workspace @wraithwalker/native-host
   npm publish --access public --workspace @wraithwalker/cli
   ```

4. Confirm the packages exist on npm:

   ```bash
   npm view @wraithwalker/core version
   npm view @wraithwalker/mcp-server version
   npm view @wraithwalker/native-host version
   npm view @wraithwalker/cli version
   ```

## Configure Trusted Publishing

After the bootstrap publish succeeds, register the release workflow as a trusted publisher for each package:

```bash
npm trust github @wraithwalker/core --repo VictorQueiroz/WraithWalker --file release.yml -y
npm trust github @wraithwalker/mcp-server --repo VictorQueiroz/WraithWalker --file release.yml -y
npm trust github @wraithwalker/native-host --repo VictorQueiroz/WraithWalker --file release.yml -y
npm trust github @wraithwalker/cli --repo VictorQueiroz/WraithWalker --file release.yml -y
```

These commands bind each package to `.github/workflows/release.yml` in `VictorQueiroz/WraithWalker`. After that, GitHub Actions can publish without an `NPM_TOKEN`.

## Ongoing Release Flow

1. Prepare the next lockstep version:

   ```bash
   npm run release:prepare -- X.Y.Z
   ```

2. Review the manifest and lockfile changes. If you keep the private root version aligned for clarity, update it now too.

3. Validate the release locally. `npm test` includes the merged repo-wide coverage gate and still writes the root coverage report:

   ```bash
   npm run typecheck
   npm test
   npm run build
   npm run release:check -- vX.Y.Z
   npm pack --dry-run --workspace @wraithwalker/core
   npm pack --dry-run --workspace @wraithwalker/mcp-server
   npm pack --dry-run --workspace @wraithwalker/native-host
   npm pack --dry-run --workspace @wraithwalker/cli
   ```

4. Commit and push the prepared release changes.

5. Create a GitHub Release with tag `vX.Y.Z`.

6. Wait for the `Release` workflow to finish. It will:
   1. run `typecheck`
   2. run `test`
   3. run `build`
   4. validate the tag with `release:check`
   5. publish the packages in this order:
      - `@wraithwalker/core`
      - `@wraithwalker/mcp-server`
      - `@wraithwalker/native-host`
      - `@wraithwalker/cli`

7. Verify the published versions:

   ```bash
   npm view @wraithwalker/core version
   npm view @wraithwalker/mcp-server version
   npm view @wraithwalker/native-host version
   npm view @wraithwalker/cli version
   ```

Because publishing uses npm trusted publishing from a public GitHub repository, npm will generate provenance attestations automatically for these public packages.
