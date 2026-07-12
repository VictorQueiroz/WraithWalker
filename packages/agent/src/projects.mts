import { promises as fs } from "node:fs";
import path from "node:path";

import {
  readOriginInfo,
  readSiteConfigs,
  type OriginInfo
} from "@wraithwalker/core/fixtures";

import { projectDisplayName, projectIdForOrigin } from "./domains.mjs";

const SCENARIO_TRACES_RELATIVE_DIR = ".wraithwalker/scenario-traces";

export interface AgentProjectOrigin {
  origin: string;
  apiFixtureCount: number;
  assetCount: number;
}

export interface AgentProjectTabLink {
  origin: string;
  pageUrl: string;
  tabId: number;
}

export interface AgentProject {
  id: string;
  displayName: string;
  origins: AgentProjectOrigin[];
  connectedOrigins: string[];
  tabLinks: AgentProjectTabLink[];
  apiFixtureCount: number;
  assetCount: number;
  traceStepCount: number;
}

interface TraceStepLike {
  tabId?: number;
  pageUrl?: string;
  linkedFixtures?: { requestUrl?: string }[];
}

interface TraceRecordLike {
  steps?: TraceStepLike[];
}

function countManifestAssets(info: OriginInfo): number {
  if (!info.manifest) {
    return 0;
  }

  return Object.values(info.manifest.resourcesByPathname).reduce(
    (total, entries) => total + entries.length,
    0
  );
}

async function readJsonIfPresent<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

async function listTraceRecords(rootPath: string): Promise<TraceRecordLike[]> {
  const tracesDir = path.join(rootPath, SCENARIO_TRACES_RELATIVE_DIR);
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(tracesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const records: TraceRecordLike[] = [];
  for (const entry of entries) {
    const record = await readJsonIfPresent<TraceRecordLike>(
      path.join(tracesDir, entry, "trace.json")
    );
    if (record && Array.isArray(record.steps)) {
      records.push(record);
    }
  }

  return records;
}

function originOfUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function collectConnectedOrigins(
  rootPath: string,
  info: OriginInfo
): Promise<string[]> {
  const seenMetaDirs = new Set<string>();
  const origins = new Set<string>();

  for (const endpoint of info.apiEndpoints) {
    const marker = "/origins/";
    const normalized = endpoint.fixtureDir.split(path.sep).join("/");
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex === -1) {
      continue;
    }

    const requestOriginKey = normalized
      .slice(markerIndex + marker.length)
      .split("/")[0];
    if (!requestOriginKey || seenMetaDirs.has(requestOriginKey)) {
      continue;
    }

    seenMetaDirs.add(requestOriginKey);
    const meta = await readJsonIfPresent<{ url?: string }>(
      path.join(rootPath, endpoint.metaPath)
    );
    const origin = originOfUrl(meta?.url);
    if (origin && origin !== info.origin) {
      origins.add(origin);
    }
  }

  return [...origins].sort();
}

export async function listAgentProjects(
  rootPath: string
): Promise<AgentProject[]> {
  const configs = await readSiteConfigs(rootPath);
  const projects = new Map<string, AgentProject>();

  const ensureProject = (projectId: string): AgentProject => {
    let project = projects.get(projectId);
    if (!project) {
      project = {
        id: projectId,
        displayName: projectDisplayName(projectId),
        origins: [],
        connectedOrigins: [],
        tabLinks: [],
        apiFixtureCount: 0,
        assetCount: 0,
        traceStepCount: 0
      };
      projects.set(projectId, project);
    }
    return project;
  };

  for (const config of configs) {
    const projectId = projectIdForOrigin(config.origin);
    if (!projectId) {
      continue;
    }

    const info = await readOriginInfo(rootPath, config);
    const project = ensureProject(projectId);
    const assetCount = countManifestAssets(info);

    project.origins.push({
      origin: config.origin,
      apiFixtureCount: info.apiEndpoints.length,
      assetCount
    });
    project.apiFixtureCount += info.apiEndpoints.length;
    project.assetCount += assetCount;

    for (const origin of await collectConnectedOrigins(rootPath, info)) {
      if (!project.connectedOrigins.includes(origin)) {
        project.connectedOrigins.push(origin);
      }
    }
  }

  for (const record of await listTraceRecords(rootPath)) {
    for (const step of record.steps ?? []) {
      const pageOrigin = originOfUrl(step.pageUrl);
      const projectId = pageOrigin ? projectIdForOrigin(pageOrigin) : null;
      if (!projectId || !projects.has(projectId)) {
        continue;
      }

      const project = ensureProject(projectId);
      project.traceStepCount += 1;

      for (const fixture of step.linkedFixtures ?? []) {
        const fixtureOrigin = originOfUrl(fixture.requestUrl);
        if (!fixtureOrigin || fixtureOrigin === pageOrigin) {
          continue;
        }

        if (!project.connectedOrigins.includes(fixtureOrigin)) {
          project.connectedOrigins.push(fixtureOrigin);
        }

        if (
          typeof step.tabId === "number" &&
          step.pageUrl &&
          !project.tabLinks.some(
            (link) =>
              link.origin === fixtureOrigin && link.pageUrl === step.pageUrl
          )
        ) {
          project.tabLinks.push({
            origin: fixtureOrigin,
            pageUrl: step.pageUrl,
            tabId: step.tabId
          });
        }
      }
    }
  }

  for (const project of projects.values()) {
    project.connectedOrigins.sort();
    project.origins.sort((a, b) => a.origin.localeCompare(b.origin));
  }

  return [...projects.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function getAgentProject(
  rootPath: string,
  projectId: string
): Promise<AgentProject | null> {
  const projects = await listAgentProjects(rootPath);
  return projects.find((project) => project.id === projectId) ?? null;
}
