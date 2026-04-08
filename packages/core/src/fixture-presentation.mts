import * as prettier from "prettier";

export interface PrettifyFixtureTextOptions {
  relativePath: string;
  text: string;
  mimeType?: string | null;
  resourceType?: string | null;
}

const JAVASCRIPT_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs"
]);

const TYPESCRIPT_EXTENSIONS = new Set([
  ".ts",
  ".tsx"
]);

const JSON_EXTENSIONS = new Set([
  ".json"
]);

const HTML_EXTENSIONS = new Set([
  ".htm",
  ".html"
]);

const CSS_EXTENSIONS = new Set([
  ".css"
]);

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
}

function extname(relativePath: string): string {
  const lastSlashIndex = Math.max(relativePath.lastIndexOf("/"), relativePath.lastIndexOf("\\"));
  const baseName = lastSlashIndex >= 0 ? relativePath.slice(lastSlashIndex + 1) : relativePath;
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

  if (mimeType === "application/javascript"
    || mimeType === "text/javascript"
    || mimeType === "application/ecmascript"
    || mimeType === "text/ecmascript") {
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

  if (trimmed.startsWith("<!doctype html")
    || trimmed.startsWith("<html")
    || (/^<[a-z!][^>]*>/i.test(trimmed) && trimmed.includes("</"))) {
    return ".html";
  }

  return null;
}

function resolvePrettyExtension(options: PrettifyFixtureTextOptions): string | null {
  const mimeType = normalizeMimeType(options.mimeType);
  const resourceType = normalizeResourceType(options.resourceType);

  return extensionFromMimeType(mimeType)
    || extensionFromResourceType(resourceType)
    || extensionFromPath(options.relativePath)
    || extensionFromHeuristics(options.text);
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

export function inferPrettyFilepath(options: PrettifyFixtureTextOptions): string | null {
  const extension = resolvePrettyExtension(options);
  return extension
    ? applyPrettyExtension(options.relativePath, extension)
    : null;
}

export async function prettifyFixtureText(options: PrettifyFixtureTextOptions): Promise<string> {
  const filepath = inferPrettyFilepath(options);
  if (!filepath) {
    return options.text;
  }

  try {
    return stripTrailingNewline(await prettier.format(options.text, { filepath }));
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

export function decodeFixtureBodyText(payload: FixtureBodyPayload): string | null {
  if (payload.bodyEncoding === "utf8") {
    return payload.body;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64(payload.body));
  } catch {
    return null;
  }
}

export async function createProjectedFixturePayload(
  options: ProjectionBodyPayloadOptions
): Promise<FixtureBodyPayload> {
  const text = decodeFixtureBodyText(options.payload);
  if (text === null) {
    return options.payload;
  }

  const projectedText = await prettifyFixtureText({
    relativePath: options.relativePath,
    text,
    mimeType: options.mimeType,
    resourceType: options.resourceType
  });

  return {
    body: projectedText,
    bodyEncoding: "utf8"
  };
}
