import { normalizeSiteInput } from "@wraithwalker/core/fixture-layout";
import {
  createConfiguredSiteConfig,
  isValidDumpAllowlistPattern,
  normalizeDumpAllowlistPatterns,
  normalizeSiteConfigs,
  type SiteConfig
} from "@wraithwalker/core/site-config";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { createExtensionSessionTracker } from "./extension-session.mjs";
import type { createServerRootRuntime } from "./root-runtime.mjs";
import { renderErrorMessage, renderJson } from "./server-responses.mjs";

function sortSiteConfigs(siteConfigs: SiteConfig[]): SiteConfig[] {
  return [...siteConfigs].sort((left, right) =>
    left.origin.localeCompare(right.origin)
  );
}

function replaceSiteConfig(
  siteConfigs: SiteConfig[],
  nextSiteConfig: SiteConfig
): SiteConfig[] {
  return normalizeSiteConfigs([
    ...siteConfigs.filter(
      (siteConfig) => siteConfig.origin !== nextSiteConfig.origin
    ),
    nextSiteConfig
  ]);
}

function renderInvalidPatternError(pattern: string) {
  return renderErrorMessage(`Invalid dump allowlist pattern: ${pattern}`);
}

function getPrepareGuidance({
  connected,
  sessionActive,
  originReady
}: {
  connected: boolean;
  sessionActive: boolean;
  originReady: boolean;
}): string {
  if (originReady) {
    return "Capture is ready for this origin.";
  }

  if (!connected) {
    return "The site is configured in the current root, but no browser extension is connected to this local server yet.";
  }

  if (!sessionActive) {
    return "The site is configured, but the browser session is inactive. Start the session in the extension, then poll browser-status or prepare-site-for-capture again.";
  }

  return "The site is configured, but the extension has not reported this origin as ready yet. Wait for the next heartbeat, then poll browser-status again.";
}

export function registerSiteConfigTools(
  server: McpServer,
  {
    runtime,
    extensionSessions
  }: {
    runtime: ReturnType<typeof createServerRootRuntime>;
    extensionSessions: ReturnType<typeof createExtensionSessionTracker>;
  }
): void {
  async function readConfiguredSiteConfigs(): Promise<SiteConfig[]> {
    return normalizeSiteConfigs(await runtime.readConfiguredSiteConfigs());
  }

  server.tool(
    "list-configured-sites",
    "List the explicit site config entries stored in the current WraithWalker root",
    {
      search: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional case-insensitive origin substring filter")
    },
    async ({ search }) => {
      const normalizedSearch = search?.toLowerCase();
      const siteConfigs = await readConfiguredSiteConfigs();

      return renderJson(
        siteConfigs.filter(
          (siteConfig) =>
            !normalizedSearch ||
            siteConfig.origin.toLowerCase().includes(normalizedSearch)
        )
      );
    }
  );

  server.tool(
    "whitelist-site",
    "Ensure an origin is explicitly configured in the current root using the agent-friendly default capture patterns",
    {
      origin: z
        .string()
        .describe("Origin to whitelist (for example https://app.example.com)")
    },
    async ({ origin }) => {
      let normalizedOrigin: string;
      try {
        normalizedOrigin = normalizeSiteInput(origin);
      } catch (error) {
        return renderErrorMessage(
          error instanceof Error ? error.message : String(error)
        );
      }

      const siteConfigs = await readConfiguredSiteConfigs();
      const existing = siteConfigs.find(
        (siteConfig) => siteConfig.origin === normalizedOrigin
      );
      if (existing) {
        return renderJson({
          changed: false,
          siteConfig: existing,
          configuredSites: sortSiteConfigs(siteConfigs)
        });
      }

      const nextSiteConfig = createConfiguredSiteConfig(normalizedOrigin);
      const nextSiteConfigs = replaceSiteConfig(siteConfigs, nextSiteConfig);
      await runtime.writeConfiguredSiteConfigs(nextSiteConfigs);

      return renderJson({
        changed: true,
        siteConfig: nextSiteConfig,
        configuredSites: nextSiteConfigs
      });
    }
  );

  server.tool(
    "remove-site",
    "Remove an explicit site config entry from the current WraithWalker root",
    {
      origin: z
        .string()
        .describe("Origin to remove from the configured site list")
    },
    async ({ origin }) => {
      let normalizedOrigin: string;
      try {
        normalizedOrigin = normalizeSiteInput(origin);
      } catch (error) {
        return renderErrorMessage(
          error instanceof Error ? error.message : String(error)
        );
      }

      const siteConfigs = await readConfiguredSiteConfigs();
      const existing = siteConfigs.find(
        (siteConfig) => siteConfig.origin === normalizedOrigin
      );
      if (!existing) {
        return renderJson({
          changed: false,
          removedOrigin: normalizedOrigin,
          configuredSites: sortSiteConfigs(siteConfigs)
        });
      }

      const nextSiteConfigs = siteConfigs.filter(
        (siteConfig) => siteConfig.origin !== normalizedOrigin
      );
      await runtime.writeConfiguredSiteConfigs(nextSiteConfigs);

      return renderJson({
        changed: true,
        removedOrigin: normalizedOrigin,
        configuredSites: nextSiteConfigs
      });
    }
  );

  server.tool(
    "update-site-patterns",
    "Replace, append, or reset dump allowlist patterns for an explicitly configured origin",
    {
      origin: z.string().describe("Configured origin to update"),
      mode: z
        .enum(["replace", "append", "reset"])
        .optional()
        .describe("How to apply dumpPatterns; defaults to replace"),
      dumpPatterns: z
        .array(z.string())
        .optional()
        .describe("Regex patterns used when mode is replace or append")
    },
    async ({ origin, mode = "replace", dumpPatterns }) => {
      let normalizedOrigin: string;
      try {
        normalizedOrigin = normalizeSiteInput(origin);
      } catch (error) {
        return renderErrorMessage(
          error instanceof Error ? error.message : String(error)
        );
      }

      const siteConfigs = await readConfiguredSiteConfigs();
      const existing = siteConfigs.find(
        (siteConfig) => siteConfig.origin === normalizedOrigin
      );
      if (!existing) {
        return renderErrorMessage(
          `Origin "${normalizedOrigin}" is not explicitly configured. Call whitelist-site first.`
        );
      }

      if (mode !== "reset" && (!dumpPatterns || dumpPatterns.length === 0)) {
        return renderErrorMessage(
          "dumpPatterns is required when mode is replace or append."
        );
      }

      if (dumpPatterns) {
        for (const pattern of dumpPatterns) {
          if (
            typeof pattern !== "string" ||
            !pattern.trim() ||
            !isValidDumpAllowlistPattern(pattern)
          ) {
            return renderInvalidPatternError(String(pattern));
          }
        }
      }

      const nextPatterns =
        mode === "reset"
          ? createConfiguredSiteConfig(normalizedOrigin).dumpAllowlistPatterns
          : mode === "append"
            ? [
                ...new Set([
                  ...existing.dumpAllowlistPatterns,
                  ...(dumpPatterns ?? [])
                ])
              ]
            : normalizeDumpAllowlistPatterns(dumpPatterns ?? []);

      const nextSiteConfig: SiteConfig = {
        ...existing,
        dumpAllowlistPatterns: nextPatterns
      };
      const nextSiteConfigs = replaceSiteConfig(siteConfigs, nextSiteConfig);
      await runtime.writeConfiguredSiteConfigs(nextSiteConfigs);

      return renderJson({
        changed:
          JSON.stringify(existing.dumpAllowlistPatterns) !==
          JSON.stringify(nextPatterns),
        siteConfig: nextSiteConfig,
        configuredSites: nextSiteConfigs
      });
    }
  );

  server.tool(
    "prepare-site-for-capture",
    "Ensure an origin is configured in the current root and report whether the connected extension is ready to capture it",
    {
      origin: z.string().describe("Origin to prepare for capture")
    },
    async ({ origin }) => {
      let normalizedOrigin: string;
      try {
        normalizedOrigin = normalizeSiteInput(origin);
      } catch (error) {
        return renderErrorMessage(
          error instanceof Error ? error.message : String(error)
        );
      }

      const configuredSiteConfigs = await readConfiguredSiteConfigs();
      const existing = configuredSiteConfigs.find(
        (siteConfig) => siteConfig.origin === normalizedOrigin
      );
      const nextConfiguredSite =
        existing ?? createConfiguredSiteConfig(normalizedOrigin);
      const changed = !existing;

      if (changed) {
        await runtime.writeConfiguredSiteConfigs(
          replaceSiteConfig(configuredSiteConfigs, nextConfiguredSite)
        );
      }

      const status = await extensionSessions.getStatus();
      const originReady =
        status.connected &&
        status.sessionActive &&
        status.enabledOrigins.includes(normalizedOrigin);

      return renderJson({
        changed,
        origin: normalizedOrigin,
        siteConfig: nextConfiguredSite,
        connected: status.connected,
        sessionActive: status.sessionActive,
        captureReady: originReady,
        enabledOrigins: status.enabledOrigins,
        nextAction: originReady
          ? "ready"
          : !status.connected
            ? "connect_extension"
            : !status.sessionActive
              ? "start_extension_session"
              : "wait_for_extension_refresh",
        guidance: getPrepareGuidance({
          connected: status.connected,
          sessionActive: status.sessionActive,
          originReady
        })
      });
    }
  );
}
