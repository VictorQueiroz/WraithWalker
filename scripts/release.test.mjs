import assert from "node:assert/strict";
import test from "node:test";

import {
  syncInternalDependencyPins,
  parseReleaseTag,
  validateReleaseState,
  withReleaseVersion
} from "./release-lib.mjs";

function createEntry(name, relativePath, manifest) {
  return { name, relativePath, filePath: relativePath, manifest };
}

function createWorkspaceEntries() {
  return [
    createEntry("@wraithwalker/core", "packages/core/package.json", {
      name: "@wraithwalker/core",
      version: "0.1.0",
      private: false,
      publishConfig: { access: "public" }
    }),
    createEntry("@wraithwalker/mcp-server", "packages/mcp-server/package.json", {
      name: "@wraithwalker/mcp-server",
      version: "0.1.0",
      private: false,
      publishConfig: { access: "public" },
      dependencies: {
        "@wraithwalker/core": "*"
      }
    }),
    createEntry("@wraithwalker/native-host", "packages/native-host/package.json", {
      name: "@wraithwalker/native-host",
      version: "0.1.0",
      private: false,
      publishConfig: { access: "public" },
      dependencies: {
        "@wraithwalker/core": "workspace:*"
      }
    }),
    createEntry("@wraithwalker/cli", "packages/cli/package.json", {
      name: "@wraithwalker/cli",
      version: "0.1.0",
      private: false,
      publishConfig: { access: "public" },
      dependencies: {
        "@wraithwalker/core": "^0.1.0",
        "@wraithwalker/mcp-server": "*",
        commander: "^12.0.0"
      }
    }),
    createEntry("@wraithwalker/extension", "packages/extension/package.json", {
      name: "@wraithwalker/extension",
      version: "0.1.0",
      private: true,
      dependencies: {
        "@wraithwalker/core": "0.1.0",
        react: "^19.2.0"
      }
    })
  ];
}

test("withReleaseVersion updates package versions and internal pins", () => {
  const updatedEntries = withReleaseVersion(createWorkspaceEntries(), "1.2.3");
  const cliManifest = updatedEntries.find(
    ({ name }) => name === "@wraithwalker/cli"
  ).manifest;

  for (const { manifest } of updatedEntries) {
    assert.equal(manifest.version, "1.2.3");
  }

  assert.deepEqual(cliManifest.dependencies, {
    "@wraithwalker/core": "1.2.3",
    "@wraithwalker/mcp-server": "1.2.3",
    commander: "^12.0.0"
  });
});

test("syncInternalDependencyPins updates private workspace dependency pins without bumping versions", () => {
  const updatedEntries = syncInternalDependencyPins(createWorkspaceEntries(), "1.2.3");
  const extensionEntry = updatedEntries.find(
    ({ name }) => name === "@wraithwalker/extension"
  );

  assert.equal(extensionEntry.manifest.version, "0.1.0");
  assert.deepEqual(extensionEntry.manifest.dependencies, {
    "@wraithwalker/core": "1.2.3",
    react: "^19.2.0"
  });
});

test("release prepare style merge preserves publishable versions while syncing private workspace pins", () => {
  const updatedPackages = withReleaseVersion(createWorkspaceEntries().filter(({ manifest }) => manifest.private !== true), "1.2.3");
  const updatedPackageMap = new Map(updatedPackages.map((entry) => [entry.name, entry]));
  const mergedWorkspaceEntries = createWorkspaceEntries().map((entry) => (
    updatedPackageMap.get(entry.name) ?? entry
  ));
  const updatedWorkspaceEntries = syncInternalDependencyPins(mergedWorkspaceEntries, "1.2.3");
  const coreEntry = updatedWorkspaceEntries.find(({ name }) => name === "@wraithwalker/core");
  const extensionEntry = updatedWorkspaceEntries.find(({ name }) => name === "@wraithwalker/extension");

  assert.equal(coreEntry.manifest.version, "1.2.3");
  assert.equal(extensionEntry.manifest.version, "0.1.0");
  assert.deepEqual(extensionEntry.manifest.dependencies, {
    "@wraithwalker/core": "1.2.3",
    react: "^19.2.0"
  });
});

test("validateReleaseState accepts matching public packages", () => {
  const updatedEntries = withReleaseVersion(createWorkspaceEntries(), "2.0.0");
  const publishableEntries = updatedEntries.filter(({ manifest }) => manifest.private !== true);
  assert.doesNotThrow(() => validateReleaseState(publishableEntries, "2.0.0"));
});

test("validateReleaseState rejects unresolved internal dependency pins", () => {
  const updatedEntries = withReleaseVersion(createWorkspaceEntries(), "2.0.0");
  updatedEntries[3].manifest.dependencies["@wraithwalker/core"] = "*";

  assert.throws(
    () => validateReleaseState(updatedEntries.filter(({ manifest }) => manifest.private !== true), "2.0.0"),
    /@wraithwalker\/cli pins @wraithwalker\/core to \*/
  );
});

test("parseReleaseTag rejects invalid tag formats", () => {
  assert.throws(() => parseReleaseTag("2.0.0"), /vX\.Y\.Z/);
  assert.throws(() => parseReleaseTag("v2.0.0-beta.1"), /x\.y\.z/);
});
