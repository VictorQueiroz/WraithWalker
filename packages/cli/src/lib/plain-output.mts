import type { HarImportEvent } from "@wraithwalker/core/har-import";

import type { Output } from "./output.mjs";
import type { ThemeDefinition } from "./theme.mjs";

export function createPlainOutput(theme: ThemeDefinition): Output {
  const { banner: bannerData, labelWidth } = theme;

  return {
    banner() {
      const phrase =
        bannerData.phrases[
          Math.floor(Math.random() * bannerData.phrases.length)
        ];
      console.log();
      for (const line of bannerData.art) {
        console.log(line);
      }
      console.log();
      console.log(`  ${phrase}`);
      console.log();
    },
    success(message) {
      console.log(message);
    },
    error(message) {
      console.error(message);
    },
    warn(message) {
      console.error(message);
    },
    heading(message) {
      console.log(message);
    },
    keyValue(key, value) {
      console.log(`${key.padEnd(labelWidth)} ${value}`);
    },
    info(message) {
      console.log(message);
    },
    listItem(item) {
      console.log(`  ${item}`);
    },
    block(content) {
      console.log(content);
    },
    usage(message) {
      console.error(message);
    },
    renderImportProgress(event: HarImportEvent) {
      if (event.type === "entry-complete") {
        console.log(`Imported ${event.bodyPath}`);
      }

      if (event.type === "entry-skipped") {
        console.log(
          `Skipped [${event.method}] ${event.requestUrl}: ${event.reason}`
        );
      }
    }
  };
}
