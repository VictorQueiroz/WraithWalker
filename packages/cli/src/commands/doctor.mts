import {
  CAPTURE_ASSETS_DIR,
  CAPTURE_HTTP_DIR,
  DEFAULT_CONTEXT_FILES,
  EDITOR_CONTEXT_FILES,
  MANIFESTS_DIR,
  PROJECT_CONFIG_RELATIVE_PATH,
  ROOT_SENTINEL_RELATIVE_PATH
} from "../lib/constants.mjs";
import { readOriginInfo } from "@wraithwalker/core/fixtures";
import { readConfiguredSiteConfigs, readEffectiveSiteConfigs } from "@wraithwalker/core/project-config";
import { createFixtureRootFs } from "@wraithwalker/core/root-fs";
import { readSentinel, type RootSentinel } from "@wraithwalker/core/root";
import { listScenarios } from "@wraithwalker/core/scenarios";

import type { CommandSpec } from "../lib/command.mjs";
import { UsageError } from "../lib/command.mjs";
import { resolveServeRoot } from "../lib/serve-root.mjs";

interface DoctorArgs {
  dir?: string;
  json: boolean;
}

interface ContextFileStatus {
  path: string;
  exists: boolean;
}

interface DoctorReport {
  generatedAt: string;
  rootPath: string;
  rootFound: boolean;
  sentinel: RootSentinel | null;
  projectConfigExists: boolean;
  capturesAssetsExists: boolean;
  capturesHttpExists: boolean;
  manifestsExists: boolean;
  configuredOrigins: string[];
  effectiveOrigins: string[];
  endpoints: number;
  assets: number;
  scenarios: string[];
  contextFiles: ContextFileStatus[];
  issues: string[];
}

interface DoctorResult {
  report: DoctorReport;
  json: boolean;
}

function createUsageMessage() {
  return "Usage: wraithwalker doctor [dir] [--json]";
}

function buildContextFileList(): string[] {
  return [...new Set([
    ...DEFAULT_CONTEXT_FILES,
    ...Object.values(EDITOR_CONTEXT_FILES).flat()
  ])];
}

export const command: CommandSpec<DoctorArgs, DoctorResult> = {
  name: "doctor",
  summary: "Inspect root health and support diagnostics",
  usage: createUsageMessage(),
  parse(argv) {
    let dir: string | undefined;
    let json = false;

    for (const arg of argv) {
      if (arg === "--json") {
        json = true;
        continue;
      }

      if (arg.startsWith("-")) {
        throw new UsageError(createUsageMessage());
      }

      if (dir) {
        throw new UsageError(createUsageMessage());
      }

      dir = arg;
    }

    return { dir, json };
  },
  async execute(context, args) {
    const rootPath = await resolveServeRoot({
      cwd: context.cwd,
      explicitDir: args.dir,
      env: context.env,
      platform: context.platform ?? process.platform,
      homeDir: context.homeDir
    });
    const rootFs = createFixtureRootFs(rootPath);
    const rootFound = await rootFs.exists(ROOT_SENTINEL_RELATIVE_PATH);

    let sentinel: RootSentinel | null = null;
    let configuredOrigins: string[] = [];
    let effectiveOrigins: string[] = [];
    let endpoints = 0;
    let assets = 0;
    let scenarios: string[] = [];

    if (rootFound) {
      sentinel = await readSentinel(rootPath);
      const [configuredSiteConfigs, effectiveSiteConfigs, scenarioNames] = await Promise.all([
        readConfiguredSiteConfigs(rootPath),
        readEffectiveSiteConfigs(rootPath),
        listScenarios(rootPath)
      ]);

      configuredOrigins = configuredSiteConfigs.map((siteConfig) => siteConfig.origin);
      effectiveOrigins = effectiveSiteConfigs.map((siteConfig) => siteConfig.origin);
      scenarios = scenarioNames;

      for (const siteConfig of effectiveSiteConfigs) {
        const info = await readOriginInfo(rootPath, siteConfig);
        endpoints += info.apiEndpoints.length;
        if (info.manifest) {
          assets += Object.values(info.manifest.resourcesByPathname).flat().length;
        }
      }
    }

    const [projectConfigExists, capturesAssetsExists, capturesHttpExists, manifestsExists] = await Promise.all([
      rootFs.exists(PROJECT_CONFIG_RELATIVE_PATH),
      rootFs.exists(CAPTURE_ASSETS_DIR),
      rootFs.exists(CAPTURE_HTTP_DIR),
      rootFs.exists(MANIFESTS_DIR)
    ]);
    const contextFiles = await Promise.all(buildContextFileList().map(async (relativePath) => ({
      path: relativePath,
      exists: await rootFs.exists(relativePath)
    })));

    const issues = new Set<string>();
    if (!rootFound) {
      issues.add(`No ${ROOT_SENTINEL_RELATIVE_PATH} was found at the resolved root path.`);
    }
    if (rootFound && !projectConfigExists) {
      issues.add("Project config is missing.");
    }
    if (rootFound && effectiveOrigins.length === 0) {
      issues.add("No enabled origins are configured.");
    }
    if (rootFound && endpoints === 0 && assets === 0) {
      issues.add("No captured fixtures were found.");
    }
    if (!contextFiles.some((file) => file.exists)) {
      issues.add("No editor context files are present.");
    }

    return {
      json: args.json,
      report: {
        generatedAt: new Date().toISOString(),
        rootPath,
        rootFound,
        sentinel,
        projectConfigExists,
        capturesAssetsExists,
        capturesHttpExists,
        manifestsExists,
        configuredOrigins,
        effectiveOrigins,
        endpoints,
        assets,
        scenarios,
        contextFiles,
        issues: [...issues]
      }
    };
  },
  render(output, result) {
    if (result.json) {
      output.block(JSON.stringify(result.report, null, 2));
      return;
    }

    output.heading("WraithWalker Doctor");
    output.keyValue("Root", result.report.rootPath);
    output.keyValue("Root Found", result.report.rootFound ? "yes" : "no");
    output.keyValue("Root ID", result.report.sentinel?.rootId ?? "missing");
    output.keyValue("Project Config", result.report.projectConfigExists ? "yes" : "no");
    output.keyValue("Configured Origins", result.report.configuredOrigins.length);
    output.keyValue("Effective Origins", result.report.effectiveOrigins.length);
    output.keyValue("Endpoints", result.report.endpoints);
    output.keyValue("Assets", result.report.assets);
    output.keyValue("Scenarios", result.report.scenarios.length ? result.report.scenarios.join(", ") : "none");
    output.keyValue("Captures Assets", result.report.capturesAssetsExists ? "yes" : "no");
    output.keyValue("Captures HTTP", result.report.capturesHttpExists ? "yes" : "no");
    output.keyValue("Manifests", result.report.manifestsExists ? "yes" : "no");

    output.heading("Context Files");
    for (const contextFile of result.report.contextFiles) {
      output.listItem(`${contextFile.path} (${contextFile.exists ? "present" : "missing"})`);
    }

    output.heading("Issues");
    if (!result.report.issues.length) {
      output.success("No obvious problems found.");
      return;
    }

    for (const issue of result.report.issues) {
      output.listItem(issue);
    }
  }
};
