export const EXTENSION_RELEASE_TAG_PREFIX = "@wraithwalker/extension@";
export const EXTENSION_RELEASE_ASSET_NAME = "WraithWalker.zip";

export function getExtensionReleaseTag(version) {
  return `${EXTENSION_RELEASE_TAG_PREFIX}${version}`;
}

export function getExtensionReleaseTitle(version) {
  return `WraithWalker Extension v${version}`;
}

export function getExtensionReleaseNotes(version) {
  return `Packaged Chrome extension build for version ${version}.`;
}

export function getCreateExtensionReleaseArgs({ assetPath, repo, target, version }) {
  const tag = getExtensionReleaseTag(version);

  return [
    "release",
    "create",
    tag,
    assetPath,
    "--repo",
    repo,
    "--target",
    target,
    "--title",
    getExtensionReleaseTitle(version),
    "--notes",
    getExtensionReleaseNotes(version),
    "--latest=false"
  ];
}

export function getUploadExtensionReleaseAssetArgs({ assetPath, repo, version }) {
  return [
    "release",
    "upload",
    getExtensionReleaseTag(version),
    assetPath,
    "--repo",
    repo,
    "--clobber"
  ];
}

