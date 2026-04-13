import type { BackgroundAuthorityApi } from "./background-authority.js";
import type {
  BrowserTab,
  ChromeApi,
  ContextMenuOnClickData
} from "./background-runtime-shared.js";
import { getErrorMessage } from "./background-runtime-shared.js";
import { originToPermissionPattern } from "./path-utils.js";
import { createConfiguredSiteConfig } from "./site-config.js";

export const WHITELIST_SITE_MENU_ID = "wraithwalker.whitelist-site";

const WEB_DOCUMENT_URL_PATTERNS = [
  "http://*/*",
  "https://*/*"
];

interface BackgroundContextMenuDependencies {
  chromeApi: ChromeApi;
  authority: Pick<
    BackgroundAuthorityApi,
    | "ensureRootReady"
    | "readConfiguredSiteConfigsForAuthority"
    | "writeConfiguredSiteConfigsForAuthority"
  >;
  setLastError: (message: string) => void;
}

export interface BackgroundContextMenuApi {
  registerContextMenus(): Promise<void>;
  handleContextMenuClicked(info: ContextMenuOnClickData, tab?: BrowserTab): Promise<void>;
}

function resolveOriginCandidate(info: ContextMenuOnClickData, tab?: BrowserTab): string | null {
  for (const candidate of [tab?.url, info.pageUrl, info.frameUrl, info.linkUrl]) {
    if (typeof candidate !== "string" || !candidate.trim()) {
      continue;
    }

    try {
      const url = new URL(candidate);
      if (!["http:", "https:"].includes(url.protocol)) {
        continue;
      }

      return url.origin;
    } catch {
      continue;
    }
  }

  return null;
}

export function createBackgroundContextMenu({
  chromeApi,
  authority,
  setLastError
}: BackgroundContextMenuDependencies): BackgroundContextMenuApi {
  async function registerContextMenus(): Promise<void> {
    if (!chromeApi.contextMenus) {
      return;
    }

    await Promise.resolve(chromeApi.contextMenus.removeAll());
    chromeApi.contextMenus.create({
      id: WHITELIST_SITE_MENU_ID,
      title: "Whitelist this website",
      contexts: ["all"],
      documentUrlPatterns: WEB_DOCUMENT_URL_PATTERNS
    });
  }

  async function handleContextMenuClicked(info: ContextMenuOnClickData, tab?: BrowserTab): Promise<void> {
    if (info.menuItemId !== WHITELIST_SITE_MENU_ID) {
      return;
    }

    const origin = resolveOriginCandidate(info, tab);
    if (!origin) {
      setLastError("Only http and https origins are supported.");
      return;
    }

    const rootResult = await authority.ensureRootReady({ requestPermission: true });
    if (!rootResult.ok) {
      setLastError(getErrorMessage(rootResult));
      return;
    }

    if (chromeApi.permissions) {
      const granted = await chromeApi.permissions.request({
        origins: [originToPermissionPattern(origin)]
      });
      if (!granted) {
        setLastError(`Host permission was not granted for ${origin}.`);
        return;
      }
    }

    const configuredResult = await authority.readConfiguredSiteConfigsForAuthority();
    if (!configuredResult.ok) {
      setLastError(getErrorMessage(configuredResult));
      return;
    }

    if (configuredResult.siteConfigs.some((siteConfig) => siteConfig.origin === origin)) {
      setLastError("");
      return;
    }

    const nextSiteConfigs = [
      ...configuredResult.siteConfigs,
      createConfiguredSiteConfig(origin)
    ].sort((left, right) => left.origin.localeCompare(right.origin));

    const writeResult = await authority.writeConfiguredSiteConfigsForAuthority(nextSiteConfigs);
    setLastError(writeResult.ok ? "" : getErrorMessage(writeResult));
  }

  return {
    registerContextMenus,
    handleContextMenuClicked
  };
}
