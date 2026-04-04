import { readOriginInfo, readSiteConfigs, listScenarios } from "@wraithwalker/mcp-server/fixture-reader";
import { findRoot } from "../lib/root.mjs";
import type { Output } from "../lib/output.mjs";

export async function run(_args: string[], output: Output): Promise<void> {
  const { rootPath, sentinel } = await findRoot();

  const configs = await readSiteConfigs(rootPath);
  const scenarios = await listScenarios(rootPath);

  let totalEndpoints = 0;
  let totalAssets = 0;

  for (const config of configs) {
    const info = await readOriginInfo(rootPath, config);
    totalEndpoints += info.apiEndpoints.length;
    if (info.manifest) {
      totalAssets += Object.values(info.manifest.resourcesByPathname).flat().length;
    }
  }

  output.heading("Fixture Root Status");
  output.keyValue("Root", rootPath);
  output.keyValue("Root ID", sentinel.rootId);
  output.keyValue("Origins", configs.length);
  output.keyValue("Endpoints", totalEndpoints);
  output.keyValue("Assets", totalAssets);
  output.keyValue("Scenarios", scenarios.length ? scenarios.join(", ") : "none");
}
