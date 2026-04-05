import { startServer } from "@wraithwalker/mcp-server/server";
import { findRoot } from "@wraithwalker/core/root";

import type { CommandSpec } from "../lib/command.mjs";

interface ServeArgs {}
interface ServeResult {}

export const command: CommandSpec<ServeArgs, ServeResult> = {
  name: "serve",
  summary: "Start the MCP server",
  usage: "Usage: wraithwalker serve",
  requiresRoot: true,
  parse() {
    return {};
  },
  async execute(context) {
    const { rootPath } = await findRoot(context.cwd);
    await startServer(rootPath);
    return {};
  },
  render() {}
};
