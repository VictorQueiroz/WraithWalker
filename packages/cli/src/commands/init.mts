import path from "node:path";
import { createRoot, type RootSentinel } from "@wraithwalker/core/root";

import type { CommandSpec } from "../lib/command.mjs";

interface InitArgs {
  dir?: string;
}

interface InitResult {
  dir: string;
  sentinel: RootSentinel;
}

export const command: CommandSpec<InitArgs, InitResult> = {
  name: "init",
  summary: "Create a fixture root (.wraithwalker/root.json)",
  usage: "Usage: wraithwalker init [dir]",
  parse(argv) {
    return { dir: argv[0] };
  },
  async execute(context, args) {
    const dir = path.resolve(context.cwd, args.dir || ".");
    return {
      dir,
      sentinel: await createRoot(dir)
    };
  },
  render(output, result) {
    output.banner();
    output.success(`Fixture root ready at ${result.dir}`);
    output.keyValue("Root ID", result.sentinel.rootId);
  }
};
