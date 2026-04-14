const encoder = new TextEncoder();

export async function sha256Hex(value: string | BufferSource): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function shortHash(
  value: string | BufferSource,
  length = 12
): Promise<string> {
  const fullHash = await sha256Hex(value);
  return fullHash.slice(0, length);
}
