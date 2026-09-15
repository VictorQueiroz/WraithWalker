import * as prettier from "prettier";

export interface PrettifyFixtureTextOptions {
  relativePath: string;
  text: string;
  mimeType?: string | null;
  resourceType?: string | null;
}

const JAVASCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs"]);

const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx"]);

const JSON_EXTENSIONS = new Set([".json"]);

const HTML_EXTENSIONS = new Set([".htm", ".html"]);

const CSS_EXTENSIONS = new Set([".css"]);

const SOURCE_MAP_BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const SUPPORTED_EXTENSIONS = new Set([
  ...JAVASCRIPT_EXTENSIONS,
  ...TYPESCRIPT_EXTENSIONS,
  ...JSON_EXTENSIONS,
  ...HTML_EXTENSIONS,
  ...CSS_EXTENSIONS
]);

export interface FixtureBodyPayload {
  body: string;
  bodyEncoding: "utf8" | "base64";
}

export interface ProjectionBodyPayloadOptions {
  relativePath: string;
  payload: FixtureBodyPayload;
  mimeType?: string | null;
  resourceType?: string | null;
  canonicalBodyPath?: string | null;
}

export interface ProjectionSourceMap {
  version: 3;
  file: string;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
  x_wraithwalker: {
    kind: "projection-to-canonical";
    canonicalBodyPath: string;
    originalSourceMappingURL: string | null;
  };
}

export interface ProjectedFixtureArtifacts {
  payload: FixtureBodyPayload;
  sourceMapPath: string | null;
  sourceMap: ProjectionSourceMap | null;
}

function extname(relativePath: string): string {
  const lastSlashIndex = Math.max(
    relativePath.lastIndexOf("/"),
    relativePath.lastIndexOf("\\")
  );
  const baseName =
    lastSlashIndex >= 0 ? relativePath.slice(lastSlashIndex + 1) : relativePath;
  const lastDotIndex = baseName.lastIndexOf(".");
  return lastDotIndex > 0 ? baseName.slice(lastDotIndex).toLowerCase() : "";
}

function normalizeMimeType(value?: string | null): string {
  return (value || "").split(";")[0]?.trim().toLowerCase() || "";
}

function normalizeResourceType(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

function extensionFromMimeType(mimeType: string): string | null {
  if (!mimeType) {
    return null;
  }

  if (mimeType === "text/css") {
    return ".css";
  }

  if (mimeType === "text/html" || mimeType === "application/xhtml+xml") {
    return ".html";
  }

  if (mimeType === "application/typescript" || mimeType === "text/typescript") {
    return ".ts";
  }

  if (
    mimeType === "application/javascript" ||
    mimeType === "text/javascript" ||
    mimeType === "application/ecmascript" ||
    mimeType === "text/ecmascript"
  ) {
    return ".js";
  }

  if (mimeType === "application/json" || mimeType.endsWith("+json")) {
    return ".json";
  }

  return null;
}

function extensionFromResourceType(resourceType: string): string | null {
  switch (resourceType) {
    case "document":
      return ".html";
    case "stylesheet":
      return ".css";
    case "script":
      return ".js";
    default:
      return null;
  }
}

function extensionFromPath(relativePath: string): string | null {
  const extension = extname(relativePath);
  return SUPPORTED_EXTENSIONS.has(extension) ? extension : null;
}

function extensionFromHeuristics(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return ".json";
    } catch {
      return null;
    }
  }

  if (
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    (/^<[a-z!][^>]*>/i.test(trimmed) && trimmed.includes("</"))
  ) {
    return ".html";
  }

  return null;
}

function resolvePrettyExtension(
  options: PrettifyFixtureTextOptions
): string | null {
  const mimeType = normalizeMimeType(options.mimeType);
  const resourceType = normalizeResourceType(options.resourceType);

  return (
    extensionFromMimeType(mimeType) ||
    extensionFromResourceType(resourceType) ||
    extensionFromPath(options.relativePath) ||
    extensionFromHeuristics(options.text)
  );
}

function applyPrettyExtension(relativePath: string, extension: string): string {
  const existingExtension = extname(relativePath);
  if (existingExtension.toLowerCase() === extension) {
    return relativePath;
  }

  if (existingExtension) {
    return `${relativePath.slice(0, -existingExtension.length)}${extension}`;
  }

  return `${relativePath}${extension}`;
}

function stripTrailingNewline(text: string): string {
  return text.replace(/\n$/, "");
}

function basename(relativePath: string): string {
  return relativePath.split(/[\\/]/).pop() || relativePath;
}

function dirname(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const lastSlashIndex = normalized.lastIndexOf("/");
  return lastSlashIndex >= 0 ? normalized.slice(0, lastSlashIndex) : "";
}

function splitPath(relativePath: string): string[] {
  return relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

function createRelativeSourcePath(
  sourceMapPath: string,
  sourcePath: string,
): string {
  const fromParts = splitPath(dirname(sourceMapPath));
  const toParts = splitPath(sourcePath);
  let commonLength = 0;

  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength += 1;
  }

  const upParts = Array.from(
    { length: fromParts.length - commonLength },
    () => "..",
  );
  return [...upParts, ...toParts.slice(commonLength)].join("/") || ".";
}

function isJavaScriptProjectionFilepath(filepath: string): boolean {
  const extension = extname(filepath);
  return JAVASCRIPT_EXTENSIONS.has(extension);
}

function detectSourceMappingURL(text: string): string | null {
  const lines = text.split(/\r\n|\n|\r/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = /[#@]\s*sourceMappingURL=([^\s*]+)/.exec(lines[index] ?? "");
    if (match) {
      return match[1] || null;
    }
  }

  return null;
}

function stripSourceMappingURL(text: string): string {
  return text
    .replace(
      /(?:\r?\n)?\/\/[#@]\s*sourceMappingURL=[^\r\n]*(?=\r?\n?$)/,
      "",
    )
    .replace(
      /(?:\r?\n)?\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\/(?=\r?\n?$)/,
      "",
    );
}

function countLines(text: string): number {
  return Math.max(1, text.split(/\r\n|\n|\r/).length);
}

function encodeVlq(value: number): string {
  let encoded = "";
  let vlq = value < 0 ? -value * 2 + 1 : value * 2;

  do {
    let digit = vlq % 32;
    vlq = Math.floor(vlq / 32);
    if (vlq > 0) {
      digit += 32;
    }
    encoded += SOURCE_MAP_BASE64_CHARS[digit] ?? "";
  } while (vlq > 0);

  return encoded;
}

function encodeVlqSegment(values: number[]): string {
  return values.map((value) => encodeVlq(value)).join("");
}

function createLineMappings({
  generatedLineCount,
  originalLineCount,
}: {
  generatedLineCount: number;
  originalLineCount: number;
}): string {
  let previousOriginalLine = 0;
  const lastOriginalLine = Math.max(0, originalLineCount - 1);

  return Array.from({ length: Math.max(1, generatedLineCount) }, (_, index) => {
    const originalLine = Math.min(index, lastOriginalLine);
    const segment = encodeVlqSegment([
      0,
      0,
      originalLine - previousOriginalLine,
      0,
    ]);
    previousOriginalLine = originalLine;
    return segment;
  }).join(";");
}

function appendProjectionSourceMapComment(
  text: string,
  sourceMapPath: string,
): string {
  return `${text}\n//# sourceMappingURL=${basename(sourceMapPath)}`;
}

function createProjectionSourceMap({
  canonicalBodyPath,
  originalSourceMappingURL,
  originalText,
  projectedText,
  relativePath,
  sourceMapPath,
  sourceText,
}: {
  canonicalBodyPath: string;
  originalSourceMappingURL: string | null;
  originalText: string;
  projectedText: string;
  relativePath: string;
  sourceMapPath: string;
  sourceText: string;
}): ProjectionSourceMap {
  return {
    version: 3,
    file: relativePath,
    sources: [createRelativeSourcePath(sourceMapPath, canonicalBodyPath)],
    sourcesContent: [originalText],
    names: [],
    mappings: createLineMappings({
      generatedLineCount: countLines(projectedText),
      originalLineCount: countLines(sourceText),
    }),
    x_wraithwalker: {
      kind: "projection-to-canonical",
      canonicalBodyPath,
      originalSourceMappingURL,
    },
  };
}

export function inferPrettyFilepath(
  options: PrettifyFixtureTextOptions
): string | null {
  const extension = resolvePrettyExtension(options);
  return extension
    ? applyPrettyExtension(options.relativePath, extension)
    : null;
}

export async function prettifyFixtureText(
  options: PrettifyFixtureTextOptions
): Promise<string> {
  const filepath = inferPrettyFilepath(options);
  if (!filepath) {
    return options.text;
  }

  try {
    return stripTrailingNewline(
      await prettier.format(options.text, { filepath })
    );
  } catch {
    return options.text;
  }
}

function decodeBase64(value: string): Uint8Array {
  if (typeof atob === "function") {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  }

  return Uint8Array.from(Buffer.from(value, "base64"));
}

export function decodeFixtureBodyText(
  payload: FixtureBodyPayload
): string | null {
  if (payload.bodyEncoding === "utf8") {
    return payload.body;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      decodeBase64(payload.body)
    );
  } catch {
    return null;
  }
}

export async function createProjectedFixtureArtifacts(
  options: ProjectionBodyPayloadOptions
): Promise<ProjectedFixtureArtifacts> {
  const text = decodeFixtureBodyText(options.payload);
  if (text === null) {
    return {
      payload: options.payload,
      sourceMapPath: null,
      sourceMap: null
    };
  }

  const filepath = inferPrettyFilepath({
    relativePath: options.relativePath,
    text,
    mimeType: options.mimeType,
    resourceType: options.resourceType
  });
  if (!filepath) {
    return {
      payload: options.payload,
      sourceMapPath: null,
      sourceMap: null
    };
  }

  const isJavaScriptProjection = isJavaScriptProjectionFilepath(filepath);
  const sourceText = isJavaScriptProjection ? stripSourceMappingURL(text) : text;
  const projectedText = await prettifyFixtureText({
    relativePath: options.relativePath,
    text: sourceText,
    mimeType: options.mimeType,
    resourceType: options.resourceType
  });
  const sourceMapPath =
    isJavaScriptProjection && options.canonicalBodyPath
      ? `${options.relativePath}.__wraithwalker-original.map`
      : null;

  if (!sourceMapPath || projectedText === text) {
    return {
      payload: {
        body: projectedText,
        bodyEncoding: "utf8"
      },
      sourceMapPath: null,
      sourceMap: null
    };
  }

  const body = appendProjectionSourceMapComment(projectedText, sourceMapPath);
  return {
    payload: {
      body,
      bodyEncoding: "utf8"
    },
    sourceMapPath,
    sourceMap: createProjectionSourceMap({
      canonicalBodyPath: options.canonicalBodyPath,
      originalSourceMappingURL: detectSourceMappingURL(text),
      originalText: text,
      projectedText: body,
      relativePath: options.relativePath,
      sourceMapPath,
      sourceText,
    }),
  };
}

export async function createProjectedFixturePayload(
  options: ProjectionBodyPayloadOptions
): Promise<FixtureBodyPayload> {
  return (await createProjectedFixtureArtifacts(options)).payload;
}
