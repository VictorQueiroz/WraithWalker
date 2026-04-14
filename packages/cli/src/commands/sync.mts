import path from "node:path";

import {
  importHarFile,
  type ImportHarFileResult
} from "@wraithwalker/core/har-import";
import {
  syncOverridesDirectory,
  type SyncOverridesDirectoryResult
} from "@wraithwalker/core/overrides-sync";

import type { CommandSpec } from "../lib/command.mjs";
import { UsageError } from "../lib/command.mjs";

interface SyncArgs {
  dir?: string;
  harFile?: string;
  topOrigin?: string;
}

type SyncCommandResult =
  | ({ source: "har" } & ImportHarFileResult)
  | ({ source: "overrides" } & SyncOverridesDirectoryResult);

function groupSkipReasons(result: {
  skipped: Array<{ reason: string }>;
}): Array<[string, number]> {
  const counts = new Map<string, number>();

  for (const skipped of result.skipped) {
    counts.set(skipped.reason, (counts.get(skipped.reason) || 0) + 1);
  }

  return [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
  );
}

function usage(): never {
  throw new UsageError(
    "Usage: wraithwalker sync [dir] [--har <har-file>] [--top-origin <origin>]"
  );
}

export const command: CommandSpec<SyncArgs, SyncCommandResult> = {
  name: "sync",
  summary: "Populate or refresh .wraithwalker metadata from overrides or a HAR",
  usage:
    "Usage: wraithwalker sync [dir] [--har <har-file>] [--top-origin <origin>]",
  parse(argv) {
    let harFile: string | undefined;
    let topOrigin: string | undefined;
    const positionals: string[] = [];

    for (let index = 0; index < argv.length; index++) {
      const arg = argv[index];
      if (arg === "--har") {
        harFile = argv[index + 1];
        if (!harFile) {
          usage();
        }
        index++;
        continue;
      }

      if (arg === "--top-origin") {
        topOrigin = argv[index + 1];
        if (!topOrigin) {
          usage();
        }
        index++;
        continue;
      }

      positionals.push(arg);
    }

    if (positionals.length > 1) {
      usage();
    }

    if (topOrigin && !harFile) {
      throw new UsageError(
        "--top-origin can only be used together with --har."
      );
    }

    return {
      dir: positionals[0],
      harFile,
      topOrigin
    };
  },
  async execute(context, args) {
    const dir = path.resolve(context.cwd, args.dir || ".");

    if (args.harFile) {
      const result = await importHarFile({
        harPath: path.resolve(context.cwd, args.harFile),
        dir,
        topOrigin: args.topOrigin,
        onEvent(event) {
          context.output.renderImportProgress(event);
        }
      });
      return {
        source: "har",
        ...result
      };
    }

    const result = await syncOverridesDirectory({
      dir,
      onEvent(event) {
        context.output.renderImportProgress(event);
      }
    });

    return {
      source: "overrides",
      ...result
    };
  },
  render(output, result) {
    const topOrigins =
      result.topOrigins.length > 0
        ? result.topOrigins
        : result.topOrigin
          ? [result.topOrigin]
          : [];

    output.success(`Synced fixture root at ${result.dir}`);
    output.keyValue(
      "Source",
      result.source === "har" ? "HAR" : "Chrome Overrides"
    );
    if (topOrigins.length === 1) {
      output.keyValue("Top Origin", topOrigins[0]);
    } else if (topOrigins.length > 1) {
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
