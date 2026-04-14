import { readOriginInfo, readSiteConfigs } from "@wraithwalker/core/fixtures";
import { findRoot } from "@wraithwalker/core/root";
import { listScenarios } from "@wraithwalker/core/scenarios";

import type { CommandSpec } from "../lib/command.mjs";

interface StatusArgs {}

interface StatusResult {
  rootPath: string;
  rootId: string;
  origins: number;
  endpoints: number;
  assets: number;
  scenarios: string[];
}

export const command: CommandSpec<StatusArgs, StatusResult> = {
  name: "status",
  summary: "Show fixture root summary",
  usage: "Usage: wraithwalker status",
  requiresRoot: true,
  parse() {
    return {};
  },
  async execute(context) {
    const { rootPath, sentinel } = await findRoot(context.cwd);
    const configs = await readSiteConfigs(rootPath);
    const scenarioNames = await listScenarios(rootPath);

    let totalEndpoints = 0;
    let totalAssets = 0;

    for (const config of configs) {
      const info = await readOriginInfo(rootPath, config);
      totalEndpoints += info.apiEndpoints.length;
      if (info.manifest) {
        totalAssets += Object.values(info.manifest.resourcesByPathname).flat()
          .length;
      }
    }

    return {
      rootPath,
      rootId: sentinel.rootId,
      origins: configs.length,
      endpoints: totalEndpoints,
      assets: totalAssets,
      scenarios: scenarioNames
    };
  },
  render(output, result) {
    output.heading("Fixture Root Status");
    output.keyValue("Root", result.rootPath);
    output.keyValue("Root ID", result.rootId);
    output.keyValue("Origins", result.origins);
    output.keyValue("Endpoints", result.endpoints);
    output.keyValue("Assets", result.assets);
    output.keyValue(
      "Scenarios",
      result.scenarios.length ? result.scenarios.join(", ") : "none"
    );
  }
};
