import { shouldDumpRequest as defaultShouldDumpRequest } from "./site-config.js";
import type { RequestContext, SiteConfig, SiteMode } from "./types.js";

interface CapturePolicyDependencies {
  getSiteConfigForOrigin?: (topOrigin: string) => SiteConfig | undefined;
  shouldDumpRequest?: (siteConfig: SiteConfig, method: string, url: string) => boolean;
}

export function createCapturePolicy({
  getSiteConfigForOrigin,
  shouldDumpRequest = defaultShouldDumpRequest
}: CapturePolicyDependencies = {}) {
  function getSiteConfig(topOrigin: string): SiteConfig | undefined {
    return getSiteConfigForOrigin?.(topOrigin);
  }

  function getSiteMode(topOrigin: string): SiteMode | undefined {
    return getSiteConfig(topOrigin)?.mode;
  }

  function shouldPersist(context: Pick<RequestContext, "topOrigin" | "method" | "url">): boolean {
    const siteConfig = getSiteConfig(context.topOrigin);
    return siteConfig
      ? shouldDumpRequest(siteConfig, context.method, context.url)
      : true;
  }

  return {
    getSiteConfig,
    getSiteMode,
    shouldPersist
  };
}
