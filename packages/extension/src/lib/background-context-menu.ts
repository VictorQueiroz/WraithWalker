import type { BackgroundAuthorityApi } from "./background-authority.js";
import type {
  BrowserTab,
  ChromeApi,
  ContextMenuOnClickData
} from "./chrome-api.js";
import { findMatchingOrigin } from "./background-helpers.js";
import { getErrorMessage } from "./background-runtime-shared.js";
import { originToPermissionPattern } from "./path-utils.js";
import { whitelistSiteOrigin } from "./site-whitelist.js";

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

const WHITELIST_ROOT_REQUIRED_MESSAGE =
  "Open WraithWalker Settings and choose Root Directory, or connect the local WraithWalker server, before whitelisting websites.";

interface BackgroundContextMenuDependencies {
  chromeApi: ChromeApi;
  authority: Pick<
    BackgroundAuthorityApi,
    | "readConfiguredSiteConfigsForAuthority"
    | "writeConfiguredSiteConfigsForAuthority"
  >;
  getEnabledOrigins: () => string[];
  isAuthorityReady: () => boolean;
  setLastError: (message: string) => void;
}

export interface BackgroundContextMenuApi {
  registerContextMenus(): Promise<void>;
  refreshContextMenuForActiveTab(): Promise<void>;
  refreshContextMenuForActiveTabWithOrigins(origins: string[]): Promise<void>;
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
  getEnabledOrigins,
  isAuthorityReady,
  setLastError
}: BackgroundContextMenuDependencies): BackgroundContextMenuApi {
  let lastKnownOrigins: string[] = [];

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

  function resolveWhitelistMenuStateForOrigins(
    url: string | null,
    origins: string[]
  ): WhitelistMenuState {
    if (!url) {
      return DEFAULT_WHITELIST_MENU_STATE;
    }

    return findMatchingOrigin(url, origins)
      ? UNWHITELIST_MENU_STATE
      : DEFAULT_WHITELIST_MENU_STATE;
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

    lastKnownOrigins = configuredResult.siteConfigs.map(
      (siteConfig) => siteConfig.origin
    );

    return findMatchingOrigin(
      url,
      lastKnownOrigins
    )
      ? UNWHITELIST_MENU_STATE
      : DEFAULT_WHITELIST_MENU_STATE;
  }

  async function refreshContextMenuForTabWithOrigins(
    tab: BrowserTab | undefined,
    origins: string[]
  ): Promise<void> {
    if (!chromeApi.contextMenus?.update) {
      return;
    }

    lastKnownOrigins = [...origins];
    await updateWhitelistMenuState(
      resolveWhitelistMenuStateForOrigins(resolveUrlCandidate({}, tab), origins)
    );
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

  async function refreshContextMenuForActiveTabWithOrigins(
    origins: string[]
  ): Promise<void> {
    if (!chromeApi.contextMenus?.update) {
      return;
    }

    const [activeTab] = await chromeApi.tabs.query({
      active: true,
      currentWindow: true
    });
    await refreshContextMenuForTabWithOrigins(activeTab, origins);
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

    const matchingOrigin =
      url &&
      findMatchingOrigin(
        url,
        lastKnownOrigins.length > 0 ? lastKnownOrigins : getEnabledOrigins()
      );

    if (matchingOrigin) {
      const configuredResult =
        await authority.readConfiguredSiteConfigsForAuthority();
      if (!configuredResult.ok) {
        setLastError(getErrorMessage(configuredResult));
        return;
      }

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
        lastKnownOrigins = nextSiteConfigs.map((siteConfig) => siteConfig.origin);
        await updateWhitelistMenuState(DEFAULT_WHITELIST_MENU_STATE);
      }
      return;
    }

    if (!isAuthorityReady()) {
      setLastError(WHITELIST_ROOT_REQUIRED_MESSAGE);
      return;
    }

    try {
      const result = await whitelistSiteOrigin({
        originInput: origin,
        requestHostPermission: async (permissionPattern) => {
          if (!chromeApi.permissions) {
            return true;
          }

          return chromeApi.permissions.request({
            origins: [permissionPattern]
          });
        },
        readSiteConfigs: async () => {
          const configuredResult =
            await authority.readConfiguredSiteConfigsForAuthority();
          if (!configuredResult.ok) {
            throw new Error(getErrorMessage(configuredResult));
          }

          return configuredResult.siteConfigs;
        },
        writeSiteConfigs: async (siteConfigs) => {
          const writeResult =
            await authority.writeConfiguredSiteConfigsForAuthority(siteConfigs);
          if (!writeResult.ok) {
            throw new Error(getErrorMessage(writeResult));
          }
        }
      });
      lastKnownOrigins = result.siteConfigs.map((siteConfig) => siteConfig.origin);
      setLastError("");
      await updateWhitelistMenuState(UNWHITELIST_MENU_STATE);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    registerContextMenus,
    refreshContextMenuForActiveTab,
    refreshContextMenuForActiveTabWithOrigins,
    refreshContextMenuForTab,
    handleContextMenuClicked
  };
}
