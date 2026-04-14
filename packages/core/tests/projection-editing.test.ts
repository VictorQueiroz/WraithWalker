import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  patchProjectionFile,
  readFixtureBody,
  resolveProjectionFile,
  restoreProjectionFile,
  writeProjectionFile
} from "../src/fixtures.mts";
import { createWraithwalkerFixtureRoot } from "../../../test-support/wraithwalker-fixture-root.mts";

async function createProjectionRoot() {
  const root = await createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-core-projection-edit-",
    rootId: "root-projection-edit"
  });
  const topOriginKey = "https__app.example.com";
  const projectionPath = "cdn.example.com/assets/chunk.js";
  const canonicalPath = `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/chunk.js.__body`;
  const requestPath = `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/chunk.js.__request.json`;
  const metaPath = `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/chunk.js.__response.json`;

  await root.writeManifest({
    topOrigin: "https://app.example.com",
    manifest: {
      schemaVersion: 1,
      topOrigin: "https://app.example.com",
      topOriginKey,
      generatedAt: "2026-04-09T00:00:00.000Z",
      resourcesByPathname: {
        "/assets/chunk.js": [
          {
            requestUrl: "https://cdn.example.com/assets/chunk.js",
            requestOrigin: "https://cdn.example.com",
            pathname: "/assets/chunk.js",
            search: "",
            bodyPath: canonicalPath,
            projectionPath,
            requestPath,
            metaPath,
            mimeType: "application/javascript",
            resourceType: "Script",
            capturedAt: "2026-04-09T00:00:00.000Z"
          }
        ]
      }
    }
  });

  await root.writeText(
    canonicalPath,
    'function renderMenu(){if(open){return{variant:"dark"}}return null}'
  );
  await root.writeJson(requestPath, {
    topOrigin: "https://app.example.com",
    url: "https://cdn.example.com/assets/chunk.js",
    method: "GET",
    headers: [],
    body: "",
    bodyEncoding: "utf8",
    bodyHash: "b-empty",
    queryHash: "q-empty",
    capturedAt: "2026-04-09T00:00:00.000Z"
  });
  await root.writeJson(metaPath, {
    status: 200,
    statusText: "OK",
    headers: [{ name: "Content-Type", value: "application/javascript" }],
    mimeType: "application/javascript",
    resourceType: "Script",
    url: "https://cdn.example.com/assets/chunk.js",
    method: "GET",
    capturedAt: "2026-04-09T00:00:00.000Z",
    bodyEncoding: "utf8",
    bodySuggestedExtension: "js"
  });
  await root.writeText(projectionPath, "window.__FROM_PROJECTION__ = true;");

  return {
    root,
    projectionPath,
    canonicalPath,
    metaPath
  };
}

async function createBinaryProjectionRoot() {
  const root = await createWraithwalkerFixtureRoot({
    prefix: "wraithwalker-core-projection-binary-",
    rootId: "root-projection-binary"
  });
  const topOriginKey = "https__app.example.com";
  const projectionPath = "cdn.example.com/assets/logo.png";
  const canonicalPath = `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/logo.png.__body`;
  const requestPath = `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/logo.png.__request.json`;
  const metaPath = `.wraithwalker/captures/assets/${topOriginKey}/cdn.example.com/assets/logo.png.__response.json`;

  await root.writeManifest({
    topOrigin: "https://app.example.com",
    manifest: {
      schemaVersion: 1,
      topOrigin: "https://app.example.com",
      topOriginKey,
      generatedAt: "2026-04-09T00:00:00.000Z",
      resourcesByPathname: {
        "/assets/logo.png": [
          {
            requestUrl: "https://cdn.example.com/assets/logo.png",
            requestOrigin: "https://cdn.example.com",
            pathname: "/assets/logo.png",
            search: "",
            bodyPath: canonicalPath,
            projectionPath,
            requestPath,
            metaPath,
            mimeType: "image/png",
            resourceType: "Image",
            capturedAt: "2026-04-09T00:00:00.000Z"
          }
        ]
      }
    }
  });

  await fs.mkdir(path.dirname(root.resolve(canonicalPath)), {
    recursive: true
  });
  await fs.writeFile(root.resolve(canonicalPath), Buffer.from([0, 1, 2, 3]));
  await fs.mkdir(path.dirname(root.resolve(projectionPath)), {
    recursive: true
  });
  await fs.writeFile(root.resolve(projectionPath), Buffer.from([0, 1, 2, 3]));
  await root.writeJson(requestPath, {
    topOrigin: "https://app.example.com",
    url: "https://cdn.example.com/assets/logo.png",
    method: "GET",
    headers: [],
    body: "",
    bodyEncoding: "utf8",
    bodyHash: "b-empty",
    queryHash: "q-empty",
    capturedAt: "2026-04-09T00:00:00.000Z"
  });
  await root.writeJson(metaPath, {
    status: 200,
    statusText: "OK",
    headers: [{ name: "Content-Type", value: "image/png" }],
    mimeType: "image/png",
    resourceType: "Image",
    url: "https://cdn.example.com/assets/logo.png",
    method: "GET",
    capturedAt: "2026-04-09T00:00:00.000Z",
    bodyEncoding: "base64",
    bodySuggestedExtension: "png"
  });

  return {
    root,
    projectionPath
  };
}

describe("projection editing", () => {
  it("resolves projection-backed files and writes only the visible projection", async () => {
    const { root, projectionPath, canonicalPath, metaPath } =
      await createProjectionRoot();

    await expect(
      resolveProjectionFile(root.rootPath, projectionPath)
    ).resolves.toEqual({
      path: projectionPath,
      canonicalPath,
      metaPath,
      currentText: "window.__FROM_PROJECTION__ = true;",
      editable: true
    });

    await expect(
      writeProjectionFile(
        root.rootPath,
        projectionPath,
        "window.__SEEDED__ = true;\n"
      )
    ).resolves.toEqual({
      path: projectionPath,
      canonicalPath,
      metaPath,
      currentText: "window.__SEEDED__ = true;\n",
      editable: true
    });

    await expect(readFixtureBody(root.rootPath, projectionPath)).resolves.toBe(
      "window.__SEEDED__ = true;\n"
    );
    await expect(
      fs.readFile(root.resolve(canonicalPath), "utf8")
    ).resolves.toBe(
      'function renderMenu(){if(open){return{variant:"dark"}}return null}'
    );
  });

  it("patches projection files by line range and detects stale expected text", async () => {
    const { root, projectionPath } = await createProjectionRoot();
    await writeProjectionFile(
      root.rootPath,
      projectionPath,
      "const seed = 1;\nconst other = 2;\n"
    );

    await expect(
      patchProjectionFile(root.rootPath, {
        path: projectionPath,
        startLine: 1,
        endLine: 1,
        expectedText: "const seed = 1;",
        replacement: "const seed = { users: [1, 2, 3] };"
      })
    ).resolves.toEqual(
      expect.objectContaining({
        path: projectionPath,
        currentText: "const seed = { users: [1, 2, 3] };\nconst other = 2;\n",
        editable: true
      })
    );

    await expect(
      patchProjectionFile(root.rootPath, {
        path: projectionPath,
        startLine: 1,
        endLine: 1,
        expectedText: "const seed = 1;",
        replacement: "const seed = 9;"
      })
    ).rejects.toThrow("Patch conflict");
  });

  it("restores projections from canonical hidden bodies and prettifies text assets", async () => {
    const { root, projectionPath } = await createProjectionRoot();
    await writeProjectionFile(
      root.rootPath,
      projectionPath,
      "window.__EDITED__ = true;"
    );

    await expect(
      restoreProjectionFile(root.rootPath, projectionPath)
    ).resolves.toEqual(
      expect.objectContaining({
        path: projectionPath,
        editable: true
      })
    );

    await expect(readFixtureBody(root.rootPath, projectionPath)).resolves.toBe(
      'function renderMenu() {\n  if (open) {\n    return { variant: "dark" };\n  }\n  return null;\n}'
    );
  });

  it("rejects hidden paths, API response bodies, arbitrary files, and binary projection edits", async () => {
    const { root, projectionPath } = await createProjectionRoot();
    await root.writeApiFixture({
      topOrigin: "https://app.example.com",
      requestOrigin: "https://api.example.com",
      method: "GET",
      fixtureName: "users__q-abc__b-def",
      meta: {
        status: 200,
        statusText: "OK",
        mimeType: "application/json",
        resourceType: "Fetch",
        url: "https://api.example.com/users",
        method: "GET",
        capturedAt: "2026-04-09T00:00:00.000Z",
        bodyEncoding: "utf8",
        bodySuggestedExtension: "json"
      },
      body: '{"users":[]}'
    });
    const binaryRoot = await createBinaryProjectionRoot();

    await expect(
      writeProjectionFile(root.rootPath, ".wraithwalker/root.json", "oops")
    ).rejects.toThrow(
      "Hidden canonical files under .wraithwalker cannot be edited"
    );
    await expect(
      writeProjectionFile(
        root.rootPath,
        ".wraithwalker/captures/http/https__app.example.com/origins/https__api.example.com/http/GET/users__q-abc__b-def/response.body",
        '{"users":[1]}'
      )
    ).rejects.toThrow("API response fixtures are read-only in this pass");
    await expect(
      writeProjectionFile(root.rootPath, "notes/agent-plan.txt", "oops")
    ).rejects.toThrow("not a projection-backed captured asset");
    await expect(
      writeProjectionFile(
        binaryRoot.root.rootPath,
        binaryRoot.projectionPath,
        "text"
      )
    ).rejects.toThrow("Projection file is not text-editable");

    await expect(
      resolveProjectionFile(root.rootPath, projectionPath)
    ).resolves.toEqual(
      expect.objectContaining({
        editable: true
      })
    );
  });
});
