const TWO_LEVEL_SUFFIX_PREFIXES = new Set([
  "ac",
  "co",
  "com",
  "edu",
  "gov",
  "govt",
  "mil",
  "net",
  "org",
  "sch"
]);

const KNOWN_TWO_LEVEL_SUFFIXES = new Set([
  "com.br",
  "com.au",
  "com.mx",
  "com.cn",
  "com.tw",
  "com.sg",
  "com.hk",
  "com.ar",
  "com.tr",
  "co.uk",
  "co.jp",
  "co.kr",
  "co.in",
  "co.nz",
  "co.za",
  "co.il",
  "org.uk",
  "net.au",
  "ne.jp",
  "or.jp",
  "ac.uk",
  "gov.uk",
  "gov.br",
  "github.io",
  "gitlab.io",
  "pages.dev",
  "vercel.app",
  "netlify.app",
  "web.app",
  "firebaseapp.com",
  "azurewebsites.net",
  "cloudfront.net",
  "amazonaws.com",
  "herokuapp.com",
  "github.dev",
  "workers.dev",
  "repl.co"
]);

function isIpAddress(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return true;
  }

  return hostname.includes(":");
}

function isTwoLevelPublicSuffix(lastTwoLabels: string): boolean {
  if (KNOWN_TWO_LEVEL_SUFFIXES.has(lastTwoLabels)) {
    return true;
  }

  const [first, second] = lastTwoLabels.split(".");
  return (
    second !== undefined &&
    second.length === 2 &&
    TWO_LEVEL_SUFFIX_PREFIXES.has(first)
  );
}

export function registrableDomain(hostname: string): string {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!normalized || isIpAddress(normalized) || !normalized.includes(".")) {
    return normalized;
  }

  const labels = normalized.split(".").filter((label) => label !== "");
  if (labels.length <= 2) {
    return labels.join(".");
  }

  const lastTwo = labels.slice(-2).join(".");
  if (isTwoLevelPublicSuffix(lastTwo)) {
    return labels.slice(-3).join(".");
  }

  return lastTwo;
}

export function projectIdForHostname(hostname: string): string {
  return registrableDomain(hostname);
}

export function projectIdForOrigin(origin: string): string | null {
  try {
    return projectIdForHostname(new URL(origin).hostname);
  } catch {
    return null;
  }
}

export function projectDisplayName(projectId: string): string {
  return projectId.includes(".") ? `*.${projectId}` : projectId;
}
