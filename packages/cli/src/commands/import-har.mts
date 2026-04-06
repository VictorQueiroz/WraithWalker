import path from "node:path";

import { importHarFile, type ImportHarFileResult } from "@wraithwalker/core/har-import";

import type { CommandSpec } from "../lib/command.mjs";
import { UsageError } from "../lib/command.mjs";

interface ImportHarArgs {
  harFile: string;
  dir?: string;
  topOrigin?: string;
}

function groupSkipReasons(result: ImportHarFileResult): Array<[string, number]> {
  const counts = new Map<string, number>();

  for (const skipped of result.skipped) {
    counts.set(skipped.reason, (counts.get(skipped.reason) || 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

export const command: CommandSpec<ImportHarArgs, ImportHarFileResult> = {
  name: "import-har",
  summary: "Populate a fixture root from a HAR file",
  usage: "Usage: wraithwalker import-har <har-file> [dir] [--top-origin <origin>]",
  parse(argv) {
    let topOrigin: string | undefined;
    const positionals: string[] = [];

    for (let index = 0; index < argv.length; index++) {
      const arg = argv[index];
      if (arg === "--top-origin") {
        topOrigin = argv[index + 1];
        if (!topOrigin) {
          throw new UsageError("Usage: wraithwalker import-har <har-file> [dir] [--top-origin <origin>]");
        }
        index++;
        continue;
      }

      positionals.push(arg);
    }

    if (!positionals[0] || positionals.length > 2) {
      throw new UsageError("Usage: wraithwalker import-har <har-file> [dir] [--top-origin <origin>]");
    }

    return {
      harFile: positionals[0],
      dir: positionals[1],
      topOrigin
    };
  },
  async execute(context, args) {
    return importHarFile({
      harPath: path.resolve(context.cwd, args.harFile),
      dir: path.resolve(context.cwd, args.dir || "."),
      topOrigin: args.topOrigin,
      onEvent(event) {
        context.output.renderImportProgress(event);
      }
    });
  },
  render(output, result) {
    const topOrigins = result.topOrigins.length > 0 ? result.topOrigins : [result.topOrigin];

    output.success(`Imported HAR into ${result.dir}`);
    if (topOrigins.length === 1) {
      output.keyValue("Top Origin", topOrigins[0]);
    } else {
      output.keyValue("Top Origins", topOrigins.length);
      output.heading("Origins");
      for (const topOrigin of topOrigins) {
        output.listItem(topOrigin);
      }
    }
    output.keyValue("Imported", result.imported.length);
    output.keyValue("Skipped", result.skipped.length);

    const skipReasons = groupSkipReasons(result);
    if (skipReasons.length > 0) {
      output.heading("Skip Reasons");
      for (const [reason, count] of skipReasons) {
        output.listItem(`${count} x ${reason}`);
      }
    }
  }
};
