import type { AssetLikeRequestInput } from "./types.js";

const SAFE_SEGMENT_REGEX = /[^a-zA-Z0-9._-]+/g;
const SIMPLE_MIME_BY_EXTENSION = new Map<string, string>([
  ["css", "text/css"],
  ["gif", "image/gif"],
  ["html", "text/html"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["js", "application/javascript"],
  ["jsx", "application/javascript"],
  ["json", "application/json"],
  ["mjs", "application/javascript"],
  ["otf", "font/otf"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["ts", "text/plain"],
  ["tsx", "application/javascript"],
  ["txt", "text/plain"],
  ["wasm", "application/wasm"],
  ["woff", "font/woff"],
  ["woff2", "font/woff2"],
  ["xml", "application/xml"]
]);

export function normalizeSiteInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Origin is required.");
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(candidate);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https origins are supported.");
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

export function originToPermissionPattern(origin: string): string {
  const url = new URL(origin);
  return `${url.origin}/*`;
}

export function originToKey(origin: string): string {
  const url = new URL(origin);
  const protocol = url.protocol.replace(":", "");
  const port = url.port ? `__${url.port}` : "";
  return `${protocol}__${sanitizeSegment(url.hostname)}${port}`;
}

export function sanitizeSegment(value: string): string {
  return (
    String(value)
      .trim()
      .replace(SAFE_SEGMENT_REGEX, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "root"
  );
}

export function splitPathSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => sanitizeSegment(decodeURIComponent(segment)));
}

export function getRequestHostKey(url: string): string {
  const requestUrl = new URL(url);
  const isDefaultPort =
    !requestUrl.port ||
    (requestUrl.protocol === "http:" && requestUrl.port === "80") ||
    (requestUrl.protocol === "https:" && requestUrl.port === "443");

  return isDefaultPort
    ? requestUrl.hostname
    : `${requestUrl.hostname}__${requestUrl.port}`;
}

export function splitSimpleModePath(pathname: string): string[] {
  const pathSegments = splitPathSegments(pathname);
  if (!pathSegments.length || pathname.endsWith("/")) {
    return [...pathSegments, "index"];
  }

  return pathSegments;
}

export function getFileNameParts(fileName: string): { stem: string; extension: string } {
  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
    return { stem: fileName, extension: "" };
  }
  return {
    stem: fileName.slice(0, lastDotIndex),
    extension: fileName.slice(lastDotIndex + 1)
  };
}

export function appendHashToFileName(fileName: string, hashLabel: string): string {
  const { stem, extension } = getFileNameParts(fileName);
  return extension ? `${stem}${hashLabel}.${extension}` : `${stem}${hashLabel}`;
}

export function isAssetLikeRequest({
  method,
  url,
  resourceType = "",
  mimeType = ""
}: AssetLikeRequestInput): boolean {
  if (method.toUpperCase() !== "GET") {
    return false;
  }

  const path = new URL(url).pathname;
  const lowerPath = path.toLowerCase();
  const lowerType = resourceType.toLowerCase();
  const lowerMime = mimeType.toLowerCase();

  if (/\.[a-z0-9]{1,8}$/i.test(lowerPath)) {
    return true;
  }

  return [
    "script",
    "stylesheet",
    "image",
    "font",
    "media"
  ].includes(lowerType) || [
    "application/javascript",
    "text/javascript",
    "text/css",
    "font/",
    "image/",
    "audio/",
    "video/"
  ].some((prefix) => lowerMime.startsWith(prefix));
}

export function deriveExtensionFromMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  const directMatches = new Map<string, string>([
    ["application/json", "json"],
    ["application/javascript", "js"],
    ["text/javascript", "js"],
    ["text/css", "css"],
    ["text/html", "html"],
    ["text/plain", "txt"],
    ["text/xml", "xml"],
    ["application/xml", "xml"],
    ["application/wasm", "wasm"],
    ["font/ttf", "ttf"],
    ["font/otf", "otf"],
    ["font/woff", "woff"],
    ["font/woff2", "woff2"],
    ["image/svg+xml", "svg"],
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"]
  ]);

  if (directMatches.has(normalized)) {
    return directMatches.get(normalized)!;
  }

  const [type, subtype = ""] = normalized.split("/");
  if (!type || !subtype) {
    return "body";
  }

  if (subtype.includes("+json")) {
    return "json";
  }

  if (subtype.includes("+xml")) {
    return "xml";
  }

  if (["image", "audio", "video", "font", "text"].includes(type)) {
    return sanitizeSegment(subtype);
  }

  return "body";
}

export function deriveMimeTypeFromPathname(pathname: string): string {
  const pathSegments = splitSimpleModePath(pathname);
  const fileName = pathSegments[pathSegments.length - 1] || "index";
  const { extension } = getFileNameParts(fileName);
  return SIMPLE_MIME_BY_EXTENSION.get(extension.toLowerCase()) || "application/octet-stream";
}
