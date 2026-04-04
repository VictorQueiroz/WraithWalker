import { promises as fs } from "node:fs";
import path from "node:path";

const SCENARIOS_DIR = path.join(".wraithwalker", "scenarios");

export interface EndpointRef {
  method: string;
  pathname: string;
  status: number;
  mimeType: string;
}

export interface EndpointChange {
  method: string;
  pathname: string;
  statusBefore: number;
  statusAfter: number;
  bodyChanged: boolean;
}

export interface FixtureDiff {
  scenarioA: string;
  scenarioB: string;
  added: EndpointRef[];
  removed: EndpointRef[];
  changed: EndpointChange[];
}

interface ResponseMeta {
  status: number;
  mimeType: string;
  url: string;
  method: string;
}

async function listDirectoriesIn(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

interface EndpointWithBody {
  key: string;
  method: string;
  pathname: string;
  status: number;
  mimeType: string;
  bodyContent: string | null;
  fixtureDir: string;
}

async function scanOriginsTree(originsDir: string, endpoints: Map<string, EndpointWithBody>): Promise<void> {
  const originKeys = await listDirectoriesIn(originsDir);

  for (const originKey of originKeys) {
    const httpDir = path.join(originsDir, originKey, "http");
    const methods = await listDirectoriesIn(httpDir);

    for (const method of methods) {
      const fixtures = await listDirectoriesIn(path.join(httpDir, method));
      for (const fixture of fixtures) {
        const fixtureDir = path.join(httpDir, method, fixture);
        const meta = await readJsonSafe<ResponseMeta>(path.join(fixtureDir, "response.meta.json"));
        if (!meta) continue;

        const pathname = meta.url ? new URL(meta.url).pathname : fixture.replace(/__q-.*/, "").replace(/-/g, "/");
        const key = `${method} ${pathname}`;
        const bodyContent = await readFileSafe(path.join(fixtureDir, "response.body"));

        endpoints.set(key, {
          key,
          method,
          pathname,
          status: meta.status,
          mimeType: meta.mimeType || "",
          bodyContent,
          fixtureDir
        });
      }
    }
  }
}

async function collectEndpointsFromScenario(scenarioPath: string): Promise<Map<string, EndpointWithBody>> {
  const endpoints = new Map<string, EndpointWithBody>();

  // Walk advanced-mode top-level origin directories
  const topEntries = await listDirectoriesIn(scenarioPath);
  for (const topDir of topEntries) {
    if (topDir.startsWith(".")) continue;
    await scanOriginsTree(path.join(scenarioPath, topDir, "origins"), endpoints);
  }

  // Walk simple-mode origin directories under .wraithwalker/simple/
  const simpleBase = path.join(scenarioPath, ".wraithwalker", "simple");
  const simpleOrigins = await listDirectoriesIn(simpleBase);
  for (const originKey of simpleOrigins) {
    await scanOriginsTree(path.join(simpleBase, originKey, "origins"), endpoints);
  }

  return endpoints;
}

export async function diffScenarios(rootPath: string, scenarioA: string, scenarioB: string): Promise<FixtureDiff> {
  const pathA = path.join(rootPath, SCENARIOS_DIR, scenarioA);
  const pathB = path.join(rootPath, SCENARIOS_DIR, scenarioB);

  const endpointsA = await collectEndpointsFromScenario(pathA);
  const endpointsB = await collectEndpointsFromScenario(pathB);

  const added: EndpointRef[] = [];
  const removed: EndpointRef[] = [];
  const changed: EndpointChange[] = [];

  // Find removed and changed
  for (const [key, epA] of endpointsA) {
    const epB = endpointsB.get(key);
    if (!epB) {
      removed.push({ method: epA.method, pathname: epA.pathname, status: epA.status, mimeType: epA.mimeType });
      continue;
    }

    const statusChanged = epA.status !== epB.status;
    const bodyChanged = epA.bodyContent !== epB.bodyContent;

    if (statusChanged || bodyChanged) {
      changed.push({
        method: epA.method,
        pathname: epA.pathname,
        statusBefore: epA.status,
        statusAfter: epB.status,
        bodyChanged
      });
    }
  }

  // Find added
  for (const [key, epB] of endpointsB) {
    if (!endpointsA.has(key)) {
      added.push({ method: epB.method, pathname: epB.pathname, status: epB.status, mimeType: epB.mimeType });
    }
  }

  return { scenarioA, scenarioB, added, removed, changed };
}

export function renderDiffMarkdown(diff: FixtureDiff): string {
  const lines: string[] = [];

  lines.push(`# Fixture Diff: ${diff.scenarioA} vs ${diff.scenarioB}`);
  lines.push("");

  if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
    lines.push("No differences found.");
    return lines.join("\n");
  }

  if (diff.added.length > 0) {
    lines.push("## Added Endpoints");
    lines.push("");
    for (const ep of diff.added) {
      lines.push(`- **${ep.method} ${ep.pathname}** (${ep.status}) — ${ep.mimeType}`);
    }
    lines.push("");
  }

  if (diff.removed.length > 0) {
    lines.push("## Removed Endpoints");
    lines.push("");
    for (const ep of diff.removed) {
      lines.push(`- **${ep.method} ${ep.pathname}** (${ep.status}) — ${ep.mimeType}`);
    }
    lines.push("");
  }

  if (diff.changed.length > 0) {
    lines.push("## Changed Endpoints");
    lines.push("");
    lines.push("| Method | Path | Status | Body Changed |");
    lines.push("|--------|------|--------|-------------|");
    for (const ch of diff.changed) {
      const statusStr = ch.statusBefore === ch.statusAfter ? String(ch.statusBefore) : `${ch.statusBefore} → ${ch.statusAfter}`;
      lines.push(`| ${ch.method} | ${ch.pathname} | ${statusStr} | ${ch.bodyChanged ? "Yes" : "No"} |`);
    }
    lines.push("");
  }

  lines.push(`Summary: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`);
  return lines.join("\n");
}
