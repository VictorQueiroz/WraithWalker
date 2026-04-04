import { ansi } from "./ansi.mjs";
import type { Output } from "./output.mjs";

export function createThemedOutput(): Output {
  return {
    success(message) {
      console.log(ansi.green(`  \u2714 ${message}`));
    },
    error(message) {
      console.error(ansi.red(`  \u2716 ${message}`));
    },
    warn(message) {
      console.error(ansi.yellow(`  \u26A0 ${message}`));
    },
    heading(message) {
      console.log(`\n${ansi.bold(ansi.underline(message))}`);
    },
    keyValue(key, value) {
      const padded = key.padEnd(12);
      console.log(`  ${ansi.cyan(padded)} ${value}`);
    },
    info(message) {
      console.log(`  ${message}`);
    },
    listItem(item) {
      console.log(`  ${ansi.dim("\u2022")} ${item}`);
    },
    block(content) {
      console.log(content);
    },
    usage(message) {
      console.error(ansi.gray(message));
    },
  };
}
