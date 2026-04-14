export type StyleToken =
  | "bold"
  | "dim"
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white";

export interface ThemeStyles {
  success: StyleToken[];
  error: StyleToken[];
  warn: StyleToken[];
  heading: StyleToken[];
  label: StyleToken[];
  muted: StyleToken[];
  accent: StyleToken[];
  usage: StyleToken[];
}

export interface ThemeIcons {
  success: string;
  error: string;
  warn: string;
  bullet: string;
}

export interface ThemeBanner {
  art: string[];
  phrases: string[];
}

export interface ThemeDefinition {
  name: string;
  styles: ThemeStyles;
  icons: ThemeIcons;
  banner: ThemeBanner;
  indent: string;
  labelWidth: number;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export interface ThemeConfig {
  name?: string;
  overrides?: DeepPartial<Omit<ThemeDefinition, "name">>;
}

export interface ResolvedCliConfig {
  theme: ThemeDefinition;
}

export const STYLE_TOKENS: StyleToken[] = [
  "bold",
  "dim",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white"
];

export const THEME_STYLE_KEYS: Array<keyof ThemeStyles> = [
  "success",
  "error",
  "warn",
  "heading",
  "label",
  "muted",
  "accent",
  "usage"
];

export const THEME_ICON_KEYS: Array<keyof ThemeIcons> = [
  "success",
  "error",
  "warn",
  "bullet"
];

export function applyThemeOverrides(
  theme: ThemeDefinition,
  overrides?: ThemeConfig["overrides"]
): ThemeDefinition {
  if (!overrides) {
    return {
      ...theme,
      styles: { ...theme.styles },
      icons: { ...theme.icons },
      banner: {
        art: [...theme.banner.art],
        phrases: [...theme.banner.phrases]
      }
    };
  }

  return {
    ...theme,
    styles: {
      ...theme.styles,
      ...overrides.styles
    },
    icons: {
      ...theme.icons,
      ...overrides.icons
    },
    banner: {
      art: overrides.banner?.art
        ? [...overrides.banner.art]
        : [...theme.banner.art],
      phrases: overrides.banner?.phrases
        ? [...overrides.banner.phrases]
        : [...theme.banner.phrases]
    },
    indent: overrides.indent ?? theme.indent,
    labelWidth: overrides.labelWidth ?? theme.labelWidth
  };
}
