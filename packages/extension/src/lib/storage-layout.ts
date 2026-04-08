import { createFixtureDescriptor as defaultCreateFixtureDescriptor } from "./fixture-mapper.js";
import type { FixtureDescriptor, RequestContext, SiteConfig } from "./types.js";

interface StorageLayoutDependencies {
  createFixtureDescriptor?: (entry: {
    topOrigin: string;
    method: string;
    url: string;
    postData?: string;
    postDataEncoding?: string;
    resourceType?: string;
    mimeType?: string;
  }) => Promise<FixtureDescriptor>;
}

export function createStorageLayoutResolver({
  createFixtureDescriptor = defaultCreateFixtureDescriptor
}: StorageLayoutDependencies = {}) {
  async function describeRequest(context: RequestContext, _siteConfig?: Pick<SiteConfig, never>): Promise<FixtureDescriptor> {
    return createFixtureDescriptor({
      topOrigin: context.topOrigin,
      method: context.method,
      url: context.url,
      postData: context.body,
      postDataEncoding: context.bodyEncoding,
      resourceType: context.resourceType,
      mimeType: context.mimeType
    });
  }

  return {
    describeRequest
  };
}
