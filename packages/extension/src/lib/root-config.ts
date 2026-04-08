import type { BackgroundMessage, SiteConfigsResult } from "./messages.js";
import { normalizeSiteConfigs } from "./site-config.js";
import type { SiteConfig } from "./types.js";

interface RuntimeApi {
  sendMessage(message: BackgroundMessage): Promise<unknown>;
}

function sendMessage<T>(runtime: RuntimeApi, message: BackgroundMessage): Promise<T> {
  return runtime.sendMessage(message) as Promise<T>;
}

function isRootConfigUnavailable(message: string): boolean {
  return message === "No root directory selected."
    || message === "Root directory access is not granted.";
}

async function readSiteConfigs(
  runtime: RuntimeApi,
  message: Extract<BackgroundMessage, { type: "config.readConfiguredSiteConfigs" | "config.readEffectiveSiteConfigs" }>
): Promise<SiteConfig[]> {
  const result = await sendMessage<SiteConfigsResult>(runtime, message);
  if (!result) {
    return [];
  }

  if (result.ok === true) {
    if (!Array.isArray(result.siteConfigs)) {
      return [];
    }

    return normalizeSiteConfigs(result.siteConfigs);
  }

  if (isRootConfigUnavailable(result.error)) {
    return [];
  }

  throw new Error(result.error);
}

export async function getConfiguredSiteConfigs(
  runtime: RuntimeApi = chrome.runtime as unknown as RuntimeApi
): Promise<SiteConfig[]> {
  return readSiteConfigs(runtime, { type: "config.readConfiguredSiteConfigs" });
}

export async function getEffectiveSiteConfigs(
  runtime: RuntimeApi = chrome.runtime as unknown as RuntimeApi
): Promise<SiteConfig[]> {
  return readSiteConfigs(runtime, { type: "config.readEffectiveSiteConfigs" });
}

export async function setConfiguredSiteConfigs(
  siteConfigs: SiteConfig[],
  runtime: RuntimeApi = chrome.runtime as unknown as RuntimeApi
): Promise<void> {
  const result = await sendMessage<SiteConfigsResult>(runtime, {
    type: "config.writeConfiguredSiteConfigs",
    siteConfigs
  });
  if (!result) {
    throw new Error("Failed to update root config.");
  }

  if (result.ok === true) {
    return;
  }

  throw new Error(result.error);
}
