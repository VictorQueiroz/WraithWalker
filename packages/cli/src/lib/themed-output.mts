import { ansi } from "./ansi.mjs";
import type { Output } from "./output.mjs";
import type { StyleToken, ThemeDefinition, ThemeStyles } from "./theme.mjs";

type ThemeFormatterMap = Record<keyof ThemeStyles, (value: string) => string>;

const STYLE_FORMATTERS: Record<StyleToken, (value: string) => string> = {
  bold: ansi.bold,
  dim: ansi.dim,
  black: ansi.black,
  red: ansi.red,
  green: ansi.green,
  yellow: ansi.yellow,
  blue: ansi.blue,
  magenta: ansi.magenta,
  cyan: ansi.cyan,
  white: ansi.white
};

function compileFormatter(tokens: StyleToken[]): (value: string) => string {
  return (value: string) => tokens.reduceRight(
    (rendered, token) => STYLE_FORMATTERS[token](rendered),
    value
  );
}

function compileThemeFormatters(styles: ThemeStyles): ThemeFormatterMap {
  return {
    success: compileFormatter(styles.success),
    error: compileFormatter(styles.error),
    warn: compileFormatter(styles.warn),
    heading: compileFormatter(styles.heading),
    label: compileFormatter(styles.label),
    muted: compileFormatter(styles.muted),
    accent: compileFormatter(styles.accent),
    usage: compileFormatter(styles.usage)
  };
}

export function createThemedOutput(theme: ThemeDefinition): Output {
  const { icons, indent, labelWidth, banner: bannerData } = theme;
  const palette = compileThemeFormatters(theme.styles);

  return {
    banner() {
      const phrase = bannerData.phrases[Math.floor(Math.random() * bannerData.phrases.length)];
      console.log();
      for (const line of bannerData.art) {
        console.log(palette.heading(line));
      }
      console.log();
      console.log(palette.accent(`  ${phrase}`));
      console.log();
    },
    success(message) {
      console.log(palette.success(`${indent}${icons.success} ${message}`));
    },
    error(message) {
      console.error(palette.error(`${indent}${icons.error} ${message}`));
    },
    warn(message) {
      console.error(palette.warn(`${indent}${icons.warn} ${message}`));
    },
    heading(message) {
      console.log(`\n${palette.heading(message)}`);
    },
    keyValue(key, value) {
      const padded = key.padEnd(labelWidth);
      console.log(`${indent}${palette.label(padded)} ${value}`);
    },
    info(message) {
      console.log(`${indent}${message}`);
    },
    listItem(item) {
      console.log(`${indent}${palette.muted(icons.bullet)} ${item}`);
    },
    block(content) {
      console.log(content);
    },
    usage(message) {
      console.error(palette.usage(message));
    }
  };
}
