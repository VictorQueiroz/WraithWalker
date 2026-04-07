const EXTENSION_PROTOCOLS = new Set([
  "chrome-extension:",
  "moz-extension:",
  "safari-web-extension:"
]);

const DEFAULT_ALLOWED_HEADERS = "content-type, trpc-accept, x-trpc-source";

export function isAllowedLocalServerOrigin(origin: string | undefined): boolean {
  if (!origin?.trim()) {
    return false;
  }

  try {
    return EXTENSION_PROTOCOLS.has(new URL(origin).protocol);
  } catch {
    return false;
  }
}

export function buildLocalServerCorsHeaders({
  origin,
  requestedHeaders,
  requestedPrivateNetwork
}: {
  origin?: string;
  requestedHeaders?: string;
  requestedPrivateNetwork?: string;
}): Record<string, string> | null {
  if (!isAllowedLocalServerOrigin(origin)) {
    return null;
  }

  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origin!,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": requestedHeaders?.trim() || DEFAULT_ALLOWED_HEADERS,
    "Access-Control-Max-Age": "600",
    Vary: "Origin"
  };

  if (requestedPrivateNetwork?.trim().toLowerCase() === "true") {
    headers["Access-Control-Allow-Private-Network"] = "true";
  }

  return headers;
}

export function appendVaryHeader(
  existing: string | number | string[] | undefined,
  value: string
): string {
  const parts = new Set(
    (Array.isArray(existing) ? existing.join(",") : String(existing || ""))
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  parts.add(value);
  return [...parts].join(", ");
}
