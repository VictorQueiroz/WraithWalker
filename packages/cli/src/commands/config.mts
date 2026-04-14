import {
  readConfiguredSiteConfigs,
  writeConfiguredSiteConfigs
} from "@wraithwalker/core/project-config";
import { createRoot } from "@wraithwalker/core/root";
import {
  createSiteConfig,
  DEFAULT_DUMP_ALLOWLIST_PATTERNS,
  isValidDumpAllowlistPattern,
  normalizeSiteConfig,
  normalizeSiteConfigs,
  type SiteConfig
} from "@wraithwalker/core/site-config";
import { findRoot } from "@wraithwalker/core/root";

import type { CommandSpec } from "../lib/command.mjs";
import { UsageError } from "../lib/command.mjs";
import { resolveServeRoot } from "../lib/serve-root.mjs";

type ConfigArgs =
  | { action: "list" }
  | { action: "get"; key: string }
  | { action: "set"; key: string; value: string }
  | { action: "add"; key: string; value?: string }
  | { action: "unset"; key: string };

type ConfigResult =
  | { action: "list"; lines: string[] }
  | { action: "get"; value: string }
  | { action: "set" | "add" | "unset"; message: string };

type ParsedConfigKey =
  | { kind: "sites" }
  | { kind: "site"; origin: string }
  | { kind: "site-patterns"; origin: string };

const SITE_KEY_PATTERN = /^site\."([^"]+)"(?:\.(dumpAllowlistPatterns))?$/;

function parseConfigKey(key: string): ParsedConfigKey {
  if (key === "sites") {
    return { kind: "sites" };
  }

  const match = key.match(SITE_KEY_PATTERN);
  if (!match) {
    throw new UsageError(`Unsupported config key: ${key}`);
  }

  const [, origin, field] = match;
  if (field === "dumpAllowlistPatterns") {
    return { kind: "site-patterns", origin };
  }
  return { kind: "site", origin };
}

function parseJson<T>(raw: string, errorPrefix: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(
      `${errorPrefix}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function sortSites(sites: SiteConfig[]): SiteConfig[] {
  return [...sites].sort((left, right) =>
    left.origin.localeCompare(right.origin)
  );
}

function findSiteIndex(sites: SiteConfig[], origin: string): number {
  return sites.findIndex((site) => site.origin === origin);
}

function requireSite(sites: SiteConfig[], origin: string): SiteConfig {
  const site = sites.find((candidate) => candidate.origin === origin);
  if (!site) {
    throw new Error(`No config entry found for ${origin}`);
  }
  return site;
}

function stringifyValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function resolveConfigRootPath(context: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
}): Promise<string> {
  const rootPath = await resolveServeRoot({
    cwd: context.cwd,
    env: context.env,
    platform: context.platform,
    homeDir: context.homeDir
  });
  await createRoot(rootPath);
  return rootPath;
}

export const command: CommandSpec<ConfigArgs, ConfigResult> = {
  name: "config",
  summary: "Read and write nearest-root WraithWalker config",
  usage: [
    "Usage: wraithwalker config {list|get|set|add|unset}",
    "",
    "Examples:",
    "  wraithwalker config list",
    '  wraithwalker config add site."https://app.example.com"',
    '  wraithwalker config add site."https://app.example.com".dumpAllowlistPatterns "\\\\.svg$"'
  ].join("\n"),
  parse(argv) {
    const [action, key, value] = argv;

    switch (action) {
      case "list":
        return { action: "list" };
      case "get":
        if (!key) {
          throw new UsageError("Usage: wraithwalker config get <key>");
        }
        return { action: "get", key };
      case "set":
        if (!key || value === undefined) {
          throw new UsageError("Usage: wraithwalker config set <key> <value>");
        }
        return { action: "set", key, value };
      case "add":
        if (!key) {
          throw new UsageError("Usage: wraithwalker config add <key> [value]");
        }
        return { action: "add", key, value };
      case "unset":
        if (!key) {
          throw new UsageError("Usage: wraithwalker config unset <key>");
        }
        return { action: "unset", key };
      default:
        throw new UsageError(
          [
            "Usage: wraithwalker config {list|get|set|add|unset}",
            "",
            "Examples:",
            '  wraithwalker config add site."https://app.example.com"',
            '  wraithwalker config add site."https://app.example.com".dumpAllowlistPatterns "\\\\.svg$"'
          ].join("\n")
        );
    }
  },
  async execute(context, args) {
    const rootPath = await resolveConfigRootPath(context);
    const explicitSites = await readConfiguredSiteConfigs(rootPath);

    switch (args.action) {
      case "list": {
        if (explicitSites.length === 0) {
          return { action: "list", lines: ["sites=[]"] };
        }

        const lines = sortSites(explicitSites).flatMap((site) => [
          `site."${site.origin}".dumpAllowlistPatterns=${JSON.stringify(site.dumpAllowlistPatterns)}`
        ]);
        return { action: "list", lines };
      }
      case "get": {
        const key = parseConfigKey(args.key);
        switch (key.kind) {
          case "sites":
            return {
              action: "get",
              value: stringifyValue(sortSites(explicitSites))
            };
          case "site":
            return {
              action: "get",
              value: stringifyValue(requireSite(explicitSites, key.origin))
            };
          case "site-patterns":
            return {
              action: "get",
              value: stringifyValue(
                requireSite(explicitSites, key.origin).dumpAllowlistPatterns
              )
            };
        }
      }
      case "set": {
        const key = parseConfigKey(args.key);

        switch (key.kind) {
          case "sites": {
            const nextSites = normalizeSiteConfigs(
              parseJson<Array<Partial<SiteConfig> & { origin: string }>>(
                args.value,
                "sites must be a JSON array"
              ) as Array<Partial<SiteConfig> & { origin: string }>
            );
            await writeConfiguredSiteConfigs(rootPath, nextSites);
            return {
              action: "set",
              message: `Updated ${nextSites.length} site entries.`
            };
          }
          case "site": {
            const parsed = parseJson<Partial<SiteConfig> & { origin?: string }>(
              args.value,
              `site "${key.origin}" must be a JSON object`
            );
            const nextSite = normalizeSiteConfig({
              ...parsed,
              origin: key.origin
            } as Partial<SiteConfig> & { origin: string });
            const nextSites = sortSites([
              ...explicitSites.filter(
                (site) => site.origin !== nextSite.origin
              ),
              nextSite
            ]);
            await writeConfiguredSiteConfigs(rootPath, nextSites);
            return { action: "set", message: `Configured ${nextSite.origin}.` };
          }
          case "site-patterns": {
            const patterns = parseJson<string[]>(
              args.value,
              `dumpAllowlistPatterns for "${key.origin}" must be a JSON array of regex strings`
            );
            const origin = normalizeSiteConfig({ origin: key.origin }).origin;
            const existing =
              explicitSites[findSiteIndex(explicitSites, origin)] ??
              createSiteConfig(origin);
            const nextSite = normalizeSiteConfig({
              ...existing,
              dumpAllowlistPatterns: patterns
            });
            const nextSites = sortSites([
              ...explicitSites.filter((site) => site.origin !== origin),
              nextSite
            ]);
            await writeConfiguredSiteConfigs(rootPath, nextSites);
            return {
              action: "set",
              message: `Replaced dump patterns for ${origin}.`
            };
          }
        }
      }
      case "add": {
        const key = parseConfigKey(args.key);
        switch (key.kind) {
          case "sites":
            throw new UsageError(
              "Use `wraithwalker config set sites '<json-array>'` to replace all sites."
            );
          case "site": {
            const origin = normalizeSiteConfig({ origin: key.origin }).origin;
            if (!explicitSites.some((site) => site.origin === origin)) {
              await writeConfiguredSiteConfigs(
                rootPath,
                sortSites([...explicitSites, createSiteConfig(origin)])
              );
            }
            return {
              action: "add",
              message: `Ensured config entry for ${origin}.`
            };
          }
          case "site-patterns": {
            if (!args.value) {
              throw new UsageError(
                'Usage: wraithwalker config add site."<origin>".dumpAllowlistPatterns <regex>'
              );
            }
            if (!isValidDumpAllowlistPattern(args.value)) {
              throw new Error(`Invalid regular expression: ${args.value}`);
            }

            const origin = normalizeSiteConfig({ origin: key.origin }).origin;
            const existing =
              explicitSites[findSiteIndex(explicitSites, origin)] ??
              createSiteConfig(origin);
            const nextPatterns = existing.dumpAllowlistPatterns.includes(
              args.value
            )
              ? existing.dumpAllowlistPatterns
              : [...existing.dumpAllowlistPatterns, args.value];
            const nextSite = {
              ...existing,
              dumpAllowlistPatterns: nextPatterns
            };
            const nextSites = sortSites([
              ...explicitSites.filter((site) => site.origin !== origin),
              nextSite
            ]);
            await writeConfiguredSiteConfigs(rootPath, nextSites);
            return {
              action: "add",
              message: `Added dump pattern for ${origin}.`
            };
          }
        }
      }
      case "unset": {
        const key = parseConfigKey(args.key);
        switch (key.kind) {
          case "sites":
            await writeConfiguredSiteConfigs(rootPath, []);
            return {
              action: "unset",
              message: "Cleared all explicit site config entries."
            };
          case "site": {
            const origin = normalizeSiteConfig({ origin: key.origin }).origin;
            if (!explicitSites.some((site) => site.origin === origin)) {
              throw new Error(`No config entry found for ${origin}`);
            }
            await writeConfiguredSiteConfigs(
              rootPath,
              explicitSites.filter((site) => site.origin !== origin)
            );
            return { action: "unset", message: `Removed ${origin}.` };
          }
          case "site-patterns": {
            const origin = normalizeSiteConfig({ origin: key.origin }).origin;
            const site = requireSite(explicitSites, origin);
            await writeConfiguredSiteConfigs(
              rootPath,
              sortSites([
                ...explicitSites.filter(
                  (candidate) => candidate.origin !== origin
                ),
                {
                  ...site,
                  dumpAllowlistPatterns: [...DEFAULT_DUMP_ALLOWLIST_PATTERNS]
                }
              ])
            );
            return {
              action: "unset",
              message: `Reset dump patterns for ${origin}.`
            };
          }
        }
      }
    }
  },
  render(output, result) {
    switch (result.action) {
      case "list":
        output.block(result.lines.join("\n"));
        return;
      case "get":
        output.block(result.value);
        return;
      case "set":
      case "add":
      case "unset":
        output.success(result.message);
    }
  }
};
