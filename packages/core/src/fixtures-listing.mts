import { getFixtureDisplayPath } from "./fixture-layout.mjs";
import { createFixtureRootFs } from "./root-fs.mjs";
import {
  compareApiEndpoints,
  compareAssetInfos,
  normalizeSiteConfigs,
  readOriginInfo,
  flattenStaticResourceManifest,
  uniqueOrigins
} from "./fixtures-discovery.mjs";
import {
  DEFAULT_ASSET_LIMIT,
  MAX_ASSET_LIMIT,
  isEditableProjectionAsset,
  normalizeLimit,
  paginateItems
} from "./fixtures-shared.mjs";
import type {
  AssetInfo,
  AssetListOptions,
  DiscoveryResult,
  EndpointListResult,
  SiteConfigLike
} from "./fixtures-types.mjs";

export async function listAssets(
  rootPath: string,
  siteConfigOrConfigs: SiteConfigLike | SiteConfigLike[],
  options: AssetListOptions = {}
): Promise<DiscoveryResult<AssetInfo>> {
  const infos = await Promise.all(
    normalizeSiteConfigs(siteConfigOrConfigs).map(async (siteConfig) =>
      readOriginInfo(rootPath, siteConfig)
    )
  );
  const rootFs = createFixtureRootFs(rootPath);
  const normalizedPathnameContains = options.pathnameContains?.toLowerCase();

  const filteredItems = infos
    .flatMap((info) =>
      flattenStaticResourceManifest(info.manifest).map((entry) => ({
        ...entry,
        origin: info.origin,
        path: getFixtureDisplayPath(entry)
      }))
    )
    .filter((entry) => {
      if (
        options.resourceTypes?.length &&
        !options.resourceTypes.includes(entry.resourceType)
      ) {
        return false;
      }
      if (
        options.mimeTypes?.length &&
        !options.mimeTypes.includes(entry.mimeType)
      ) {
        return false;
      }
      if (
        options.requestOrigin &&
        entry.requestOrigin !== options.requestOrigin
      ) {
        return false;
      }
      if (
        normalizedPathnameContains &&
        !entry.pathname.toLowerCase().includes(normalizedPathnameContains)
      ) {
        return false;
      }

      return true;
    });

  const items = await Promise.all(
    filteredItems.map(async (entry) => {
      const stat = await rootFs.stat(entry.bodyPath);
      const hasBody = Boolean(stat?.isFile());

      return {
        ...entry,
        hasBody,
        bodySize: hasBody ? stat!.size : null,
        editable: isEditableProjectionAsset(entry.projectionPath, entry),
        canonicalPath: entry.bodyPath
      };
    })
  ).then((entries) => entries.sort(compareAssetInfos));

  return {
    ...paginateItems(
      items,
      normalizeLimit(options.limit, DEFAULT_ASSET_LIMIT, MAX_ASSET_LIMIT),
      options.cursor
    ),
    matchedOrigins: uniqueOrigins(infos.map((info) => info.origin))
  };
}

export async function listApiEndpoints(
  rootPath: string,
  siteConfigOrConfigs: SiteConfigLike | SiteConfigLike[]
): Promise<EndpointListResult> {
  const infos = await Promise.all(
    normalizeSiteConfigs(siteConfigOrConfigs).map(async (siteConfig) =>
      readOriginInfo(rootPath, siteConfig)
    )
  );

  return {
    items: infos.flatMap((info) => info.apiEndpoints).sort(compareApiEndpoints),
    matchedOrigins: uniqueOrigins(infos.map((info) => info.origin))
  };
}
