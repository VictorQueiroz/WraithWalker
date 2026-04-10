import path from "node:path";

import { SCENARIOS_DIR } from "./constants.mjs";
import { getFixtureDisplayPath } from "./fixture-layout.mjs";
import {
  flattenStaticResourceManifest,
  matchSiteConfigsByOrigin,
  readOriginInfo,
  readSiteConfigs,
  uniqueOrigins
} from "./fixtures-discovery.mjs";
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  guessMimeType,
  isEditableProjectionAsset,
  isExcludedSearchPath,
  normalizeLimit,
  normalizeSearchPath,
  paginateItems,
  readTextFixture,
  type SearchableFixtureEntry
} from "./fixtures-shared.mjs";
import type {
  DiscoveryResult,
  SearchContentMatch,
  SearchContentOptions
} from "./fixtures-types.mjs";
import { createFixtureRootFs } from "./root-fs.mjs";

function createExcerpt(text: string, matchIndex: number, queryLength: number): string {
  const contextRadius = 60;
  const start = Math.max(0, matchIndex - contextRadius);
  const end = Math.min(text.length, matchIndex + queryLength + contextRadius);
  const excerpt = text
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim();

  return `${start > 0 ? "..." : ""}${excerpt}${end < text.length ? "..." : ""}`;
}

function findSubstringMatch(
  text: string,
  query: string
): Omit<
  SearchContentMatch,
  "path" | "sourceKind" | "matchKind" | "origin" | "pathname" | "mimeType" | "resourceType" | "editable" | "canonicalPath"
> | null {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);
  if (matchIndex === -1) {
    return null;
  }

  let matchCount = 0;
  let searchIndex = 0;
  while (true) {
    const nextIndex = lowerText.indexOf(lowerQuery, searchIndex);
    if (nextIndex === -1) {
      break;
    }
    matchCount += 1;
    searchIndex = nextIndex + lowerQuery.length;
  }

  const leadingText = text.slice(0, matchIndex);
  const lines = leadingText.split(/\r\n|\n|\r/);
  const line = lines.length;
  const column = (lines.at(-1) ?? "").length + 1;

  return {
    excerpt: createExcerpt(text, matchIndex, query.length),
    matchCount,
    matchLine: line,
    matchColumn: column
  };
}

function findPathMatch(
  entry: SearchableFixtureEntry,
  query: string
): Omit<
  SearchContentMatch,
  "path" | "sourceKind" | "matchKind" | "origin" | "pathname" | "mimeType" | "resourceType" | "editable" | "canonicalPath"
> | null {
  const candidates = [entry.pathname, entry.path]
    .filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const match = findSubstringMatch(candidate, query);
    if (!match) {
      continue;
    }

    return {
      excerpt: `Matched path: ${candidate}`,
      matchCount: 1,
      matchLine: 1,
      matchColumn: match.matchColumn
    };
  }

  return null;
}

async function listAllFiles(rootPath: string, relativeDir = ""): Promise<string[]> {
  const rootFs = createFixtureRootFs(rootPath);
  const entries = await rootFs.listOptionalDirectory(relativeDir);
  const files: string[] = [];

  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = relativeDir
      ? path.join(relativeDir, entry.name)
      : entry.name;

    if (entry.kind === "directory") {
      if (normalizeSearchPath(relativePath) === normalizeSearchPath(SCENARIOS_DIR)) {
        continue;
      }
      files.push(...await listAllFiles(rootPath, relativePath));
      continue;
    }

    files.push(relativePath);
  }

  return files;
}

async function buildSearchableFixtureEntries(rootPath: string): Promise<SearchableFixtureEntry[]> {
  const entries = new Map<string, SearchableFixtureEntry>();
  const configs = [...await readSiteConfigs(rootPath)]
    .sort((a, b) => a.origin.localeCompare(b.origin));

  for (const config of configs) {
    const info = await readOriginInfo(rootPath, config);

    for (const asset of flattenStaticResourceManifest(info.manifest)) {
      const displayPath = getFixtureDisplayPath(asset);
      if (!entries.has(displayPath)) {
        entries.set(displayPath, {
          path: displayPath,
          sourceKind: "asset",
          origin: info.origin,
          pathname: asset.pathname,
          mimeType: asset.mimeType || null,
          resourceType: asset.resourceType || null,
          editable: isEditableProjectionAsset(asset.projectionPath, asset),
          canonicalPath: asset.bodyPath
        });
      }
    }

    for (const endpoint of [...info.apiEndpoints].sort((a, b) => a.bodyPath.localeCompare(b.bodyPath))) {
      if (!entries.has(endpoint.bodyPath)) {
        entries.set(endpoint.bodyPath, {
          path: endpoint.bodyPath,
          sourceKind: "endpoint",
          origin: info.origin,
          pathname: endpoint.pathname,
          mimeType: endpoint.mimeType || null,
          resourceType: endpoint.resourceType || null,
          editable: false,
          canonicalPath: null
        });
      }
    }
  }

  for (const relativePath of await listAllFiles(rootPath)) {
    if (isExcludedSearchPath(relativePath) || entries.has(relativePath)) {
      continue;
    }

    entries.set(relativePath, {
      path: relativePath,
      sourceKind: "file",
      origin: null,
      pathname: null,
      mimeType: guessMimeType(relativePath),
      resourceType: null,
      editable: false,
      canonicalPath: null
    });
  }

  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function searchFixtureContent(
  rootPath: string,
  options: SearchContentOptions
): Promise<DiscoveryResult<SearchContentMatch>> {
  const query = options.query.trim();
  if (!query) {
    return { items: [], nextCursor: null, totalMatched: 0, matchedOrigins: [] };
  }

  const configs = await readSiteConfigs(rootPath);
  const matchedConfigs = options.origin
    ? matchSiteConfigsByOrigin(configs, options.origin)
    : configs;
  const matchedOriginSet = new Set(matchedConfigs.map((config) => config.origin));
  const normalizedPathContains = options.pathContains?.toLowerCase();
  const searchableEntries = (await buildSearchableFixtureEntries(rootPath)).filter((entry) => {
    if (options.origin && (!entry.origin || !matchedOriginSet.has(entry.origin))) {
      return false;
    }
    if (normalizedPathContains && !entry.path.toLowerCase().includes(normalizedPathContains)) {
      return false;
    }
    if (options.mimeTypes?.length && (!entry.mimeType || !options.mimeTypes.includes(entry.mimeType))) {
      return false;
    }
    if (options.resourceTypes?.length && (!entry.resourceType || !options.resourceTypes.includes(entry.resourceType))) {
      return false;
    }

    return true;
  });

  const matches: SearchContentMatch[] = [];

  for (const entry of searchableEntries) {
    const result = await readTextFixture(rootPath, entry.path);
    if (result.ok) {
      const match = findSubstringMatch(result.text, query);
      if (match) {
        matches.push({
          path: entry.path,
          sourceKind: entry.sourceKind,
          matchKind: "body",
          matchCount: match.matchCount,
          origin: entry.origin,
          pathname: entry.pathname,
          mimeType: entry.mimeType,
          resourceType: entry.resourceType,
          excerpt: match.excerpt,
          matchLine: match.matchLine,
          matchColumn: match.matchColumn,
          editable: entry.editable,
          canonicalPath: entry.canonicalPath
        });
        continue;
      }
    }

    const pathMatch = findPathMatch(entry, query);
    if (!pathMatch) {
      continue;
    }

    matches.push({
      path: entry.path,
      sourceKind: entry.sourceKind,
      matchKind: "path",
      matchCount: pathMatch.matchCount,
      origin: entry.origin,
      pathname: entry.pathname,
      mimeType: entry.mimeType,
      resourceType: entry.resourceType,
      excerpt: pathMatch.excerpt,
      matchLine: pathMatch.matchLine,
      matchColumn: pathMatch.matchColumn,
      editable: entry.editable,
      canonicalPath: entry.canonicalPath
    });
  }

  return {
    ...paginateItems(matches, normalizeLimit(options.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT), options.cursor),
    matchedOrigins: options.origin
      ? uniqueOrigins(matchedConfigs.map((config) => config.origin))
      : uniqueOrigins(matches.map((match) => match.origin))
  };
}
