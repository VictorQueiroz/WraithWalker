import type { Output } from "./output.mjs";
import type { Theme } from "./theme.mjs";

export function createThemedOutput(theme: Theme): Output {
  const { palette, icons, indent, labelWidth } = theme;

  return {
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
    },
  };
}
