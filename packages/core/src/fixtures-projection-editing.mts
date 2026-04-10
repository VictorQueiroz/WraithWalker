import { createProjectedFixturePayload } from "./fixture-presentation.mjs";
import { createFixtureRootFs, resolveWithinRoot } from "./root-fs.mjs";
import { flattenStaticResourceManifest, readOriginInfo, readSiteConfigs } from "./fixtures-discovery.mjs";
import {
  applyLinePatch,
  createProjectionEditError,
  isApiResponseBodyPath,
  isEditableProjectionAsset,
  isHiddenFixturePath,
  normalizeSearchPath,
  readTextFixture
} from "./fixtures-shared.mjs";
import type { ResponseMeta, StaticResourceManifestEntry } from "./fixture-layout.mjs";
import type {
  PatchProjectionFileOptions,
  ProjectionFileInfo
} from "./fixtures-types.mjs";

interface ResolvedProjectionFile extends ProjectionFileInfo {
  projectionPayload: {
    body: string;
    bodyEncoding: "utf8" | "base64";
  };
}

async function findProjectionAsset(
  rootPath: string,
  relativePath: string
): Promise<StaticResourceManifestEntry | null> {
  const configs = await readSiteConfigs(rootPath);
  const normalizedTarget = normalizeSearchPath(relativePath);

  for (const config of configs) {
    const info = await readOriginInfo(rootPath, config);
    for (const asset of flattenStaticResourceManifest(info.manifest)) {
      if (asset.projectionPath && normalizeSearchPath(asset.projectionPath) === normalizedTarget) {
        return asset;
      }
    }
  }

  return null;
}

async function resolveProjectionFileDetails(
  rootPath: string,
  relativePath: string
): Promise<ResolvedProjectionFile | null> {
  if (isHiddenFixturePath(relativePath) || isApiResponseBodyPath(relativePath)) {
    return null;
  }

  const asset = await findProjectionAsset(rootPath, relativePath);
  if (!asset?.projectionPath) {
    return null;
  }

  const rootFs = createFixtureRootFs(rootPath);
  const [meta, currentTextResult, canonicalBodyBase64] = await Promise.all([
    rootFs.readOptionalJson<ResponseMeta>(asset.metaPath),
    readTextFixture(rootPath, asset.projectionPath),
    rootFs.readBodyAsBase64(asset.bodyPath).catch(() => null)
  ]);
  if (!meta || !canonicalBodyBase64) {
    return null;
  }

  const projectionPayload = await createProjectedFixturePayload({
    relativePath: asset.projectionPath,
    payload: {
      body: canonicalBodyBase64,
      bodyEncoding: "base64"
    },
    mimeType: meta.mimeType,
    resourceType: meta.resourceType
  });

  return {
    path: asset.projectionPath,
    canonicalPath: asset.bodyPath,
    metaPath: asset.metaPath,
    currentText: isEditableProjectionAsset(asset.projectionPath, meta) && currentTextResult.ok ? currentTextResult.text : null,
    editable: isEditableProjectionAsset(asset.projectionPath, meta) && projectionPayload.bodyEncoding === "utf8",
    projectionPayload
  };
}

async function requireProjectionFile(
  rootPath: string,
  relativePath: string
): Promise<ResolvedProjectionFile> {
  const resolvedPath = resolveWithinRoot(rootPath, relativePath);
  if (!resolvedPath) {
    throw new Error(`Invalid fixture path: ${relativePath}. Paths must stay within the fixture root.`);
  }

  const details = await resolveProjectionFileDetails(rootPath, relativePath);
  if (!details) {
    throw createProjectionEditError(relativePath);
  }

  return details;
}

export async function resolveProjectionFile(
  rootPath: string,
  relativePath: string
): Promise<ProjectionFileInfo | null> {
  const details = await resolveProjectionFileDetails(rootPath, relativePath);
  if (!details) {
    return null;
  }

  return {
    path: details.path,
    canonicalPath: details.canonicalPath,
    metaPath: details.metaPath,
    currentText: details.currentText,
    editable: details.editable
  };
}

export async function writeProjectionFile(
  rootPath: string,
  relativePath: string,
  content: string
): Promise<ProjectionFileInfo> {
  const details = await requireProjectionFile(rootPath, relativePath);
  if (!details.editable) {
    throw new Error(`Projection file is not text-editable: ${relativePath}`);
  }

  await createFixtureRootFs(rootPath).writeText(details.path, content);
  return {
    path: details.path,
    canonicalPath: details.canonicalPath,
    metaPath: details.metaPath,
    currentText: content,
    editable: true
  };
}

export async function patchProjectionFile(
  rootPath: string,
  options: PatchProjectionFileOptions
): Promise<ProjectionFileInfo> {
  const details = await requireProjectionFile(rootPath, options.path);
  if (!details.editable) {
    throw new Error(`Projection file is not text-editable: ${options.path}`);
  }
  if (details.currentText === null) {
    throw new Error(`Projection file is missing or not currently readable as UTF-8 text: ${options.path}`);
  }

  const nextText = applyLinePatch(details.currentText, options);
  await createFixtureRootFs(rootPath).writeText(details.path, nextText);
  return {
    path: details.path,
    canonicalPath: details.canonicalPath,
    metaPath: details.metaPath,
    currentText: nextText,
    editable: true
  };
}

export async function restoreProjectionFile(
  rootPath: string,
  relativePath: string
): Promise<ProjectionFileInfo> {
  const details = await requireProjectionFile(rootPath, relativePath);
  await createFixtureRootFs(rootPath).writeBody(details.path, details.projectionPayload);

  return {
    path: details.path,
    canonicalPath: details.canonicalPath,
    metaPath: details.metaPath,
    currentText: details.projectionPayload.bodyEncoding === "utf8"
      ? details.projectionPayload.body
      : null,
    editable: details.projectionPayload.bodyEncoding === "utf8"
  };
}
