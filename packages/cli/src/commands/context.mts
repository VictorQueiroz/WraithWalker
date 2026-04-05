import { generateContext } from "@wraithwalker/core/context";
import { findRoot } from "@wraithwalker/core/root";

import type { CommandSpec } from "../lib/command.mjs";
import { createFsGateway } from "../lib/fs-gateway.mjs";

interface ContextArgs {
  editorId?: string;
}

interface ContextResult {
  rootPath: string;
  editorId?: string;
}

export const command: CommandSpec<ContextArgs, ContextResult> = {
  name: "context",
  summary: "Regenerate CLAUDE.md and .d.ts types",
  usage: "Usage: wraithwalker context [--editor <id>]",
  requiresRoot: true,
  parse(argv) {
    let editorId: string | undefined;

    for (let index = 0; index < argv.length; index++) {
      if (argv[index] === "--editor" && argv[index + 1]) {
        editorId = argv[index + 1];
        index++;
      }
    }

    return { editorId };
  },
  async execute(context, args) {
    const { rootPath } = await findRoot(context.cwd);
    await generateContext(rootPath, createFsGateway(), args.editorId);
    return {
      rootPath,
      editorId: args.editorId
    };
  },
  render(output, result) {
    output.success(`Context generated at ${result.rootPath}`);
    if (result.editorId) {
      output.keyValue("Editor", result.editorId);
    }
  }
};
