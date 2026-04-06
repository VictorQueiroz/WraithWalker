# npm Releases

WraithWalker publishes four workspace packages to the public npm registry:

- `@wraithwalker/core`
- `@wraithwalker/mcp-server`
- `@wraithwalker/native-host`
- `@wraithwalker/cli`

The Chrome extension package stays private and is never published to npm.

## Prerequisites

- npm `11.10.0+` is required for `npm trust github`. This repo pins `npm@11.11.1`.
- Your npm account needs write access to the `@wraithwalker` scope.
- Your npm account must have 2FA enabled before configuring trusted publishers.
- GitHub Releases should use `vX.Y.Z` tags that match the publishable package versions exactly.

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
   npm run release:prepare -- 0.2.0
   ```

2. Review the manifest and lockfile changes, then commit and push them.

3. Verify the release state locally:

   ```bash
   npm run release:check -- v0.2.0
   npm pack --dry-run --workspace @wraithwalker/core
   npm pack --dry-run --workspace @wraithwalker/mcp-server
   npm pack --dry-run --workspace @wraithwalker/native-host
   npm pack --dry-run --workspace @wraithwalker/cli
   ```

4. Create a GitHub Release with tag `v0.2.0`.

5. The `Release` workflow will run `typecheck`, `test`, `build`, validate the tag with `release:check`, then publish the packages in this order:

   1. `@wraithwalker/core`
   2. `@wraithwalker/mcp-server`
   3. `@wraithwalker/native-host`
   4. `@wraithwalker/cli`

Because publishing uses npm trusted publishing from a public GitHub repository, npm will generate provenance attestations automatically for these public packages.
