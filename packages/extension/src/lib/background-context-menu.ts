import type { BackgroundAuthorityApi } from "./background-authority.js";
import type {
  BrowserTab,
  ChromeApi,
  ContextMenuOnClickData
} from "./chrome-api.js";
import { findMatchingOrigin } from "./background-helpers.js";
import { getErrorMessage } from "./background-runtime-shared.js";
import { originToPermissionPattern } from "./path-utils.js";
import { createConfiguredSiteConfig } from "./site-config.js";

export const WHITELIST_SITE_MENU_ID = "wraithwalker.whitelist-site";
export const WHITELIST_SITE_MENU_TITLE = "Whitelist this website";
export const UNWHITELIST_SITE_MENU_TITLE = "Remove this website from whitelist";

const WEB_DOCUMENT_URL_PATTERNS = ["http://*/*", "https://*/*"];

interface WhitelistMenuState {
  title: string;
  enabled: boolean;
}

const DEFAULT_WHITELIST_MENU_STATE: WhitelistMenuState = {
  title: WHITELIST_SITE_MENU_TITLE,
  enabled: true
};

const UNWHITELIST_MENU_STATE: WhitelistMenuState = {
  title: UNWHITELIST_SITE_MENU_TITLE,
  enabled: true
};

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
  refreshContextMenuForActiveTab(): Promise<void>;
  refreshContextMenuForTab(tab?: BrowserTab): Promise<void>;
  handleContextMenuClicked(
    info: ContextMenuOnClickData,
    tab?: BrowserTab
  ): Promise<void>;
}

function resolveUrlCandidate(
  info: ContextMenuOnClickData,
  tab?: BrowserTab
): string | null {
  for (const candidate of [
    tab?.url,
    info.pageUrl,
    info.frameUrl,
    info.linkUrl
  ]) {
    if (typeof candidate !== "string" || !candidate.trim()) {
      continue;
    }

    try {
      const url = new URL(candidate);
      if (!["http:", "https:"].includes(url.protocol)) {
        continue;
      }

      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function resolveOriginCandidate(
  info: ContextMenuOnClickData,
  tab?: BrowserTab
): string | null {
  const url = resolveUrlCandidate(info, tab);
  return url ? new URL(url).origin : null;
}

export function createBackgroundContextMenu({
  chromeApi,
  authority,
  setLastError
}: BackgroundContextMenuDependencies): BackgroundContextMenuApi {
  async function updateWhitelistMenuState(
    menuState: WhitelistMenuState
  ): Promise<void> {
    if (!chromeApi.contextMenus?.update) {
      return;
    }

    await Promise.resolve(
      chromeApi.contextMenus.update(WHITELIST_SITE_MENU_ID, menuState)
    );
  }

  async function resolveWhitelistMenuState(
    url: string | null
  ): Promise<WhitelistMenuState> {
    if (!url) {
      return DEFAULT_WHITELIST_MENU_STATE;
    }

    const configuredResult =
      await authority.readConfiguredSiteConfigsForAuthority();
    if (!configuredResult.ok) {
      return DEFAULT_WHITELIST_MENU_STATE;
    }

    return findMatchingOrigin(
      url,
      configuredResult.siteConfigs.map((siteConfig) => siteConfig.origin)
    )
      ? UNWHITELIST_MENU_STATE
      : DEFAULT_WHITELIST_MENU_STATE;
  }

  async function registerContextMenus(): Promise<void> {
    if (!chromeApi.contextMenus) {
      return;
    }

    await Promise.resolve(chromeApi.contextMenus.removeAll());
    chromeApi.contextMenus.create({
      id: WHITELIST_SITE_MENU_ID,
      title: WHITELIST_SITE_MENU_TITLE,
      contexts: ["all"],
      documentUrlPatterns: WEB_DOCUMENT_URL_PATTERNS
    });
  }

  async function refreshContextMenuForTab(tab?: BrowserTab): Promise<void> {
    if (!chromeApi.contextMenus?.update) {
      return;
    }

    await updateWhitelistMenuState(
      await resolveWhitelistMenuState(resolveUrlCandidate({}, tab))
    );
  }

  async function refreshContextMenuForActiveTab(): Promise<void> {
    if (!chromeApi.contextMenus?.update) {
      return;
    }

    const [activeTab] = await chromeApi.tabs.query({
      active: true,
      currentWindow: true
    });
    await refreshContextMenuForTab(activeTab);
  }

  async function handleContextMenuClicked(
    info: ContextMenuOnClickData,
    tab?: BrowserTab
  ): Promise<void> {
    if (info.menuItemId !== WHITELIST_SITE_MENU_ID) {
      return;
    }

    const origin = resolveOriginCandidate(info, tab);
    const url = resolveUrlCandidate(info, tab);
    if (!origin) {
      setLastError("Only http and https origins are supported.");
      return;
    }

    const rootResult = await authority.ensureRootReady({
      requestPermission: true
    });
    if (!rootResult.ok) {
      setLastError(getErrorMessage(rootResult));
      return;
    }

    const configuredResult =
      await authority.readConfiguredSiteConfigsForAuthority();
    if (!configuredResult.ok) {
      setLastError(getErrorMessage(configuredResult));
      return;
    }

    const matchingOrigin =
      url &&
      findMatchingOrigin(
        url,
        configuredResult.siteConfigs.map((siteConfig) => siteConfig.origin)
      );

    if (matchingOrigin) {
      const nextSiteConfigs = configuredResult.siteConfigs.filter(
        (siteConfig) => siteConfig.origin !== matchingOrigin
      );
      const writeResult =
        await authority.writeConfiguredSiteConfigsForAuthority(nextSiteConfigs);
      if (writeResult.ok) {
        await Promise.resolve(
          chromeApi.permissions?.remove?.({
            origins: [originToPermissionPattern(matchingOrigin)]
          })
        ).catch(() => false);
      }
      setLastError(writeResult.ok ? "" : getErrorMessage(writeResult));
      if (writeResult.ok) {
        await updateWhitelistMenuState(DEFAULT_WHITELIST_MENU_STATE);
      }
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

    const nextSiteConfigs = [
      ...configuredResult.siteConfigs,
      createConfiguredSiteConfig(origin)
    ].sort((left, right) => left.origin.localeCompare(right.origin));

    const writeResult =
      await authority.writeConfiguredSiteConfigsForAuthority(nextSiteConfigs);
    setLastError(writeResult.ok ? "" : getErrorMessage(writeResult));
    if (writeResult.ok) {
      await updateWhitelistMenuState(UNWHITELIST_MENU_STATE);
    }
  }

  return {
    registerContextMenus,
    refreshContextMenuForActiveTab,
    refreshContextMenuForTab,
    handleContextMenuClicked
  };
}
