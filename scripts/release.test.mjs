import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("validateReleaseState accepts matching public packages", () => {
  const updatedEntries = withReleaseVersion(createWorkspaceEntries(), "2.0.0");
  assert.doesNotThrow(() => validateReleaseState(updatedEntries, "2.0.0"));
});

test("validateReleaseState rejects unresolved internal dependency pins", () => {
  const updatedEntries = withReleaseVersion(createWorkspaceEntries(), "2.0.0");
  updatedEntries[3].manifest.dependencies["@wraithwalker/core"] = "*";

  assert.throws(
    () => validateReleaseState(updatedEntries, "2.0.0"),
    /@wraithwalker\/cli pins @wraithwalker\/core to \*/
  );
});

test("parseReleaseTag rejects invalid tag formats", () => {
  assert.throws(() => parseReleaseTag("2.0.0"), /vX\.Y\.Z/);
  assert.throws(() => parseReleaseTag("v2.0.0-beta.1"), /x\.y\.z/);
});
