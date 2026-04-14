import path from "node:path";

import { getFixtureDisplayPath, type ResponseMeta } from "./fixture-layout.mjs";
import { prettifyFixtureText } from "./fixture-presentation.mjs";
import {
  createFixtureRootFs,
  resolveWithinRoot,
  type FixtureRootFs
} from "./root-fs.mjs";
import {
  flattenStaticResourceManifest,
  readOriginInfo,
  readSiteConfigs
} from "./fixtures-discovery.mjs";
import {
  DEFAULT_SNIPPET_LINE_COUNT,
  DEFAULT_SNIPPET_MAX_BYTES,
  MAX_FULL_READ_BYTES,
  MAX_SNIPPET_LINE_COUNT,
  MAX_SNIPPET_MAX_BYTES,
  normalizeLimit,
  readTextFixture,
  truncateUtf8,
  type FixturePresentationContext
} from "./fixtures-shared.mjs";
import type {
  ApiFixture,
  FixtureReadOptions,
  FixtureSnippet,
  FixtureSnippetOptions
} from "./fixtures-types.mjs";

async function assertWithinFullReadLimit(
  rootFs: FixtureRootFs,
  relativePath: string,
  createError: (byteLength: number, limit: number) => Error
): Promise<void> {
  const stat = await rootFs.stat(relativePath);
  if (!stat?.isFile()) {
    return;
  }

  if (stat.size > MAX_FULL_READ_BYTES) {
    throw createError(stat.size, MAX_FULL_READ_BYTES);
  }
}

async function findAssetPresentationContext(
  rootPath: string,
  relativePath: string
): Promise<FixturePresentationContext | null> {
  const configs = await readSiteConfigs(rootPath);

  for (const config of configs) {
    const info = await readOriginInfo(rootPath, config);
    for (const asset of flattenStaticResourceManifest(info.manifest)) {
      if (asset.bodyPath !== relativePath) {
        if (getFixtureDisplayPath(asset) !== relativePath) {
          continue;
        }
      }

      return {
        mimeType: asset.mimeType,
        resourceType: asset.resourceType
      };
    }
  }

  return null;
}

async function resolveFixturePresentationContext(
  rootPath: string,
  relativePath: string
): Promise<FixturePresentationContext | null> {
  if (path.basename(relativePath) === "response.body") {
    const metaPath = path.join(
      path.dirname(relativePath),
      "response.meta.json"
    );
    const meta =
      await createFixtureRootFs(rootPath).readOptionalJson<ResponseMeta>(
        metaPath
      );
    if (meta) {
      return {
        mimeType: meta.mimeType,
        resourceType: meta.resourceType
      };
    }
  }

  return findAssetPresentationContext(rootPath, relativePath);
}

async function maybePrettifyFixtureText(
  rootPath: string,
  relativePath: string,
  text: string,
  options: FixtureReadOptions,
  context?: FixturePresentationContext | null
): Promise<string> {
  if (!options.pretty) {
    return text;
  }

  const resolvedContext =
    context ??
    (await resolveFixturePresentationContext(rootPath, relativePath));
  return prettifyFixtureText({
    relativePath,
    text,
    mimeType: resolvedContext?.mimeType,
    resourceType: resolvedContext?.resourceType
  });
}

export function resolveFixturePath(
  rootPath: string,
  relativePath: string
): string | null {
  return resolveWithinRoot(rootPath, relativePath);
}

export async function readFixtureBody(
  rootPath: string,
  relativePath: string,
  options: FixtureReadOptions = {}
): Promise<string | null> {
  const rootFs = createFixtureRootFs(rootPath);
  await assertWithinFullReadLimit(
    rootFs,
    relativePath,
    (byteLength, limit) =>
      new Error(
        `File is too large to read in full: ${relativePath} (${byteLength} bytes; limit ${limit} bytes). ` +
          "Use read-file-snippet with this path and specify startLine and lineCount."
      )
  );
  const text = await rootFs.readOptionalText(relativePath);
  if (text === null) {
    return null;
  }

  return maybePrettifyFixtureText(rootPath, relativePath, text, options);
}

export async function readFixtureSnippet(
  rootPath: string,
  relativePath: string,
  options: FixtureSnippetOptions = {}
): Promise<FixtureSnippet> {
  const startLine = Math.max(1, Math.trunc(options.startLine ?? 1));
  const lineCount = normalizeLimit(
    options.lineCount,
    DEFAULT_SNIPPET_LINE_COUNT,
    MAX_SNIPPET_LINE_COUNT
  );
  const maxBytes = normalizeLimit(
    options.maxBytes,
    DEFAULT_SNIPPET_MAX_BYTES,
    MAX_SNIPPET_MAX_BYTES
  );
  const textFixture = await readTextFixture(rootPath, relativePath);

  if ("reason" in textFixture) {
    switch (textFixture.reason) {
      case "invalid-path":
        throw new Error(
          `Invalid fixture path: ${relativePath}. Paths must stay within the fixture root.`
        );
      case "missing":
        throw new Error(`File not found: ${relativePath}`);
      case "binary":
        throw new Error(`Fixture is not a text file: ${relativePath}`);
    }
  }

  const renderedText = await maybePrettifyFixtureText(
    rootPath,
    relativePath,
    textFixture.text,
    options
  );
  const allLines = renderedText.split(/\r\n|\n|\r/);
  const snippetLines = allLines.slice(startLine - 1, startLine - 1 + lineCount);
  const rawSnippet = snippetLines.join("\n");
  const truncatedSnippet = truncateUtf8(rawSnippet, maxBytes);
  const renderedLineCount =
    truncatedSnippet.text === ""
      ? 0
      : truncatedSnippet.text.split(/\r\n|\n|\r/).length;

  return {
    path: relativePath,
    startLine,
    endLine:
      renderedLineCount > 0 ? startLine + renderedLineCount - 1 : startLine - 1,
    truncated: truncatedSnippet.truncated,
    text: truncatedSnippet.text
  };
}

export async function readApiFixture(
  rootPath: string,
  fixtureDir: string,
  options: FixtureReadOptions = {}
): Promise<ApiFixture | null> {
  const rootFs = createFixtureRootFs(rootPath);
  const metaPath = path.join(fixtureDir, "response.meta.json");
  const bodyPath = path.join(fixtureDir, "response.body");

  if (!rootFs.resolve(metaPath) || !rootFs.resolve(bodyPath)) {
    return null;
  }

  const meta = await rootFs.readOptionalJson<ResponseMeta>(metaPath);
  if (!meta) {
    return null;
  }

  return {
    fixtureDir,
    metaPath,
    bodyPath,
    meta,
    body: await (async () => {
      await assertWithinFullReadLimit(
        rootFs,
        bodyPath,
        (byteLength, limit) =>
          new Error(
            `Endpoint fixture body is too large to read in full: ${bodyPath} (${byteLength} bytes; limit ${limit} bytes). ` +
              `Use read-file-snippet with path "${bodyPath}" and specify startLine and lineCount.`
          )
      );
      const body = await rootFs.readOptionalText(bodyPath);
      if (body === null) {
        return null;
      }

      return maybePrettifyFixtureText(rootPath, bodyPath, body, options, {
        mimeType: meta.mimeType,
        resourceType: meta.resourceType
      });
    })()
  };
}
