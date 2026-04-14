import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { createFixtureRootFs } from "@wraithwalker/core/root-fs";

import {
  flattenStaticResourceManifest,
  readOriginInfo,
  readSiteConfigs,
  resolveProjectionFile
} from "./fixture-reader.mjs";

const AGENT_WORKSPACES_DIR = ".wraithwalker/agent-workspaces";
const WORKSPACE_MANIFEST_FILENAME = "workspace.json";
const WORKSPACE_FILES_DIRNAME = "files";

export interface ProjectionWorkspaceSelection {
  paths?: string[];
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

interface ProjectionWorkspaceTrackedFile {
  path: string;
  baselineHash: string;
}

interface ProjectionWorkspaceManifest {
  schemaVersion: 1;
  workspaceId: string;
  createdAt: string;
  selection: {
    paths: string[];
    includeGlobs: string[];
    excludeGlobs: string[];
  };
  trackedFiles: ProjectionWorkspaceTrackedFile[];
}

interface ProjectionWorkspaceContext {
  manifest: ProjectionWorkspaceManifest;
  workspaceRelativePath: string;
  filesRelativePath: string;
  workspacePath: string;
}

interface PushWorkspaceResult {
  workspaceId: string;
  workspacePath: string;
  updatedFiles: string[];
  unchangedFiles: string[];
  conflictingFiles: string[];
  ignoredNewFiles: string[];
  ignoredDeletedFiles: string[];
  summary: string;
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function normalizeSelectorValues(values?: string[]): string[] {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map(normalizeRelativePath)
    )
  ].sort();
}

function workspaceRelativePath(workspaceId: string): string {
  return path.posix.join(AGENT_WORKSPACES_DIR, workspaceId);
}

function workspaceManifestRelativePath(workspaceId: string): string {
  return path.posix.join(
    workspaceRelativePath(workspaceId),
    WORKSPACE_MANIFEST_FILENAME
  );
}

function workspaceFilesRelativePath(workspaceId: string): string {
  return path.posix.join(
    workspaceRelativePath(workspaceId),
    WORKSPACE_FILES_DIRNAME
  );
}

function workspaceTrackedFileRelativePath(
  workspaceId: string,
  trackedPath: string
): string {
  return path.posix.join(
    workspaceFilesRelativePath(workspaceId),
    normalizeRelativePath(trackedPath)
  );
}

function assertValidWorkspaceId(workspaceId: string): void {
  if (!/^[A-Za-z0-9-]+$/.test(workspaceId)) {
    throw new Error(`Invalid projection workspace id: ${workspaceId}`);
  }
}

async function hashAbsoluteFile(filePath: string): Promise<string> {
  const contents = await fs.readFile(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

async function listAbsoluteFilesRecursively(
  directoryPath: string
): Promise<string[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listAbsoluteFilesRecursively(absolutePath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function collectProjectionPaths(rootPath: string): Promise<string[]> {
  const configs = await readSiteConfigs(rootPath);
  const paths = new Set<string>();

  for (const config of configs) {
    const info = await readOriginInfo(rootPath, config);
    for (const asset of flattenStaticResourceManifest(info.manifest)) {
      if (!asset.projectionPath) {
        continue;
      }

      const projection = await resolveProjectionFile(
        rootPath,
        asset.projectionPath
      );
      if (!projection) {
        continue;
      }

      paths.add(normalizeRelativePath(projection.path));
    }
  }

  return [...paths].sort();
}

async function requireProjectionPath(
  rootPath: string,
  relativePath: string
): Promise<string> {
  const normalizedPath = normalizeRelativePath(relativePath);

  if (path.isAbsolute(normalizedPath)) {
    throw new Error(
      `Invalid fixture path: ${relativePath}. Paths must stay within the fixture root.`
    );
  }

  if (
    normalizedPath === ".wraithwalker" ||
    normalizedPath.startsWith(".wraithwalker/")
  ) {
    throw new Error(
      `Hidden canonical files under .wraithwalker cannot be checked out into projection workspaces: ${relativePath}`
    );
  }

  const projection = await resolveProjectionFile(rootPath, normalizedPath);
  if (!projection) {
    throw new Error(
      `File is not a projection-backed captured asset: ${relativePath}`
    );
  }

  return normalizeRelativePath(projection.path);
}

function matchesAnyGlob(targetPath: string, globs: string[]): boolean {
  const normalizedTarget = normalizeRelativePath(targetPath);
  return globs.some((glob) =>
    path.posix.matchesGlob(normalizedTarget, normalizeRelativePath(glob))
  );
}

async function resolveWorkspaceSelection(
  rootPath: string,
  selection: ProjectionWorkspaceSelection
): Promise<ProjectionWorkspaceManifest["selection"] & { files: string[] }> {
  const normalizedPaths = normalizeSelectorValues(selection.paths);
  const includeGlobs = normalizeSelectorValues(selection.includeGlobs);
  const excludeGlobs = normalizeSelectorValues(selection.excludeGlobs);

  if (normalizedPaths.length === 0 && includeGlobs.length === 0) {
    throw new Error("At least one path or includeGlobs selector is required.");
  }

  const selected = new Set<string>();

  for (const candidatePath of normalizedPaths) {
    selected.add(await requireProjectionPath(rootPath, candidatePath));
  }

  if (includeGlobs.length > 0) {
    const projectionPaths = await collectProjectionPaths(rootPath);
    for (const projectionPath of projectionPaths) {
      if (matchesAnyGlob(projectionPath, includeGlobs)) {
        selected.add(projectionPath);
      }
    }
  }

  const files = [...selected]
    .filter((relativePath) => !matchesAnyGlob(relativePath, excludeGlobs))
    .sort();

  if (files.length === 0) {
    throw new Error(
      "No projection-backed files matched the workspace selectors."
    );
  }

  return {
    paths: normalizedPaths,
    includeGlobs,
    excludeGlobs,
    files
  };
}

async function loadWorkspaceContext(
  rootPath: string,
  workspaceId: string
): Promise<ProjectionWorkspaceContext> {
  assertValidWorkspaceId(workspaceId);

  const rootFs = createFixtureRootFs(rootPath);
  const manifestRelativePath = workspaceManifestRelativePath(workspaceId);
  const manifest =
    await rootFs.readOptionalJson<ProjectionWorkspaceManifest>(
      manifestRelativePath
    );

  if (!manifest) {
    throw new Error(`Projection workspace not found: ${workspaceId}`);
  }

  const filesRelativePath = workspaceFilesRelativePath(workspaceId);
  const workspacePath = rootFs.resolve(filesRelativePath);
  if (!workspacePath) {
    throw new Error(`Projection workspace is invalid: ${workspaceId}`);
  }

  return {
    manifest,
    workspaceRelativePath: workspaceRelativePath(workspaceId),
    filesRelativePath,
    workspacePath
  };
}

function buildPushSummary({
  updatedFiles,
  unchangedFiles,
  conflictingFiles,
  ignoredNewFiles,
  ignoredDeletedFiles
}: Omit<PushWorkspaceResult, "workspaceId" | "workspacePath" | "summary">) {
  return [
    `${updatedFiles.length} updated`,
    `${unchangedFiles.length} unchanged`,
    `${conflictingFiles.length} conflicting`,
    `${ignoredNewFiles.length} new ignored`,
    `${ignoredDeletedFiles.length} deleted ignored`
  ].join(", ");
}

export async function checkoutProjectionWorkspace(
  rootPath: string,
  selection: ProjectionWorkspaceSelection
) {
  const rootFs = createFixtureRootFs(rootPath);
  const resolvedSelection = await resolveWorkspaceSelection(
    rootPath,
    selection
  );
  const workspaceId = randomUUID();
  const filesRelativePath = workspaceFilesRelativePath(workspaceId);

  await rootFs.ensureDir(filesRelativePath);

  const trackedFiles: ProjectionWorkspaceTrackedFile[] = [];

  for (const relativePath of resolvedSelection.files) {
    await rootFs.copyRecursive(
      relativePath,
      workspaceTrackedFileRelativePath(workspaceId, relativePath)
    );

    const sourcePath = rootFs.resolve(relativePath);
    if (!sourcePath) {
      throw new Error(
        `Invalid fixture path: ${relativePath}. Paths must stay within the fixture root.`
      );
    }

    trackedFiles.push({
      path: relativePath,
      baselineHash: await hashAbsoluteFile(sourcePath)
    });
  }

  const manifest: ProjectionWorkspaceManifest = {
    schemaVersion: 1,
    workspaceId,
    createdAt: new Date().toISOString(),
    selection: {
      paths: resolvedSelection.paths,
      includeGlobs: resolvedSelection.includeGlobs,
      excludeGlobs: resolvedSelection.excludeGlobs
    },
    trackedFiles
  };

  await rootFs.writeJson(workspaceManifestRelativePath(workspaceId), manifest);

  const workspacePath = rootFs.resolve(filesRelativePath);
  if (!workspacePath) {
    throw new Error(`Projection workspace is invalid: ${workspaceId}`);
  }

  return {
    workspaceId,
    workspacePath,
    fileCount: trackedFiles.length,
    files: trackedFiles.map((trackedFile) => trackedFile.path),
    summary: `${trackedFiles.length} files copied to ${workspacePath}`
  };
}

export async function pushProjectionWorkspace(
  rootPath: string,
  workspaceId: string
): Promise<PushWorkspaceResult> {
  const rootFs = createFixtureRootFs(rootPath);
  const context = await loadWorkspaceContext(rootPath, workspaceId);
  const trackedFileMap = new Map(
    context.manifest.trackedFiles.map((trackedFile) => [
      trackedFile.path,
      trackedFile
    ])
  );

  const workspaceFilesAbsolute = rootFs.resolve(context.filesRelativePath);
  const workspaceFiles =
    workspaceFilesAbsolute && (await rootFs.exists(context.filesRelativePath))
      ? (await listAbsoluteFilesRecursively(workspaceFilesAbsolute))
          .map((absolutePath) =>
            normalizeRelativePath(
              path.relative(workspaceFilesAbsolute, absolutePath)
            )
          )
          .sort()
      : [];

  const ignoredNewFiles = workspaceFiles.filter(
    (relativePath) => !trackedFileMap.has(relativePath)
  );
  const updatedFiles: string[] = [];
  const unchangedFiles: string[] = [];
  const conflictingFiles: string[] = [];
  const ignoredDeletedFiles: string[] = [];

  for (const trackedFile of context.manifest.trackedFiles) {
    const workspaceTrackedRelativePath = workspaceTrackedFileRelativePath(
      workspaceId,
      trackedFile.path
    );
    const workspaceTrackedAbsolutePath = rootFs.resolve(
      workspaceTrackedRelativePath
    );
    if (!workspaceTrackedAbsolutePath) {
      ignoredDeletedFiles.push(trackedFile.path);
      continue;
    }

    const workspaceTrackedStat = await fs
      .lstat(workspaceTrackedAbsolutePath)
      .catch(() => null);
    if (!workspaceTrackedStat?.isFile()) {
      ignoredDeletedFiles.push(trackedFile.path);
      continue;
    }

    const workspaceHash = await hashAbsoluteFile(workspaceTrackedAbsolutePath);
    if (workspaceHash === trackedFile.baselineHash) {
      unchangedFiles.push(trackedFile.path);
      continue;
    }

    const rootAbsolutePath = rootFs.resolve(trackedFile.path);
    if (!rootAbsolutePath) {
      conflictingFiles.push(trackedFile.path);
      continue;
    }

    const rootStat = await fs.lstat(rootAbsolutePath).catch(() => null);
    if (!rootStat?.isFile()) {
      conflictingFiles.push(trackedFile.path);
      continue;
    }

    const rootHash = await hashAbsoluteFile(rootAbsolutePath);
    if (rootHash !== trackedFile.baselineHash) {
      conflictingFiles.push(trackedFile.path);
      continue;
    }

    await fs.mkdir(path.dirname(rootAbsolutePath), { recursive: true });
    await fs.copyFile(workspaceTrackedAbsolutePath, rootAbsolutePath);
    trackedFile.baselineHash = workspaceHash;
    updatedFiles.push(trackedFile.path);
  }

  await rootFs.writeJson(
    workspaceManifestRelativePath(workspaceId),
    context.manifest
  );

  return {
    workspaceId: context.manifest.workspaceId,
    workspacePath: context.workspacePath,
    updatedFiles,
    unchangedFiles,
    conflictingFiles,
    ignoredNewFiles,
    ignoredDeletedFiles,
    summary: buildPushSummary({
      updatedFiles,
      unchangedFiles,
      conflictingFiles,
      ignoredNewFiles,
      ignoredDeletedFiles
    })
  };
}

export async function discardProjectionWorkspace(
  rootPath: string,
  workspaceId: string
) {
  const rootFs = createFixtureRootFs(rootPath);
  const context = await loadWorkspaceContext(rootPath, workspaceId);

  await rootFs.remove(context.workspaceRelativePath, {
    recursive: true,
    force: true
  });

  return {
    workspaceId: context.manifest.workspaceId,
    workspacePath: context.workspacePath,
    fileCount: context.manifest.trackedFiles.length,
    removed: true,
    summary: `Removed projection workspace ${workspaceId} with ${context.manifest.trackedFiles.length} tracked files.`
  };
}
