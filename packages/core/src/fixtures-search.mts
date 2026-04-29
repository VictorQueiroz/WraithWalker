import { createReadStream } from "node:fs";
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
  type SearchableFixtureEntry
} from "./fixtures-shared.mjs";
import type {
  DiscoveryResult,
  SearchContentMatch,
  SearchContentOptions
} from "./fixtures-types.mjs";
import { createFixtureRootFs } from "./root-fs.mjs";

const SEARCH_STREAM_CHUNK_BYTES = 64 * 1024;
const SEARCH_EXCERPT_RADIUS = 60;

function createExcerpt(
  text: string,
  matchIndex: number,
  queryLength: number
): string {
  const contextRadius = 60;
  const start = Math.max(0, matchIndex - contextRadius);
  const end = Math.min(text.length, matchIndex + queryLength + contextRadius);
  const excerpt = text.slice(start, end).replace(/\s+/g, " ").trim();

  return `${start > 0 ? "..." : ""}${excerpt}${end < text.length ? "..." : ""}`;
}

function findSubstringMatch(
  text: string,
  query: string
): Omit<
  SearchContentMatch,
  | "path"
  | "sourceKind"
  | "matchKind"
  | "origin"
  | "pathname"
  | "mimeType"
  | "resourceType"
  | "editable"
  | "canonicalPath"
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

function appendExcerpt(
  leadingText: string,
  matchText: string,
  trailingText: string,
  hasLeadingOverflow: boolean,
  hasTrailingOverflow: boolean
): string {
  const excerpt = `${leadingText}${matchText}${trailingText}`
    .replace(/\s+/g, " ")
    .trim();

  return `${hasLeadingOverflow ? "..." : ""}${excerpt}${
    hasTrailingOverflow ? "..." : ""
  }`;
}

function advanceSearchLocation(
  char: string,
  state: {
    line: number;
    column: number;
    previousWasCr: boolean;
  }
): void {
  if (char === "\r") {
    state.line += 1;
    state.column = 1;
    state.previousWasCr = true;
    return;
  }

  if (char === "\n") {
    if (state.previousWasCr) {
      state.previousWasCr = false;
      return;
    }

    state.line += 1;
    state.column = 1;
    return;
  }

  state.previousWasCr = false;
  state.column += 1;
}

function advanceSearchLocationByText(
  start: { line: number; column: number },
  text: string
): { line: number; column: number } {
  const state = {
    line: start.line,
    column: start.column,
    previousWasCr: false
  };

  for (const char of text) {
    advanceSearchLocation(char, state);
  }

  return {
    line: state.line,
    column: state.column
  };
}

function locationAtSearchIndex(
  start: { line: number; column: number },
  text: string,
  index: number
): { line: number; column: number } {
  return advanceSearchLocationByText(start, text.slice(0, Math.max(0, index)));
}

async function findStreamingSubstringMatch(
  rootPath: string,
  relativePath: string,
  query: string
): Promise<Omit<
  SearchContentMatch,
  | "path"
  | "sourceKind"
  | "matchKind"
  | "origin"
  | "pathname"
  | "mimeType"
  | "resourceType"
  | "editable"
  | "canonicalPath"
> | null> {
  const rootFs = createFixtureRootFs(rootPath);
  const absolutePath = rootFs.resolve(relativePath);
  if (!absolutePath) {
    return null;
  }

  const lowerQuery = query.toLowerCase();
  const queryLength = [...lowerQuery].length;
  if (queryLength === 0) {
    return null;
  }

  const overlapChars = Math.max(queryLength - 1, SEARCH_EXCERPT_RADIUS);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const stream = createReadStream(absolutePath, {
    highWaterMark: SEARCH_STREAM_CHUNK_BYTES
  });
  let carry = "";
  let carryStartAbsolute = 0;
  let carryStartLocation = { line: 1, column: 1 };
  let matchCount = 0;
  let nextAllowedStart = 0;
  let trailingCollectedUntil = 0;
  let firstMatch: {
    start: number;
    end: number;
    line: number;
    column: number;
    leadingText: string;
    matchText: string;
  } | null = null;

  const collectTrailing = (combined: string): string => {
    if (!firstMatch) {
      return "";
    }

    const remaining = SEARCH_EXCERPT_RADIUS - trailingChars.length;
    if (remaining <= 0) {
      return "";
    }

    const combinedEnd = carryStartAbsolute + combined.length;
    const startAbsolute = Math.max(firstMatch.end, trailingCollectedUntil);
    if (startAbsolute >= combinedEnd) {
      return "";
    }

    const startIndex = Math.max(0, startAbsolute - carryStartAbsolute);
    const trailing = combined.slice(startIndex, startIndex + remaining);
    trailingCollectedUntil = carryStartAbsolute + startIndex + trailing.length;
    return trailing;
  };

  const trailingChars: string[] = [];

  const processText = (text: string, final = false): void => {
    const combined = `${carry}${text}`;
    const lowerCombined = combined.toLowerCase();
    const processUntil = final
      ? combined.length
      : Math.max(0, combined.length - overlapChars);

    let searchIndex = 0;
    while (searchIndex < processUntil) {
      const matchIndex = lowerCombined.indexOf(lowerQuery, searchIndex);
      if (matchIndex === -1 || matchIndex >= processUntil) {
        break;
      }

      const absoluteMatchIndex = carryStartAbsolute + matchIndex;
      if (absoluteMatchIndex >= nextAllowedStart) {
        matchCount += 1;
        nextAllowedStart = absoluteMatchIndex + queryLength;

        if (!firstMatch) {
          const loc = locationAtSearchIndex(
            carryStartLocation,
            combined,
            matchIndex
          );
          firstMatch = {
            start: absoluteMatchIndex,
            end: absoluteMatchIndex + queryLength,
            line: loc.line,
            column: loc.column,
            leadingText: combined.slice(
              Math.max(0, matchIndex - SEARCH_EXCERPT_RADIUS),
              matchIndex
            ),
            matchText: combined.slice(matchIndex, matchIndex + queryLength)
          };
          trailingCollectedUntil = firstMatch.end;
        }
      }

      searchIndex = matchIndex + queryLength;
    }

    const trailing = collectTrailing(combined);
    if (trailing) {
      trailingChars.push(trailing);
    }

    carryStartAbsolute += processUntil;
    carryStartLocation = advanceSearchLocationByText(
      carryStartLocation,
      combined.slice(0, processUntil)
    );
    carry = combined.slice(processUntil);
  };

  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buffer.includes(0)) {
        return null;
      }
      processText(decoder.decode(buffer, { stream: true }));
    }
    processText(decoder.decode(), true);
  } catch {
    stream.destroy();
    return null;
  }

  if (!firstMatch) {
    return null;
  }

  return {
    excerpt: appendExcerpt(
      firstMatch.leadingText,
      firstMatch.matchText,
      trailingChars.join(""),
      firstMatch.start > firstMatch.leadingText.length,
      firstMatch.end + trailingChars.join("").length <
        carryStartAbsolute + carry.length
    ),
    matchCount,
    matchLine: firstMatch.line,
    matchColumn: firstMatch.column
  };
}

function findPathMatch(
  entry: SearchableFixtureEntry,
  query: string
): Omit<
  SearchContentMatch,
  | "path"
  | "sourceKind"
  | "matchKind"
  | "origin"
  | "pathname"
  | "mimeType"
  | "resourceType"
  | "editable"
  | "canonicalPath"
> | null {
  const candidates = [entry.pathname, entry.path].filter(
    (candidate): candidate is string => Boolean(candidate)
  );

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

async function listAllFiles(
  rootPath: string,
  relativeDir = ""
): Promise<string[]> {
  const rootFs = createFixtureRootFs(rootPath);
  const entries = await rootFs.listOptionalDirectory(relativeDir);
  const files: string[] = [];

  for (const entry of [...entries].sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const relativePath = relativeDir
      ? path.join(relativeDir, entry.name)
      : entry.name;

    if (entry.kind === "directory") {
      if (
        normalizeSearchPath(relativePath) === normalizeSearchPath(SCENARIOS_DIR)
      ) {
        continue;
      }
      files.push(...(await listAllFiles(rootPath, relativePath)));
      continue;
    }

    files.push(relativePath);
  }

  return files;
}

async function buildSearchableFixtureEntries(
  rootPath: string
): Promise<SearchableFixtureEntry[]> {
  const entries = new Map<string, SearchableFixtureEntry>();
  const configs = [...(await readSiteConfigs(rootPath))].sort((a, b) =>
    a.origin.localeCompare(b.origin)
  );

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

    for (const endpoint of [...info.apiEndpoints].sort((a, b) =>
      a.bodyPath.localeCompare(b.bodyPath)
    )) {
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
  const matchedOriginSet = new Set(
    matchedConfigs.map((config) => config.origin)
  );
  const normalizedPathContains = options.pathContains?.toLowerCase();
  const searchableEntries = (
    await buildSearchableFixtureEntries(rootPath)
  ).filter((entry) => {
    if (
      options.origin &&
      (!entry.origin || !matchedOriginSet.has(entry.origin))
    ) {
      return false;
    }
    if (
      normalizedPathContains &&
      !entry.path.toLowerCase().includes(normalizedPathContains)
    ) {
      return false;
    }
    if (
      options.mimeTypes?.length &&
      (!entry.mimeType || !options.mimeTypes.includes(entry.mimeType))
    ) {
      return false;
    }
    if (
      options.resourceTypes?.length &&
      (!entry.resourceType ||
        !options.resourceTypes.includes(entry.resourceType))
    ) {
      return false;
    }

    return true;
  });

  const matches: SearchContentMatch[] = [];
  const rootFs = createFixtureRootFs(rootPath);

  for (const entry of searchableEntries) {
    const stat = await rootFs.stat(entry.path);
    if (stat?.isFile()) {
      const match = await findStreamingSubstringMatch(
        rootPath,
        entry.path,
        query
      );
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
    ...paginateItems(
      matches,
      normalizeLimit(options.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT),
      options.cursor
    ),
    matchedOrigins: options.origin
      ? uniqueOrigins(matchedConfigs.map((config) => config.origin))
      : uniqueOrigins(matches.map((match) => match.origin))
  };
}
