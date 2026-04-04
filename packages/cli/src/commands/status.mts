import { readOriginInfo, readSiteConfigs, listScenarios } from "@wraithwalker/mcp-server/fixture-reader";
import { findRoot } from "../lib/root.mjs";

export async function run(_args: string[]): Promise<void> {
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

  console.log(`Root:        ${rootPath}`);
  console.log(`Root ID:     ${sentinel.rootId}`);
  console.log(`Origins:     ${configs.length}`);
  console.log(`Endpoints:   ${totalEndpoints}`);
  console.log(`Assets:      ${totalAssets}`);
  console.log(`Scenarios:   ${scenarios.length ? scenarios.join(", ") : "none"}`);
}
