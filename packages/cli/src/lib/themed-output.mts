import type { HarImportEvent } from "@wraithwalker/core/har-import";

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
  return (value: string) =>
    tokens.reduceRight(
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

function renderProgressBar(
  current: number,
  total: number,
  width: number
): string {
  const safeTotal = Math.max(total, 1);
  const ratio = Math.min(1, Math.max(0, current / safeTotal));
  const filled = Math.round(ratio * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

export function createThemedOutput(
  theme: ThemeDefinition,
  { isTTY = false }: { isTTY?: boolean } = {}
): Output {
  const { icons, indent, labelWidth, banner: bannerData } = theme;
  const palette = compileThemeFormatters(theme.styles);
  const interactiveProgress = isTTY;
  let progressLineActive = false;

  function clearProgressLine() {
    if (!interactiveProgress || !progressLineActive) {
      return;
    }

    process.stdout.write("\r\x1b[2K");
    progressLineActive = false;
  }

  function writeProgressLine(
    event: Extract<HarImportEvent, { type: "entry-start" | "entry-progress" }>
  ) {
    const overallBar = renderProgressBar(
      event.completedEntries,
      event.totalEntries,
      12
    );
    const fileBar = renderProgressBar(event.writtenBytes, event.totalBytes, 10);
    const requestLabel =
      event.requestUrl.length > 48
        ? `${event.requestUrl.slice(0, 45)}...`
        : event.requestUrl;

    process.stdout.write(
      `\r\x1b[2K${palette.accent(`${indent}${overallBar} ${event.completedEntries}/${event.totalEntries}`)}` +
        ` ${palette.muted("|")}` +
        ` ${palette.heading(`${fileBar} ${requestLabel}`)}`
    );
    progressLineActive = true;
  }

  return {
    banner() {
      clearProgressLine();
      const phrase =
        bannerData.phrases[
          Math.floor(Math.random() * bannerData.phrases.length)
        ];
      console.log();
      for (const line of bannerData.art) {
        console.log(palette.heading(line));
      }
      console.log();
      console.log(palette.accent(`  ${phrase}`));
      console.log();
    },
    success(message) {
      clearProgressLine();
      console.log(palette.success(`${indent}${icons.success} ${message}`));
    },
    error(message) {
      clearProgressLine();
      console.error(palette.error(`${indent}${icons.error} ${message}`));
    },
    warn(message) {
      clearProgressLine();
      console.error(palette.warn(`${indent}${icons.warn} ${message}`));
    },
    heading(message) {
      clearProgressLine();
      console.log(`\n${palette.heading(message)}`);
    },
    keyValue(key, value) {
      clearProgressLine();
      const padded = key.padEnd(labelWidth);
      console.log(`${indent}${palette.label(padded)} ${value}`);
    },
    info(message) {
      clearProgressLine();
      console.log(`${indent}${message}`);
    },
    listItem(item) {
      clearProgressLine();
      console.log(`${indent}${palette.muted(icons.bullet)} ${item}`);
    },
    block(content) {
      clearProgressLine();
      console.log(content);
    },
    usage(message) {
      clearProgressLine();
      console.error(palette.usage(message));
    },
    renderImportProgress(event: HarImportEvent) {
      if (!interactiveProgress) {
        if (event.type === "entry-complete") {
          console.log(
            palette.success(
              `${indent}${icons.success} Imported ${event.bodyPath}`
            )
          );
        }

        if (event.type === "entry-skipped") {
          console.log(
            palette.warn(
              `${indent}${icons.warn} Skipped [${event.method}] ${event.requestUrl}: ${event.reason}`
            )
          );
        }
        return;
      }

      if (event.type === "entry-start" || event.type === "entry-progress") {
        writeProgressLine(event);
        return;
      }

      clearProgressLine();

      if (event.type === "entry-complete") {
        console.log(
          palette.success(
            `${indent}${icons.success} Imported ${event.bodyPath}`
          )
        );
      }

      if (event.type === "entry-skipped") {
        console.log(
          palette.warn(
            `${indent}${icons.warn} Skipped [${event.method}] ${event.requestUrl}: ${event.reason}`
          )
        );
      }
    }
  };
}
