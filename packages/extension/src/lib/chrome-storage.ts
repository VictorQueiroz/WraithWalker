import { DEFAULT_EDITOR_ID, DEFAULT_NATIVE_HOST_CONFIG, STORAGE_KEYS } from "./constants.js";
import { normalizeSiteConfigs } from "./site-config.js";
import type { NativeHostConfig, SessionSnapshot, SiteConfig, StorageState } from "./types.js";

function storageGet<K extends keyof StorageState>(keys: K[]): Promise<Pick<StorageState, K>> {
  return chrome.storage.local.get(keys) as Promise<Pick<StorageState, K>>;
}

function storageSet(values: Partial<StorageState>): Promise<void> {
  return chrome.storage.local.set(values);
}

export async function getSiteConfigs(): Promise<SiteConfig[]> {
  const { [STORAGE_KEYS.SITES]: sites = [] } = await storageGet([STORAGE_KEYS.SITES]);
  return normalizeSiteConfigs(sites);
}

export async function setSiteConfigs(siteConfigs: SiteConfig[]): Promise<void> {
  await storageSet({ [STORAGE_KEYS.SITES]: siteConfigs });
}

export async function getNativeHostConfig(): Promise<NativeHostConfig> {
  const { [STORAGE_KEYS.NATIVE_HOST]: stored = {} } = await storageGet([STORAGE_KEYS.NATIVE_HOST]);
  const storedConfig =
    stored && typeof stored === "object"
      ? stored
      : {};
  return Object.assign({}, DEFAULT_NATIVE_HOST_CONFIG, storedConfig);
}

export async function setNativeHostConfig(nativeHostConfig: NativeHostConfig): Promise<void> {
  await storageSet({ [STORAGE_KEYS.NATIVE_HOST]: nativeHostConfig });
}

export async function setLastSessionSnapshot(snapshot: SessionSnapshot): Promise<void> {
  await storageSet({ [STORAGE_KEYS.LAST_SESSION]: snapshot });
}

export async function getPreferredEditorId(): Promise<string> {
  const { [STORAGE_KEYS.PREFERRED_EDITOR]: editorId } = await storageGet([STORAGE_KEYS.PREFERRED_EDITOR]);
  return typeof editorId === "string" && editorId ? editorId : DEFAULT_EDITOR_ID;
}

export async function setPreferredEditorId(editorId: string): Promise<void> {
  await storageSet({ [STORAGE_KEYS.PREFERRED_EDITOR]: editorId });
}
