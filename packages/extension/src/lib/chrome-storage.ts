import { DEFAULT_EDITOR_ID, STORAGE_KEYS } from "./constants.js";
import {
  normalizeNativeHostConfig,
  normalizePreferredEditorId
} from "./editor-launch.js";
import { normalizeSiteConfigs } from "./site-config.js";
import type {
  NativeHostConfig,
  SessionSnapshot,
  SiteConfig,
  StorageState
} from "./types.js";

function storageGet<K extends keyof StorageState>(
  keys: K[]
): Promise<Pick<StorageState, K>> {
  return chrome.storage.local.get(keys) as Promise<Pick<StorageState, K>>;
}

function storageSet(values: Partial<StorageState>): Promise<void> {
  return chrome.storage.local.set(values);
}

export async function getSiteConfigs(): Promise<SiteConfig[]> {
  const { [STORAGE_KEYS.SITES]: sites = [] } = await storageGet([
    STORAGE_KEYS.SITES
  ]);
  return normalizeSiteConfigs(sites);
}

export async function setSiteConfigs(siteConfigs: SiteConfig[]): Promise<void> {
  await storageSet({ [STORAGE_KEYS.SITES]: normalizeSiteConfigs(siteConfigs) });
}

export async function getLegacySiteConfigsMigrated(): Promise<boolean> {
  const { [STORAGE_KEYS.LEGACY_SITES_MIGRATED]: migrated } = await storageGet([
    STORAGE_KEYS.LEGACY_SITES_MIGRATED
  ]);
  return migrated === true;
}

export async function setLegacySiteConfigsMigrated(
  migrated: boolean
): Promise<void> {
  await storageSet({ [STORAGE_KEYS.LEGACY_SITES_MIGRATED]: migrated });
}

export async function getNativeHostConfig(): Promise<NativeHostConfig> {
  const result = await storageGet([
    STORAGE_KEYS.NATIVE_HOST,
    STORAGE_KEYS.PREFERRED_EDITOR
  ]);
  const stored = result[STORAGE_KEYS.NATIVE_HOST];
  const preferredEditorId = normalizePreferredEditorId(
    result[STORAGE_KEYS.PREFERRED_EDITOR]
  );
  return normalizeNativeHostConfig(stored, preferredEditorId);
}

export async function setNativeHostConfig(
  nativeHostConfig: NativeHostConfig
): Promise<void> {
  const { [STORAGE_KEYS.PREFERRED_EDITOR]: preferredEditorId } =
    await storageGet([STORAGE_KEYS.PREFERRED_EDITOR]);
  await storageSet({
    [STORAGE_KEYS.NATIVE_HOST]: normalizeNativeHostConfig(
      nativeHostConfig,
      normalizePreferredEditorId(preferredEditorId)
    )
  });
}

export async function setLastSessionSnapshot(
  snapshot: SessionSnapshot
): Promise<void> {
  await storageSet({ [STORAGE_KEYS.LAST_SESSION]: snapshot });
}

export async function getPreferredEditorId(): Promise<string> {
  const { [STORAGE_KEYS.PREFERRED_EDITOR]: editorId } = await storageGet([
    STORAGE_KEYS.PREFERRED_EDITOR
  ]);
  return normalizePreferredEditorId(editorId ?? DEFAULT_EDITOR_ID);
}

export async function setPreferredEditorId(editorId: string): Promise<void> {
  await storageSet({ [STORAGE_KEYS.PREFERRED_EDITOR]: editorId });
}

export async function getOrCreateExtensionClientId(
  createId: () => string = () => crypto.randomUUID()
): Promise<string> {
  const { [STORAGE_KEYS.EXTENSION_CLIENT_ID]: storedId } = await storageGet([
    STORAGE_KEYS.EXTENSION_CLIENT_ID
  ]);
  if (typeof storedId === "string" && storedId.trim()) {
    return storedId;
  }

  const clientId = createId();
  await storageSet({ [STORAGE_KEYS.EXTENSION_CLIENT_ID]: clientId });
  return clientId;
}
