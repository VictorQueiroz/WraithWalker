import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyThemeOverrides,
  STYLE_TOKENS,
  THEME_ICON_KEYS,
  THEME_STYLE_KEYS,
  type ResolvedCliConfig,
  type StyleToken,
  type ThemeConfig,
  type ThemeDefinition
} from "./theme.mjs";
import { wraithwalkerTheme } from "./wraithwalker-theme.mjs";

export interface CliConfig {
  theme?: ThemeConfig;
}

const BUILTIN_THEMES = new Map<string, ThemeDefinition>([
  [wraithwalkerTheme.name, wraithwalkerTheme]
]);

function formatConfigError(filePath: string, message: string): Error {
  return new Error(`Invalid CLI config at ${filePath}: ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateStyleTokens(value: unknown, filePath: string, key: string): StyleToken[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw formatConfigError(filePath, `theme.overrides.styles.${key} must be an array of style tokens.`);
  }

  const invalid = value.filter((item) => !STYLE_TOKENS.includes(item as StyleToken));
  if (invalid.length > 0) {
    throw formatConfigError(
      filePath,
      `theme.overrides.styles.${key} contains unsupported tokens: ${invalid.join(", ")}.`
    );
  }

  return value as StyleToken[];
}

function validateThemeConfig(theme: unknown, filePath: string): ThemeConfig {
  if (!isPlainObject(theme)) {
    throw formatConfigError(filePath, "theme must be an object.");
  }

  const themeConfig: ThemeConfig = {};

  if ("name" in theme) {
    if (theme.name !== undefined && typeof theme.name !== "string") {
      throw formatConfigError(filePath, "theme.name must be a string.");
    }
    if (typeof theme.name === "string" && !BUILTIN_THEMES.has(theme.name)) {
      throw formatConfigError(filePath, `unknown theme "${theme.name}".`);
    }
    themeConfig.name = theme.name as string | undefined;
  }

  if ("overrides" in theme) {
    if (theme.overrides !== undefined && !isPlainObject(theme.overrides)) {
      throw formatConfigError(filePath, "theme.overrides must be an object.");
    }

    if (isPlainObject(theme.overrides)) {
      const overrides: NonNullable<ThemeConfig["overrides"]> = {};

      if ("styles" in theme.overrides) {
        if (theme.overrides.styles !== undefined && !isPlainObject(theme.overrides.styles)) {
          throw formatConfigError(filePath, "theme.overrides.styles must be an object.");
        }
        if (isPlainObject(theme.overrides.styles)) {
          overrides.styles = {};
          for (const key of Object.keys(theme.overrides.styles)) {
            if (!THEME_STYLE_KEYS.some((allowedKey) => allowedKey === key)) {
              throw formatConfigError(filePath, `theme.overrides.styles.${key} is not supported.`);
            }
          }
          for (const key of THEME_STYLE_KEYS) {
            const value = theme.overrides.styles[key];
            if (value !== undefined) {
              overrides.styles[key] = validateStyleTokens(value, filePath, key);
            }
          }
        }
      }

      if ("icons" in theme.overrides) {
        if (theme.overrides.icons !== undefined && !isPlainObject(theme.overrides.icons)) {
          throw formatConfigError(filePath, "theme.overrides.icons must be an object.");
        }
        if (isPlainObject(theme.overrides.icons)) {
          overrides.icons = {};
          for (const key of Object.keys(theme.overrides.icons)) {
            if (!THEME_ICON_KEYS.some((allowedKey) => allowedKey === key)) {
              throw formatConfigError(filePath, `theme.overrides.icons.${key} is not supported.`);
            }
          }
          for (const key of THEME_ICON_KEYS) {
            const value = theme.overrides.icons[key];
            if (value !== undefined) {
              if (typeof value !== "string") {
                throw formatConfigError(filePath, `theme.overrides.icons.${key} must be a string.`);
              }
              overrides.icons[key] = value;
            }
          }
        }
      }

      if ("banner" in theme.overrides) {
        if (theme.overrides.banner !== undefined && !isPlainObject(theme.overrides.banner)) {
          throw formatConfigError(filePath, "theme.overrides.banner must be an object.");
        }
        if (isPlainObject(theme.overrides.banner)) {
          overrides.banner = {};
          if (theme.overrides.banner.art !== undefined) {
            if (!Array.isArray(theme.overrides.banner.art) || !theme.overrides.banner.art.every((item) => typeof item === "string")) {
              throw formatConfigError(filePath, "theme.overrides.banner.art must be an array of strings.");
            }
            overrides.banner.art = theme.overrides.banner.art;
          }
          if (theme.overrides.banner.phrases !== undefined) {
            if (!Array.isArray(theme.overrides.banner.phrases) || !theme.overrides.banner.phrases.every((item) => typeof item === "string")) {
              throw formatConfigError(filePath, "theme.overrides.banner.phrases must be an array of strings.");
            }
            overrides.banner.phrases = theme.overrides.banner.phrases;
          }
        }
      }

      if ("indent" in theme.overrides) {
        if (theme.overrides.indent !== undefined && typeof theme.overrides.indent !== "string") {
          throw formatConfigError(filePath, "theme.overrides.indent must be a string.");
        }
        overrides.indent = theme.overrides.indent as string | undefined;
      }

      if ("labelWidth" in theme.overrides) {
        if (
          theme.overrides.labelWidth !== undefined
          && (!Number.isInteger(theme.overrides.labelWidth) || Number(theme.overrides.labelWidth) < 0)
        ) {
          throw formatConfigError(filePath, "theme.overrides.labelWidth must be a non-negative integer.");
        }
        overrides.labelWidth = theme.overrides.labelWidth as number | undefined;
      }

      themeConfig.overrides = overrides;
    }
  }

  return themeConfig;
}

function validateCliConfig(config: unknown, filePath: string): CliConfig {
  if (!isPlainObject(config)) {
    throw formatConfigError(filePath, "config root must be an object.");
  }

  const validated: CliConfig = {};
  for (const key of Object.keys(config)) {
    if (key !== "theme") {
      throw formatConfigError(filePath, `unsupported top-level key "${key}".`);
    }
  }

  if ("theme" in config && config.theme !== undefined) {
    validated.theme = validateThemeConfig(config.theme, filePath);
  }

  return validated;
}

async function loadCliConfigFile(filePath: string): Promise<CliConfig> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw formatConfigError(filePath, error instanceof Error ? error.message : String(error));
    }
    return validateCliConfig(parsed, filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function mergeThemeConfig(base?: ThemeConfig, override?: ThemeConfig): ThemeConfig | undefined {
  if (!base && !override) {
    return undefined;
  }

  const merged: ThemeConfig = {
    name: override?.name ?? base?.name
  };

  const baseOverrides = base?.overrides || {};
  const overrideOverrides = override?.overrides || {};
  const styles = {
    ...baseOverrides.styles,
    ...overrideOverrides.styles
  };
  const icons = {
    ...baseOverrides.icons,
    ...overrideOverrides.icons
  };
  const banner = {
    art: overrideOverrides.banner?.art ?? baseOverrides.banner?.art,
    phrases: overrideOverrides.banner?.phrases ?? baseOverrides.banner?.phrases
  };

  const hasBanner = banner.art !== undefined || banner.phrases !== undefined;
  const hasStyles = Object.keys(styles).length > 0;
  const hasIcons = Object.keys(icons).length > 0;
  const hasScalarOverrides = overrideOverrides.indent !== undefined
    || baseOverrides.indent !== undefined
    || overrideOverrides.labelWidth !== undefined
    || baseOverrides.labelWidth !== undefined;

  if (hasBanner || hasStyles || hasIcons || hasScalarOverrides) {
    merged.overrides = {
      ...(hasStyles ? { styles } : {}),
      ...(hasIcons ? { icons } : {}),
      ...(hasBanner ? { banner } : {}),
      indent: overrideOverrides.indent ?? baseOverrides.indent,
      labelWidth: overrideOverrides.labelWidth ?? baseOverrides.labelWidth
    };
  }

  return merged;
}

export function getGlobalConfigPath({
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir()
}: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
} = {}): string {
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "WraithWalker", "config.json");
  }

  if (platform === "win32") {
    const appData = env["APPDATA"] || path.join(homeDir, "AppData", "Roaming");
    return path.join(appData, "WraithWalker", "config.json");
  }

  const xdgConfigHome = env["XDG_CONFIG_HOME"] || path.join(homeDir, ".config");
  return path.join(xdgConfigHome, "wraithwalker", "config.json");
}

export function getProjectConfigPath(rootPath: string): string {
  return path.join(rootPath, ".wraithwalker", "cli.json");
}

export async function loadGlobalCliConfig(options?: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): Promise<CliConfig> {
  return loadCliConfigFile(getGlobalConfigPath(options));
}

export async function loadProjectCliConfig(rootPath: string): Promise<CliConfig> {
  return loadCliConfigFile(getProjectConfigPath(rootPath));
}

export function mergeCliConfigs(base: CliConfig, override: CliConfig): CliConfig {
  return {
    theme: mergeThemeConfig(base.theme, override.theme)
  };
}

export function resolveCliConfig(config: CliConfig): ResolvedCliConfig {
  const themeName = config.theme?.name || wraithwalkerTheme.name;
  const baseTheme = BUILTIN_THEMES.get(themeName);
  if (!baseTheme) {
    throw new Error(`Unknown theme "${themeName}".`);
  }

  return {
    theme: applyThemeOverrides(baseTheme, config.theme?.overrides)
  };
}
