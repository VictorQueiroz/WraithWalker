import { normalizeSiteInput, originToPermissionPattern } from "./path-utils.js";
import { createConfiguredSiteConfig } from "./site-config.js";
import type { SiteConfig } from "./types.js";

export interface WhitelistSiteOriginOptions {
  originInput: string;
  requestHostPermission: (permissionPattern: string) => Promise<boolean>;
  readSiteConfigs: () => Promise<SiteConfig[]>;
  writeSiteConfigs: (siteConfigs: SiteConfig[]) => Promise<void>;
}

export interface WhitelistSiteOriginResult {
  outcome: "added" | "already_enabled";
  origin: string;
  permissionPattern: string;
  siteConfigs: SiteConfig[];
}

export async function whitelistSiteOrigin({
  originInput,
  requestHostPermission,
  readSiteConfigs,
  writeSiteConfigs
}: WhitelistSiteOriginOptions): Promise<WhitelistSiteOriginResult> {
  const origin = normalizeSiteInput(originInput);
  const permissionPattern = originToPermissionPattern(origin);
  const granted = await requestHostPermission(permissionPattern);

  if (!granted) {
    throw new Error(`Host access was not granted for ${permissionPattern}.`);
  }

  const currentSiteConfigs = await readSiteConfigs();
  if (
    currentSiteConfigs.some(
      (siteConfig) => normalizeSiteInput(siteConfig.origin) === origin
    )
  ) {
    return {
      outcome: "already_enabled",
      origin,
      permissionPattern,
      siteConfigs: currentSiteConfigs
    };
  }

  const nextSiteConfigs = [
    ...currentSiteConfigs,
    createConfiguredSiteConfig(origin)
  ].sort((left, right) => left.origin.localeCompare(right.origin));

  await writeSiteConfigs(nextSiteConfigs);

  return {
    outcome: "added",
    origin,
    permissionPattern,
    siteConfigs: nextSiteConfigs
  };
}
